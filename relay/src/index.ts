import { DurableObject } from 'cloudflare:workers'

interface Env {
  INSTANCE: DurableObjectNamespace<Instance>
  ASSETS: Fetcher
  RELAY_TOKEN?: string
}

type HostMessage =
  | { t: 'head'; id: string; status: number; headers: [string, string][] }
  | { t: 'body'; id: string; data: string }
  | { t: 'end'; id: string }
  | { t: 'msg'; id: string; data: string }
  | { t: 'close'; id: string; code?: number }

interface Pending {
  resolve: (res: Response) => void
  writer?: WritableStreamDefaultWriter<Uint8Array>
}

const ID = /^[A-Za-z0-9_-]{16,64}$/
const STREAM_ID = 36
const SKIP = new Set(['host', 'connection', 'upgrade', 'keep-alive', 'transfer-encoding', 'content-length', 'accept-encoding', 'x-relay-origin', 'x-relay-prefix'])

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
}

async function sha256(value: string): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function closeCode(code: number | undefined): number {
  return code === 1000 || (code !== undefined && code >= 3000 && code <= 4999) ? code : 1000
}

function forwardHeaders(req: Request): [string, string][] {
  const origin = new URL(req.headers.get('x-relay-origin') ?? 'https://relay')
  const headers = [...req.headers].filter(([k]) => !SKIP.has(k) && !k.startsWith('sec-websocket-') && !k.startsWith('cf-'))
  headers.push(['host', origin.host], ['x-forwarded-host', origin.host], ['x-forwarded-proto', origin.protocol.slice(0, -1)], ['x-forwarded-prefix', req.headers.get('x-relay-prefix') ?? ''])
  return headers
}

function notice(status: number, text: string): Response {
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#09090b;color:#71717a;font:15px -apple-system,system-ui,sans-serif">${text}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )
}

function withRegister(res: Response): Response {
  return new HTMLRewriter().on('head', { element: (e) => void e.append('<script src="/register.js"></script>', { html: true }) }).transform(res)
}

async function sameSecret(given: string | null, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([given ?? '', expected].map((v) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
  return crypto.subtle.timingSafeEqual(a, b)
}

export function deviceCookie(setCookie: string | null, prefix: string, secure: boolean): string | null {
  const value = setCookie?.match(/^vide_device=([A-Za-z0-9%._~-]+);/)?.[1]
  return value ? `vide_device=${value}; Path=${prefix}/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}` : null
}

export class Instance extends DurableObject<Env> {
  private pending = new Map<string, Pending>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  private host(): WebSocket | undefined {
    return this.ctx.getWebSockets('host').find((ws) => ws.readyState === WebSocket.OPEN)
  }

  private dropAll(code: number, reason: string): void {
    for (const ws of this.ctx.getWebSockets()) ws.close(code, reason)
    for (const p of this.pending.values()) {
      if (p.writer) void p.writer.abort(reason).catch(() => {})
      else p.resolve(new Response('vide disconnected', { status: 502 }))
    }
    this.pending.clear()
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/host') return this.attachHost(req, url)
    if (url.pathname === '/proxy/.relay') return Response.json({ online: !!this.host(), name: (await this.ctx.storage.get<string>('name')) ?? null })
    const host = this.host()
    if (!host) return new Response('vide is offline', { status: 503 })
    const id = crypto.randomUUID()
    const path = url.pathname.slice('/proxy'.length) + url.search
    const headers = forwardHeaders(req)
    if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server, [id])
      host.send(JSON.stringify({ t: 'open', id, path, headers }))
      return new Response(null, { status: 101, webSocket: client })
    }
    const body = req.body ? toBase64(new Uint8Array(await req.arrayBuffer())) : undefined
    return new Promise<Response>((resolve) => {
      this.pending.set(id, { resolve })
      host.send(JSON.stringify({ t: 'req', id, method: req.method, path, headers, body }))
      setTimeout(() => {
        const p = this.pending.get(id)
        if (!p || p.writer) return
        this.pending.delete(id)
        resolve(new Response('vide did not answer', { status: 504 }))
        host.close(1011, 'vide did not answer')
      }, 10000)
    })
  }

  private async attachHost(req: Request, url: URL): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 })
    const secret = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
    if (secret.length < 32) return new Response('Unauthorized', { status: 401 })
    const hash = await sha256(secret)
    const known = await this.ctx.storage.get<string>('secret')
    if (known && known !== hash) return new Response('Unauthorized', { status: 401 })
    if (!known) await this.ctx.storage.put('secret', hash)
    await this.ctx.storage.put('name', (url.searchParams.get('name') ?? '').slice(0, 64))
    this.dropAll(1012, 'vide reconnected')
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, ['host'])
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const [tag] = this.ctx.getTags(ws)
    if (tag !== 'host') {
      if (typeof message === 'string') return this.host()?.send(JSON.stringify({ t: 'msg', id: tag, data: message }))
      const frame = new Uint8Array(STREAM_ID + message.byteLength)
      frame.set(new TextEncoder().encode(tag))
      frame.set(new Uint8Array(message), STREAM_ID)
      return this.host()?.send(frame)
    }
    if (typeof message !== 'string') {
      const bytes = new Uint8Array(message)
      return this.ctx.getWebSockets(new TextDecoder().decode(bytes.subarray(0, STREAM_ID)))[0]?.send(bytes.subarray(STREAM_ID))
    }
    let msg: HostMessage
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (msg.t === 'msg') return this.ctx.getWebSockets(msg.id)[0]?.send(msg.data)
    if (msg.t === 'close') return this.ctx.getWebSockets(msg.id)[0]?.close(closeCode(msg.code), 'closed')
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.t === 'head') {
      const empty = msg.status === 204 || msg.status === 304
      if (empty) this.pending.delete(msg.id)
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
      if (!empty) p.writer = writable.getWriter()
      p.resolve(new Response(empty ? null : readable, { status: msg.status, headers: msg.headers }))
    } else if (msg.t === 'body') {
      void p.writer?.write(fromBase64(msg.data)).catch(() => {})
    } else if (msg.t === 'end') {
      this.pending.delete(msg.id)
      void p.writer?.close().catch(() => {})
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    const [tag] = this.ctx.getTags(ws)
    if (tag !== 'host') {
      this.host()?.send(JSON.stringify({ t: 'close', id: tag, code }))
      return
    }
    if (!this.host()) this.dropAll(1012, 'vide disconnected')
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1006)
  }
}

let appProtocol: Promise<string> | null = null

function asset(env: Env, req: Request, path: string): Promise<Response> {
  return env.ASSETS.fetch(new URL(path, req.url))
}

function protocol(env: Env, req: Request): Promise<string> {
  appProtocol ??= asset(env, req, '/app/protocol.txt').then((r) => r.text()).then((t) => t.trim())
  return appProtocol
}

async function page(env: Env, req: Request, instance: (path: string, init?: Request) => Promise<Response>): Promise<Response> {
  const ping = await instance('ping', new Request(req.url, { headers: req.headers }))
  if (ping.status === 503) return notice(503, 'vide is offline. Check that your Mac is awake.')
  if (ping.status === 401) return asset(env, req, '/login.html')
  if (ping.status !== 204) return notice(502, 'vide did not answer.')
  const header = ping.headers.get('x-vide-protocol') ?? '1'
  const running = /^\d{1,4}$/.test(header) ? header : null
  const expected = await protocol(env, req)
  if (running !== expected) return notice(409, `This Mac's vide speaks relay protocol ${running ?? 'unknown'}, but the relay serves protocol ${expected}. Update vide or redeploy the relay.`)
  return withRegister(await asset(env, req, '/app/index.html'))
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow'
}

async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/') return asset(env, req, '/index.html')
    const [, kind, id = '', ...rest] = url.pathname.split('/')
    if ((kind !== 'i' && kind !== 'host') || !ID.test(id)) return new Response('Not found', { status: 404 })
    if (kind === 'i' && rest.length === 0) return Response.redirect(`${url.origin}/i/${id}/${url.search}`, 301)
    const prefix = `/i/${id}`
    const stub = env.INSTANCE.get(env.INSTANCE.idFromName(id))
    const instance = (path: string, init: Request = req): Promise<Response> => {
      const forwarded = new Request(new URL(path.startsWith('/') ? path : `/proxy/${path}`, 'https://instance'), init)
      forwarded.headers.set('x-relay-origin', url.origin)
      forwarded.headers.set('x-relay-prefix', prefix)
      return stub.fetch(forwarded)
    }
    if (kind === 'host') {
      if (env.RELAY_TOKEN && !(await sameSecret(req.headers.get('x-relay-token'), env.RELAY_TOKEN))) return new Response('Unauthorized', { status: 401 })
      return instance(`/host${url.search}`)
    }
    const path = rest.join('/')
    if (path === '.relay') return instance('.relay')
    if (path === 'ws') return req.headers.get('upgrade')?.toLowerCase() === 'websocket' ? instance('ws') : new Response('Expected WebSocket', { status: 426 })
    if (path === 'ping') {
      const ping = await instance('ping', new Request(req.url, { headers: req.headers }))
      return new Response(null, { status: [204, 401].includes(ping.status) ? ping.status : 503, headers: { 'Cache-Control': 'no-store' } })
    }
    if (path === 'pair' && req.method === 'POST') {
      const res = await instance('pair')
      const cookie = res.status === 303 ? deviceCookie(res.headers.get('set-cookie'), prefix, url.protocol === 'https:') : null
      if (cookie) return new Response(null, { status: 303, headers: { Location: './', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } })
      return new Response(res.status === 429 ? 'Too many attempts' : 'Wrong code', { status: res.status === 429 ? 429 : 401 })
    }
    if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    if (path === '') return page(env, req, instance)
    return asset(env, req, `/app/${path}`)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await route(req, env)
    if (res.status === 101) return res
    const secured = new Response(res.body, res)
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) secured.headers.set(k, v)
    return secured
  }
}
