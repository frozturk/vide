import { createApi } from '../../shared/api'
import type { VideApi } from '../../shared/types'

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export interface WebConnection {
  onOpen(cb: (reconnected: boolean) => void): void
  onClose(cb: () => void): void
}

export function createWebApi(): { api: VideApi; connection: WebConnection; ready: Promise<void> } {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const pending = new Map<number, Pending>()
  const queue: string[] = []
  const openCbs: ((reconnected: boolean) => void)[] = []
  const closeCbs: (() => void)[] = []
  let ws: WebSocket | null = null
  let seq = 0
  let attempts = 0
  let opened = false
  let markReady: () => void = () => {}
  const ready = new Promise<void>((r) => (markReady = r))

  const connect = (): void => {
    const socket = new WebSocket(url)
    ws = socket
    socket.onopen = () => {
      attempts = 0
      const reconnected = opened
      opened = true
      for (const msg of queue.splice(0)) socket.send(msg)
      markReady()
      for (const cb of openCbs) cb(reconnected)
    }
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data as string)
      if (msg.t === 'event') {
        for (const cb of listeners.get(msg.ch) ?? []) cb(msg.payload)
        return
      }
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.value)
      else p.reject(new Error(msg.error))
    }
    socket.onclose = (event) => {
      if (ws !== socket) return
      ws = null
      for (const p of pending.values()) p.reject(new Error('connection lost'))
      pending.clear()
      if (opened) for (const cb of closeCbs) cb()
      attempts++
      if (event.code === 4001 || attempts % 3 === 0) {
        fetch('/ping', { cache: 'no-store' })
          .then((r) => {
            if (r.status === 401) location.reload()
          })
          .catch(() => {})
      }
      setTimeout(connect, Math.min(5000, 300 * 2 ** Math.min(attempts, 5)))
    }
  }

  const raw = (msg: object): void => {
    const data = JSON.stringify(msg)
    if (ws?.readyState === WebSocket.OPEN) ws.send(data)
    else queue.push(data)
  }

  const invoke = (ch: string, arg?: unknown): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      raw({ t: 'invoke', id, ch, arg })
    })

  const send = (ch: string, arg: unknown): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'send', ch, arg }))
  }

  const on = (ch: string, cb: (payload: any) => void): (() => void) => {
    const set = listeners.get(ch) ?? new Set()
    set.add(cb)
    listeners.set(ch, set)
    return () => set.delete(cb)
  }

  const api: VideApi = {
    ...createApi(invoke, send, on),
    configOpen: async () => {},
    openInIde: async () => {},
    openExternal: async (target) => {
      window.open(target, '_blank', 'noopener,noreferrer')
    },
    pickDirectory: async () => null,
    clipboardReadText: async () => navigator.clipboard?.readText?.().catch(() => '') ?? ''
  }

  connect()
  return {
    api,
    connection: {
      onOpen: (cb) => openCbs.push(cb),
      onClose: (cb) => closeCbs.push(cb)
    },
    ready
  }
}
