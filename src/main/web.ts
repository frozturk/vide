import { app } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, statSync, writeFileSync, createReadStream } from 'fs'
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { connect } from 'net'
import { extname, join, resolve, sep } from 'path'
import type { Duplex } from 'stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { WebInfo } from '../shared/types'
import { registerClient, unregisterClient } from './clients'
import { getConfig } from './config'
import { detachClient } from './pty'
import { isDevelopmentRuntime } from './runtime'
import { formatCode, PairingStore, type StoredDevice } from './pairing'

const DEFAULT_PORT = isDevelopmentRuntime() ? 7879 : 7878

export interface Dispatch {
  invoke(channel: string, arg: unknown, clientId: string): Promise<unknown>
  send(channel: string, arg: unknown, clientId: string): void
  blocked: Set<string>
}

const COOKIE = 'vide_device'
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'])
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function sameOrigin(origin: string | undefined, hosts: (string | undefined)[]): boolean {
  if (!origin) return false
  try {
    const host = new URL(origin).host
    return hosts.some((h) => h?.split(',')[0].trim() === host)
  } catch {
    return false
  }
}

export function authCookie(credential: string, secure: boolean): string {
  return `${COOKIE}=${encodeURIComponent(credential)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`
}

function webPath(): string {
  return join(app.getPath('userData'), 'web.json')
}

let store: PairingStore | null = null

function pairing(): PairingStore {
  if (store) return store
  let devices: StoredDevice[] = []
  try {
    const parsed = JSON.parse(readFileSync(webPath(), 'utf8'))
    if (Array.isArray(parsed.devices)) devices = parsed.devices
  } catch {
    devices = []
  }
  store = new PairingStore(devices, (next) => writeFileSync(webPath(), JSON.stringify({ devices: next }, null, 2), { encoding: 'utf8', mode: 0o600 }))
  return store
}

function deviceOf(req: IncomingMessage): string | null {
  return pairing().authenticate(parseCookies(req.headers.cookie)[COOKIE])
}

const socketDevices = new Map<WebSocket, string>()

let server: Server | null = null
let wss: WebSocketServer | null = null
let dispatch: Dispatch | null = null
let bound: { host: string; port: number } | null = null
let lastError: string | null = null

const TAILSCALE_BINS = ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']
let tailscaleCache: { at: number; url: string | null } | null = null

export function tailscaleUrl(statusJson: string): string | null {
  try {
    const name = JSON.parse(statusJson)?.Self?.DNSName
    return typeof name === 'string' && name ? `https://${name.replace(/\.$/, '')}` : null
  } catch {
    return null
  }
}

function runTailscale(bin: string): Promise<string | null> {
  return new Promise((done) => {
    execFile(bin, ['status', '--json'], { timeout: 3000 }, (err, stdout) => done(err ? null : tailscaleUrl(stdout)))
  })
}

async function detectTailscale(): Promise<string | null> {
  if (tailscaleCache && Date.now() - tailscaleCache.at < 60000) return tailscaleCache.url
  let url: string | null = null
  for (const bin of TAILSCALE_BINS) {
    url = await runTailscale(bin)
    if (url) break
  }
  tailscaleCache = { at: Date.now(), url }
  return url
}

async function publicOrigin(): Promise<{ url: string | null; source: WebInfo['publicSource'] }> {
  const configured = getConfig().webPublicUrl?.trim().replace(/\/+$/, '')
  if (configured) return { url: configured, source: 'config' }
  const detected = await detectTailscale()
  return { url: detected, source: detected ? 'tailscale' : null }
}

export async function webInfo(): Promise<WebInfo> {
  const port = bound?.port ?? getConfig().webPort ?? DEFAULT_PORT
  const code = pairing().currentCode()
  const pub = await publicOrigin()
  return {
    url: `http://localhost:${port}/#pair=${code.code}`,
    publicUrl: pub.url ? `${pub.url}/#pair=${code.code}` : null,
    publicSource: pub.source,
    pairingCode: formatCode(code.code),
    pairingExpiresAt: code.expiresAt,
    devices: pairing().list().map((d) => ({ ...d, online: [...socketDevices.values()].includes(d.id) })),
    listening: Boolean(bound),
    error: lastError
  }
}

export function revokeDevice(id?: string): Promise<WebInfo> {
  pairing().revoke(id)
  for (const [ws, deviceId] of socketDevices) if (!id || deviceId === id) ws.close(4001, 'device revoked')
  return webInfo()
}

export function createLimiter(max: number, windowMs: number) {
  let failures: number[] = []
  return {
    blocked(now = Date.now()): boolean {
      failures = failures.filter((t) => now - t < windowMs)
      return failures.length >= max
    },
    fail(now = Date.now()): void {
      failures.push(now)
    }
  }
}

const loginLimiter = createLimiter(10, 60000)

export function isLoopbackHost(host: string | undefined): boolean {
  const name = (host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '::1'
}

function isSecure(req: IncomingMessage): boolean {
  if (String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https') return true
  return !isLoopbackHost(req.headers.host)
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
}

function loginPage(res: ServerResponse, failed: boolean): void {
  res.writeHead(401, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#09090b"><meta name="robots" content="noindex, nofollow"><title>vide</title><link rel="icon" href="/icon.svg"><style>
*{box-sizing:border-box}html,body{height:100%;margin:0}body{background:#09090b;color:#e4e4e7;font:15px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:14px;animation:in .4s cubic-bezier(.2,.8,.2,1)}@keyframes in{from{opacity:0;transform:translateY(8px)}}
img{width:40px;height:40px;margin-bottom:6px}h1{font-size:20px;margin:0;font-weight:600}p{margin:0;color:#71717a;font-size:13px}
input{width:100%;height:50px;border-radius:12px;border:1px solid #27272a;background:#18181b;color:#f4f4f5;padding:0 14px;font:18px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-align:center;text-transform:uppercase;outline:none;transition:border-color .15s}input:focus{border-color:#52525b}input.bad{border-color:#7f1d1d}
button{height:46px;border:0;border-radius:12px;background:#f4f4f5;color:#09090b;font-weight:600;font-size:15px;transition:transform .1s,opacity .15s}button:active{transform:scale(.98);opacity:.9}button:disabled{opacity:.5}
.err{color:#f87171}</style></head><body><form id="f" method="post" action="/pair"><img src="/icon.svg" alt=""><h1>Pair this device</h1><p id="m" class="${failed ? 'err' : ''}">${failed ? 'That code is wrong or expired. Get a fresh one from vide → Settings → Web access.' : 'Scan the QR code in vide → Settings → Web access, or type the code shown there.'}</p><input id="c" name="code" class="${failed ? 'bad' : ''}" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXXX-XXXXX" maxlength="11" required><button id="b" type="submit">Pair</button></form><script>
const f=document.getElementById('f'),c=document.getElementById('c'),b=document.getElementById('b'),m=document.getElementById('m');
async function pair(code){b.disabled=true;b.textContent='Pairing…';const r=await fetch('/pair',{method:'POST',body:new URLSearchParams({code}),redirect:'manual'}).catch(()=>null);if(r&&(r.type==='opaqueredirect'||r.status===303)){location.replace('/');return}b.disabled=false;b.textContent='Pair';c.classList.add('bad');m.className='err';m.textContent=r&&r.status===429?'Too many attempts. Try again in a minute.':'That code is wrong or expired. Get a fresh one from vide → Settings → Web access.'}
function fromHash(){const h=new URLSearchParams(location.hash.slice(1)).get('pair');if(h){history.replaceState(null,'',location.pathname);c.value=h;pair(h)}}fromHash();addEventListener('hashchange',fromHash);
f.addEventListener('submit',(e)=>{e.preventDefault();pair(c.value)});
</script></body></html>`)
}

function redirectWithCookie(req: IncomingMessage, res: ServerResponse, credential: string): void {
  res.writeHead(303, { ...SECURITY_HEADERS, 'Set-Cookie': authCookie(credential, isSecure(req)), Location: '/', 'Cache-Control': 'no-store' })
  res.end()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 4096) req.destroy()
    })
    req.on('end', () => resolveBody(body))
    req.on('error', reject)
  })
}

function rendererRoot(): string {
  return resolve(__dirname, '../renderer')
}

function serveStatic(pathname: string, res: ServerResponse): void {
  const root = rendererRoot()
  let file = resolve(root, `.${decodeURIComponent(pathname)}`)
  if (file !== root && !file.startsWith(root + sep)) file = join(root, 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  const immutable = file.includes(`${sep}assets${sep}`)
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
  })
  createReadStream(file).pipe(res)
}

function proxyHttp(devUrl: URL, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    { host: devUrl.hostname, port: devUrl.port, method: req.method, path: req.url, headers: { ...req.headers, host: devUrl.host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    }
  )
  upstream.on('error', () => {
    res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
}

function proxyUpgrade(devUrl: URL, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const upstream = connect(Number(devUrl.port), devUrl.hostname, () => {
    const headers = { ...req.headers, host: devUrl.host }
    const lines = Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : v === undefined ? [] : [`${k}: ${v}`]))
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://vide')
  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('User-agent: *\nDisallow: /\n')
    return
  }
  if (req.method === 'POST' && url.pathname === '/pair') {
    if (loginLimiter.blocked()) {
      res.writeHead(429, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '60' })
      res.end('Too many attempts. Try again in a minute.')
      return
    }
    const code = new URLSearchParams(await readBody(req)).get('code') ?? ''
    const credential = pairing().pair(code, req.headers['user-agent'])
    if (credential) return redirectWithCookie(req, res, credential)
    loginLimiter.fail()
    return loginPage(res, true)
  }
  const authorized = deviceOf(req) !== null
  if (url.pathname === '/ping') {
    res.writeHead(authorized ? 204 : 401, { 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  if (!authorized && !PUBLIC_PATHS.has(url.pathname)) return loginPage(res, false)
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) return proxyHttp(new URL(devUrl), req, res)
  serveStatic(url.pathname, res)
}

function attachSocket(ws: WebSocket, deviceId: string): void {
  const clientId = `web-${randomUUID()}`
  socketDevices.set(ws, deviceId)
  let alive = true
  registerClient(clientId, (ch, payload) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'event', ch, payload }))
  })
  const reply = (msg: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }
  ws.on('pong', () => {
    alive = true
  })
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate()
    alive = false
    ws.ping()
  }, 25000)
  ws.on('message', async (raw) => {
    let msg: { t: string; id?: number; ch: string; arg?: unknown }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (!dispatch || typeof msg.ch !== 'string') return
    if (msg.t === 'send') return dispatch.send(msg.ch, msg.arg, clientId)
    if (msg.t !== 'invoke') return
    if (dispatch.blocked.has(msg.ch)) return reply({ t: 'result', id: msg.id, ok: false, error: `${msg.ch} is only available in the desktop app` })
    try {
      reply({ t: 'result', id: msg.id, ok: true, value: await dispatch.invoke(msg.ch, msg.arg, clientId) })
    } catch (err) {
      reply({ t: 'result', id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })
  ws.on('close', () => {
    socketDevices.delete(ws)
    pairing().touch(deviceId)
    clearInterval(heartbeat)
    unregisterClient(clientId)
    detachClient(clientId)
  })
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? '/', 'http://vide')
  const deviceId = deviceOf(req)
  const authorized = deviceId !== null
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (url.pathname !== '/ws') {
    if (authorized && devUrl) return proxyUpgrade(new URL(devUrl), req, socket, head)
    socket.destroy()
    return
  }
  const configured = getConfig().webPublicUrl?.trim()
  let publicHost: string | undefined
  try {
    publicHost = configured ? new URL(configured).host : tailscaleCache?.url ? new URL(tailscaleCache.url).host : undefined
  } catch {
    publicHost = undefined
  }
  const hosts = [req.headers.host, req.headers['x-forwarded-host'] as string | undefined, publicHost]
  if (!authorized || !sameOrigin(req.headers.origin, hosts)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()
    return
  }
  wss?.handleUpgrade(req, socket, head, (ws) => attachSocket(ws, deviceId!))
}

export function startWebServer(d: Dispatch): void {
  dispatch = d
  const host = '127.0.0.1'
  const port = getConfig().webPort || DEFAULT_PORT
  if (server && bound?.host === host && bound.port === port) return
  stopWebServer()
  wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
  const s = createServer((req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet')
    handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  s.on('upgrade', handleUpgrade)
  s.on('error', (err: NodeJS.ErrnoException) => {
    lastError = err.message
    bound = null
    console.error('[vide/web] server error:', err.message)
    if (err.code === 'EADDRINUSE') setTimeout(() => {
      if (server === s && !bound) s.listen(port, host)
    }, 3000)
  })
  s.listen(port, host, () => {
    lastError = null
    bound = { host, port }
    console.log(`[vide/web] listening on http://${host}:${port}`)
  })
  server = s
}

export function restartWebServer(): void {
  if (dispatch) startWebServer(dispatch)
}

export function stopWebServer(): void {
  for (const ws of wss?.clients ?? []) ws.terminate()
  wss?.close()
  server?.close()
  server = null
  wss = null
  bound = null
}
