import { app } from 'electron'
import { randomBytes, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage } from 'http'
import { writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import type { BrowserManager } from './browser'
import { browserUrl, deadline } from './browser-policy'
import { PaneCdp, type CdpPage } from './browser-cdp'
import { loadState } from './state'
import { runtimeStateFile } from './runtime'

export function authorizedBrowserRequest(req: IncomingMessage, token: string): boolean {
  // A normal website must never be able to use this local agent endpoint.
  if (req.headers.origin) return false
  const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') ?? '')
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export async function startBrowserControl(browser: BrowserManager): Promise<() => void> {
  const token = randomBytes(32).toString('hex')
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  let endpoint = ''
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (!authorizedBrowserRequest(req, token)) { res.writeHead(401).end(JSON.stringify({ error: 'Unauthorized' })); return }
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/workspaces') {
        res.end(JSON.stringify((await loadState()).workspaces)); return
      }
      if (req.method !== 'POST' || url.pathname !== '/command') { res.writeHead(404).end('{}'); return }
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (Buffer.byteLength(body) > 1024 * 1024) { res.writeHead(413).end('{}'); return }
      }
      const { workspaceId, tabId, action, value } = JSON.parse(body)
      if (typeof workspaceId !== 'string' || typeof action !== 'string' || (value !== undefined && typeof value !== 'string')) throw new Error('Invalid browser command')
      await browser.workspace(workspaceId)
      let result: unknown
      if (action === 'list') result = browser.snapshot().tabs.filter((t) => t.workspaceId === workspaceId)
      else if (action === 'open') result = await browser.open(workspaceId, value)
      else {
        if (typeof tabId !== 'string') throw new Error('tabId is required')
        // Validate ownership even for endpoint discovery.
        if (!browser.snapshot().tabs.some((t) => t.id === tabId && t.workspaceId === workspaceId)) throw new Error('Browser tab not found in workspace')
        if (action === 'cdp') result = { endpoint: `${endpoint.replace('http:', 'ws:')}/cdp?workspaceId=${encodeURIComponent(workspaceId)}&tabId=${encodeURIComponent(tabId)}` }
        else if (action === 'close') { browser.close(workspaceId, tabId); result = { ok: true } }
        else if (action === 'select') { browser.select(workspaceId, tabId); result = { ok: true } }
        else result = await browser.command(workspaceId, tabId, action, value)
      }
      res.end(JSON.stringify({ result: result ?? null }))
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
  })
  server.on('upgrade', (req, socket, head) => {
    if (!authorizedBrowserRequest(req, token)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/cdp') { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, (ws) => {
      try { connectCdp(browser, url.searchParams.get('workspaceId') ?? '', url.searchParams.get('tabId') ?? '', ws) }
      catch (error) { ws.close(1011, String(error).slice(0, 100)) }
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Browser control failed to start')
  endpoint = `http://127.0.0.1:${address.port}`
  const infoPath = join(app.getPath('userData'), runtimeStateFile('browser-control'))
  writeFileSync(infoPath, JSON.stringify({ endpoint, token, pid: process.pid }), { mode: 0o600 })
  process.env.VIDE_BROWSER_INFO = infoPath
  return () => {
    for (const ws of wss.clients) ws.close(1001, 'Vide is quitting')
    wss.close(); server.close(); server.closeAllConnections()
    rmSync(infoPath, { force: true })
  }
}

function connectCdp(browser: BrowserManager, workspaceId: string, tabId: string, ws: WebSocket): void {
  let ended = false
  const send = (value: unknown): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)) }
  const shim = new PaneCdp(tabId, send)
  const connections = new Map<string, { wc: Electron.WebContents; ready: Promise<void>; cleanup: () => void }>()
  const stop = (): void => {
    if (ended) return
    ended = true
    browser.events.off('popup', onPopup)
    browser.events.off('tab-closed', onClosed)
    for (const connection of connections.values()) connection.cleanup()
    connections.clear()
    ws.close(1000)
  }
  const remove = (id: string): void => {
    const connection = connections.get(id)
    if (!connection) return
    connections.delete(id)
    shim.remove(id)
    connection.cleanup()
    if (id === tabId) stop()
  }
  const attach = (id: string, openerId?: string): Promise<void> => {
    const existing = connections.get(id)
    if (existing) return existing.ready
    const lease = browser.acquire(workspaceId, id)
    const wc = lease.wc
    if (wc.debugger.isAttached()) { lease.release(); throw new Error('Tab already has a debugger attached; close DevTools or disconnect the other client') }
    try { wc.debugger.attach('1.3') } catch (err) { lease.release(); throw err }
    let page: CdpPage | undefined
    let cleaned = false
    const event = (_event: unknown, method: string, params: unknown, childSession?: string): void => {
      // Never forward process-wide target discovery or unregistered sessions.
      if (page && !childSession && !method.startsWith('Target.')) shim.event(page, method, params)
    }
    const changed = (): void => { if (page && !wc.isDestroyed()) shim.changed(page) }
    const detached = (): void => remove(id)
    const cleanup = (): void => {
      if (cleaned) return
      cleaned = true
      if (!wc.isDestroyed()) {
        wc.debugger.off('message', event)
        wc.debugger.off('detach', detached)
        wc.off('destroyed', detached)
        wc.off('did-navigate', changed)
        wc.off('page-title-updated', changed)
        if (wc.debugger.isAttached()) wc.debugger.detach()
      }
      lease.release()
    }
    wc.debugger.on('message', event)
    wc.debugger.on('detach', detached)
    wc.once('destroyed', detached)
    wc.on('did-navigate', changed)
    wc.on('page-title-updated', changed)
    const parentReady = openerId ? connections.get(openerId)?.ready : undefined
    // Native target identity must equal its real main frame ID for Playwright.
    const ready = Promise.resolve(parentReady).then(async () => {
      const { frameTree } = await deadline(wc.debugger.sendCommand('Page.getFrameTree'))
      if (cleaned || ended) return
      page = shim.add(id, frameTree.frame.id, () => ({ url: wc.getURL(), title: wc.getTitle() }), openerId)
    })
    connections.set(id, { wc, ready, cleanup })
    void ready.catch(() => { remove(id); ws.close(1011, 'Could not attach popup target') })
    return ready
  }
  const onPopup = (popup: { workspaceId: string; tabId: string; openerId: string }): void => {
    if (ended || popup.workspaceId !== workspaceId || !connections.has(popup.openerId)) return
    try { void attach(popup.tabId, popup.openerId) } catch { ws.close(1011, 'Popup debugger is unavailable'); stop() }
  }
  const onClosed = (closed: { workspaceId: string; tabId: string }): void => { if (closed.workspaceId === workspaceId) remove(closed.tabId) }
  browser.events.on('popup', onPopup)
  browser.events.on('tab-closed', onClosed)
  ws.on('close', stop)
  ws.on('error', stop)
  let ready: Promise<void[]>
  try { ready = Promise.all(browser.popupFamily(workspaceId, tabId).map((t) => attach(t.tabId, t.openerId))) }
  catch (error) { stop(); throw error }
  void ready.catch(stop)
  ws.on('message', async (data) => {
    let id: number | undefined
    let sessionId: string | undefined
    try {
      const message = JSON.parse(data.toString())
      id = message.id; sessionId = message.sessionId
      const { method, params } = message
      if (typeof id !== 'number' || typeof method !== 'string') throw new Error('Invalid CDP command')
      await ready
      const page = shim.pageForSession(sessionId)
      const connection = connections.get(page.tabId)
      if (!connection) throw new Error('Tab has closed')
      if (method === 'Page.navigate') browserUrl(params?.url ?? '')
      const emulated = shim.command(method, params, sessionId, (id) => browser.close(workspaceId, id), (id) => browser.select(workspaceId, id))
      const result = emulated ? emulated.result : method === 'Page.captureScreenshot' && !params?.clip && !params?.captureBeyondViewport && (!params?.format || params.format === 'png')
        ? { data: ((await browser.command(workspaceId, page.tabId, 'screenshot')) as { base64: string }).base64 }
        : await deadline(connection.wc.debugger.sendCommand(method, params))
      send({ id, result, ...(sessionId ? { sessionId } : {}) })
    } catch (error) { send({ id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) }, ...(sessionId ? { sessionId } : {}) }) }
  })
}
