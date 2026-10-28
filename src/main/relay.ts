import { app } from 'electron'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { request, type IncomingHttpHeaders } from 'http'
import { hostname } from 'os'
import { join } from 'path'
import { WebSocket } from 'ws'
import { getConfig } from './config'

export interface RelayIdentity {
  id: string
  secret: string
}

export interface RelayConnection {
  close(): void
  connected(): boolean
}

type RelayMessage =
  | { t: 'req'; id: string; method: string; path: string; headers: [string, string][]; body?: string }
  | { t: 'open'; id: string; path: string; headers: [string, string][] }
  | { t: 'msg'; id: string; data: string }
  | { t: 'close'; id: string }

const CHUNK = 256 * 1024
const STREAM_ID = 36
const DROP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length'])

function identityPath(): string {
  return join(app.getPath('userData'), 'relay.json')
}

export function relayIdentity(): RelayIdentity {
  try {
    const parsed = JSON.parse(readFileSync(identityPath(), 'utf8'))
    if (typeof parsed.id === 'string' && typeof parsed.secret === 'string') return parsed
  } catch {}
  const identity = { id: randomBytes(16).toString('base64url'), secret: randomBytes(32).toString('base64url') }
  writeFileSync(identityPath(), JSON.stringify(identity, null, 2), { encoding: 'utf8', mode: 0o600 })
  return identity
}

export function relayBase(): string | null {
  return getConfig().relayUrl?.trim().replace(/\/+$/, '') || null
}

export function toHeaders(pairs: [string, string][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of pairs) out[k] = k in out ? `${out[k]}, ${v}` : v
  return out
}

export function fromHeaders(headers: IncomingHttpHeaders): [string, string][] {
  return Object.entries(headers).flatMap(([k, v]) => (DROP.has(k) || v === undefined ? [] : Array.isArray(v) ? v.map((x): [string, string] => [k, x]) : [[k, v]]))
}

export function connectRelay(base: string, port: number, identity: RelayIdentity, name: string): RelayConnection {
  const locals = new Map<string, { ws: WebSocket; queue: (string | Buffer)[] }>()
  let socket: WebSocket | null = null
  let open = false
  let alive = true
  let stopped = false
  let attempts = 0
  let retry: NodeJS.Timeout | undefined

  const send = (msg: object): void => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  }

  const forward = (msg: Extract<RelayMessage, { t: 'req' }>): void => {
    const req = request({ host: '127.0.0.1', port, method: msg.method, path: msg.path, headers: toHeaders(msg.headers) }, (res) => {
      send({ t: 'head', id: msg.id, status: res.statusCode ?? 502, headers: fromHeaders(res.headers) })
      res.on('data', (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i += CHUNK) send({ t: 'body', id: msg.id, data: chunk.subarray(i, i + CHUNK).toString('base64') })
      })
      res.on('end', () => send({ t: 'end', id: msg.id }))
    })
    req.on('error', () => {
      send({ t: 'head', id: msg.id, status: 502, headers: [] })
      send({ t: 'end', id: msg.id })
    })
    req.end(msg.body ? Buffer.from(msg.body, 'base64') : undefined)
  }

  const attach = (msg: Extract<RelayMessage, { t: 'open' }>): void => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${msg.path}`, { headers: toHeaders(msg.headers) })
    const local = { ws, queue: [] as (string | Buffer)[] }
    locals.set(msg.id, local)
    ws.on('open', () => {
      for (const data of local.queue.splice(0)) ws.send(data)
    })
    ws.on('message', (data: Buffer, binary) => {
      if (!binary) return send({ t: 'msg', id: msg.id, data: data.toString() })
      if (socket?.readyState === WebSocket.OPEN) socket.send(Buffer.concat([Buffer.from(msg.id), data]))
    })
    ws.on('close', (code) => {
      if (locals.delete(msg.id)) send({ t: 'close', id: msg.id, code })
    })
    ws.on('error', () => {})
  }

  const deliver = (id: string, data: string | Buffer): void => {
    const local = locals.get(id)
    if (!local) return
    if (local.ws.readyState === WebSocket.OPEN) local.ws.send(data)
    else local.queue.push(data)
  }

  const handle = (raw: string): void => {
    if (raw === 'pong') {
      alive = true
      return
    }
    let msg: RelayMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.t === 'req') return forward(msg)
    if (msg.t === 'open') return attach(msg)
    if (msg.t === 'msg') return deliver(msg.id, msg.data)
    const local = locals.get(msg.id)
    if (!local) return
    locals.delete(msg.id)
    local.ws.close()
  }

  const heartbeat = setInterval(() => {
    if (!socket || !open) return
    if (!alive) return socket.terminate()
    alive = false
    socket.send('ping')
  }, 25000)

  const connect = (): void => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/host/${identity.id}?name=${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${identity.secret}` }
    })
    socket = ws
    ws.on('open', () => {
      open = true
      alive = true
      attempts = 0
    })
    ws.on('message', (data: Buffer, binary) => {
      if (binary) deliver(data.subarray(0, STREAM_ID).toString(), data.subarray(STREAM_ID))
      else handle(data.toString())
    })
    ws.on('error', (err) => console.error('[vide/relay]', err.message))
    ws.on('close', () => {
      open = false
      for (const local of locals.values()) local.ws.terminate()
      locals.clear()
      if (stopped || socket !== ws) return
      retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts++))
    })
  }

  connect()
  return {
    close: () => {
      stopped = true
      clearInterval(heartbeat)
      clearTimeout(retry)
      socket?.terminate()
    },
    connected: () => open
  }
}

let current: RelayConnection | null = null

export function startRelay(port: number): void {
  stopRelay()
  const base = relayBase()
  if (base) current = connectRelay(base, port, relayIdentity(), hostname().replace(/\.local$/, ''))
}

export function stopRelay(): void {
  current?.close()
  current = null
}

export function relayConnected(): boolean {
  return current?.connected() ?? false
}
