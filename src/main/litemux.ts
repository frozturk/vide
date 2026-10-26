import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { connect, type Socket } from 'net'
import { StringDecoder } from 'string_decoder'

export type LitemuxSession = { name: string; pid: number; title: string; state: string; reply: string; replyAt: number }

export function encodeFrame(kind: 'I' | 'R', payload: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.write(kind, 0, 'latin1')
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

export function decodeFrames(buffer: Buffer): { frames: { kind: string; payload: Buffer }[]; rest: Buffer } {
  const frames: { kind: string; payload: Buffer }[] = []
  let rest = buffer
  while (rest.length >= 5) {
    const length = rest.readUInt32BE(1)
    if (rest.length < 5 + length) break
    frames.push({ kind: String.fromCharCode(rest[0]), payload: rest.subarray(5, 5 + length) })
    rest = rest.subarray(5 + length)
  }
  return { frames, rest }
}

function open(info: string, req: object): Promise<{ conn: Socket; reply: any; rest: Buffer }> {
  return new Promise((resolve, reject) => {
    let server: { port: number; token: string }
    try {
      server = JSON.parse(readFileSync(info, 'utf8'))
    } catch (error) {
      reject(error)
      return
    }
    const conn = connect({ host: '127.0.0.1', port: server.port })
    conn.setNoDelay(true)
    let buffer = Buffer.alloc(0)
    const timer = setTimeout(() => fail(new Error('litemux request timed out')), 5000)
    const fail = (error: Error): void => {
      clearTimeout(timer)
      conn.destroy()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      const end = buffer.indexOf(10)
      if (end < 0) return
      clearTimeout(timer)
      conn.off('data', onData)
      conn.off('error', fail)
      conn.off('close', onClose)
      const reply = JSON.parse(buffer.subarray(0, end).toString())
      if (!reply.ok) {
        conn.destroy()
        reject(new Error(reply.error ?? 'litemux request failed'))
        return
      }
      resolve({ conn, reply, rest: buffer.subarray(end + 1) })
    }
    const onClose = (): void => fail(new Error('litemux closed the connection'))
    conn.on('data', onData)
    conn.on('error', fail)
    conn.on('close', onClose)
    conn.write(JSON.stringify({ ...req, token: server.token }) + '\n')
  })
}

export async function request(info: string, req: object): Promise<any> {
  const { conn, reply } = await open(info, req)
  conn.destroy()
  return reply
}

export async function listSessions(info: string): Promise<LitemuxSession[]> {
  return (await request(info, { op: 'list' })).sessions
}

export async function ensureServer(bin: string, info: string): Promise<void> {
  if (await listSessions(info).then(() => true, () => false)) return
  const child = spawn(bin, ['-S', info, 'server'], { detached: true, stdio: 'ignore', windowsHide: true })
  let failure: Error | undefined
  child.on('error', (error) => { failure = error })
  child.unref()
  for (let i = 0; i < 500; i++) {
    await new Promise((r) => setTimeout(r, 20))
    if (failure) throw new Error(`Could not start litemux (${bin}): ${failure.message}`)
    if (await listSessions(info).then(() => true, () => false)) return
  }
  throw new Error(`litemux server did not start (${bin})`)
}

export interface Attached {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): void
  onExit(listener: (e: { exitCode: number }) => void): void
}

export async function attach(info: string, name: string): Promise<Attached> {
  const { conn, rest } = await open(info, { op: 'attach', name })
  const decoder = new StringDecoder('utf8')
  const dataListeners: ((data: string) => void)[] = []
  const exitListeners: ((e: { exitCode: number }) => void)[] = []
  const backlog: string[] = []
  let buffer = rest
  let exitCode = -1
  const read = (chunk: Buffer): void => {
    const decoded = decodeFrames(Buffer.concat([buffer, chunk]))
    buffer = decoded.rest
    for (const { kind, payload } of decoded.frames) {
      if (kind === 'X') exitCode = Number(payload.toString()) || 0
      if (kind !== 'D') continue
      const text = decoder.write(payload)
      if (!text) continue
      if (dataListeners.length) for (const l of dataListeners) l(text)
      else backlog.push(text)
    }
  }
  conn.on('data', read)
  conn.on('error', () => conn.destroy())
  conn.on('close', () => {
    for (const l of exitListeners) l({ exitCode })
  })
  queueMicrotask(() => read(Buffer.alloc(0)))
  return {
    write: (data) => {
      if (!conn.destroyed) conn.write(encodeFrame('I', Buffer.from(data, 'utf8')))
    },
    resize: (cols, rows) => {
      const size = Buffer.alloc(4)
      size.writeUInt16BE(cols, 0)
      size.writeUInt16BE(rows, 2)
      if (!conn.destroyed) conn.write(encodeFrame('R', size))
    },
    kill: () => conn.destroy(),
    onData: (listener) => {
      dataListeners.push(listener)
      for (const text of backlog.splice(0)) listener(text)
    },
    onExit: (listener) => {
      exitListeners.push(listener)
    }
  }
}
