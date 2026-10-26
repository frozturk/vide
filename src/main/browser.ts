import { app, BrowserWindow, BaseWindow, WebContentsView, session } from 'electron'
import { EventEmitter } from 'events'
import { shortcutModifiers } from '../shared/platform-shortcuts'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { BrowserTab, BrowserLayout, BrowserSnapshot, Workspace } from '../shared/types'
import { loadState } from './state'
import { browserPartition, browserUrl, deadline } from './browser-policy'
import { click, fill, hover, isRef, parseViewport, press, refOf, scroll, scrollTo, snapshot, upload, type Cdp, type Frames, type Ref } from './browser-agent'
import { isDevelopmentRuntime, runtimeStateFile } from './runtime'
import { matchBrowserShortcut } from '../shared/browser-shortcuts'
import { matchChord } from '../shared/chords'

interface Tab {
  id: string
  workspaceId: string
  projectId: string
  openerId?: string
  url: string
  title: string
  error: string | null
  view?: WebContentsView
  wc?: Electron.WebContents
  presented?: boolean
  recovering?: boolean
  logs: { level: string; message: string; timestamp: number }[]
  used: number
  busy: number
  refs?: Map<string, Ref>
  requests?: { method: string; url: string; status: number | string; type: string; timestamp: number }[]
  viewport?: { width: number; height: number } | null
}

export class BrowserManager {
  readonly events = new EventEmitter()
  private tabs = new Map<string, Tab>()
  private active = new Map<string, string>()
  private layout: BrowserLayout | null = null
  private saveTimer?: ReturnType<typeof setTimeout>
  private stopped = false
  private background: BaseWindow
  constructor(private win: BrowserWindow) {
    // Background pages need a native viewport, but must never be attached over
    // the app renderer. A permanently hidden host provides that viewport.
    this.background = this.createBackground()
  }
  private createBackground(): BaseWindow {
    return new BaseWindow({ show: false, width: 1600, height: 1200, focusable: false, skipTaskbar: true })
  }
  private backgroundHost(): BaseWindow {
    if (this.background.isDestroyed()) {
      this.background = this.createBackground()
      for (const t of this.tabs.values()) if (!t.presented) t.presented = undefined
    }
    return this.background
  }

  async restore(): Promise<void> {
    const { workspaces } = await loadState()
    try {
      const saved = JSON.parse(readFileSync(this.file(), 'utf8'))
      for (const t of Array.isArray(saved.tabs) ? saved.tabs.slice(0, 100) : []) {
        const w = workspaces.find((w) => w.id === t.workspaceId)
        if (!w || typeof t.id !== 'string' || typeof t.url !== 'string') continue
        try { this.tabs.set(t.id, { id: t.id, workspaceId: w.id, projectId: w.projectId, url: browserUrl(t.url), title: String(t.title ?? ''), error: null, logs: [], used: 0, busy: 0, viewport: t.viewport ?? null }) } catch {}
      }
      for (const t of this.tabs.values()) {
        if (saved.active?.[t.workspaceId] === t.id || !this.active.has(t.workspaceId)) this.active.set(t.workspaceId, t.id)
      }
    } catch {}
  }

  private file(): string { return join(app.getPath('userData'), runtimeStateFile('browser-tabs')) }
  private persist(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 200)
  }
  private flush(): void {
    const file = this.file()
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify({ tabs: [...this.tabs.values()].map(({ id, workspaceId, url, title, viewport }) => ({ id, workspaceId, url, title, viewport })), active: Object.fromEntries(this.active) }), { mode: 0o600 })
      renameSync(`${file}.tmp`, file)
    } catch (error) { console.error('[browser] save failed', error) }
  }
  snapshot(): BrowserSnapshot {
    return { tabs: [...this.tabs.values()].map((t): BrowserTab => {
      const wc = this.contents(t)
      return { id: t.id, workspaceId: t.workspaceId, url: t.url, title: t.title, error: t.error, loading: wc?.isLoading() ?? false, canGoBack: wc?.navigationHistory.canGoBack() ?? false, canGoForward: wc?.navigationHistory.canGoForward() ?? false, viewport: t.viewport ?? null }
    }), active: Object.fromEntries(this.active) }
  }
  private contents(t: Tab): Electron.WebContents | undefined {
    // Keep the WebContents reference separately: even reading webContents on a
    // destroyed native view can throw before its destroyed handler has run.
    return t.wc && !t.wc.isDestroyed() ? t.wc : undefined
  }
  private emit(): void {
    if (!this.stopped && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) this.win.webContents.send('browser:state', this.snapshot())
    this.persist()
  }
  private tab(workspaceId: string, id: string): Tab {
    const t = this.tabs.get(id)
    if (!t || t.workspaceId !== workspaceId) throw new Error('Browser tab not found in workspace')
    return t
  }
  async workspace(id: string): Promise<Workspace> {
    const w = (await loadState()).workspaces.find((w) => w.id === id)
    if (!w) throw new Error('Workspace not found')
    return w
  }
  async open(workspaceId: string, url = 'about:blank'): Promise<BrowserTab> {
    const normalized = browserUrl(url)
    const w = await this.workspace(workspaceId)
    if (this.stopped || this.win.isDestroyed()) throw new Error('Browser is shutting down')
    if (this.tabs.size >= 100) throw new Error('Close a browser tab before opening more (limit 100)')
    const t: Tab = { id: randomUUID(), workspaceId, projectId: w.projectId, url: normalized, title: '', error: null, logs: [], used: Date.now(), busy: 0 }
    const previous = this.active.get(workspaceId)
    this.tabs.set(t.id, t)
    this.active.set(workspaceId, t.id)
    try {
      this.materialize(t)
      this.applyLayout()
      this.emit()
      return this.snapshot().tabs.find((x) => x.id === t.id)!
    } catch (error) {
      this.tabs.delete(t.id)
      if (previous) this.active.set(workspaceId, previous); else this.active.delete(workspaceId)
      this.disposeView(t)
      this.emit()
      throw error
    }
  }
  private materialize(t: Tab): WebContentsView {
    t.used = Date.now()
    if (this.stopped || this.win.isDestroyed()) throw new Error('Browser is shutting down')
    if (t.view) {
      if (!this.contents(t)) throw new Error('Browser tab is closing; list tabs and reopen its URL')
      return t.view
    }
    const partition = browserPartition(t.projectId, isDevelopmentRuntime())
    const ses = session.fromPartition(partition)
    this.watchNetwork(ses, partition)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    this.attachView(t, view)
    void view.webContents.loadURL(t.url).catch(() => {})
    return view
  }
  private attachView(t: Tab, view: WebContentsView): void {
    t.view = view
    const wc = view.webContents
    t.wc = wc
    t.presented = false
    view.setBounds({ x: 0, y: 0, width: t.viewport?.width ?? 1200, height: t.viewport?.height ?? 800 })
    view.setVisible(false)
    this.backgroundHost().contentView.addChildView(view)
    view.setVisible(true)
    const guard = (e: Electron.Event, url: string): void => { try { browserUrl(url) } catch { e.preventDefault() } }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.setWindowOpenHandler(({ url }) => {
      try { browserUrl(url) } catch { return { action: 'deny' } }
      if (this.stopped || this.tabs.size >= 100) return { action: 'deny' }
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          // Use Electron's supplied options: they carry the original popup
          // contents and inherited preferences, including its opener/session.
          const popupView = new WebContentsView(options)
          const popup: Tab = { id: randomUUID(), workspaceId: t.workspaceId, projectId: t.projectId, openerId: t.id, url, title: '', error: null, logs: [], used: Date.now(), busy: 0 }
          this.tabs.set(popup.id, popup)
          this.active.set(t.workspaceId, popup.id)
          this.attachView(popup, popupView)
          this.events.emit('popup', { workspaceId: t.workspaceId, tabId: popup.id, openerId: t.id })
          this.applyLayout()
          this.emit()
          // Electron performs the original navigation, including POST bodies.
          return popupView.webContents
        }
      }
    })
    wc.once('destroyed', () => {
      if (t.view !== view) return
      t.view = undefined
      t.wc = undefined
      if (this.tabs.has(t.id) && !this.stopped) this.close(t.workspaceId, t.id)
    })
    wc.on('before-input-event', (event, input) => {
      if (this.stopped || this.win.isDestroyed() || input.type !== 'keyDown') return
      const mods = shortcutModifiers(input.key, input.meta, input.control, input.shift, input.alt, process.platform === 'darwin')
      const chord = matchBrowserShortcut(input.key, mods.active, mods.shift) ?? matchChord(input.key, mods.active, mods.shift)
      if (chord) { event.preventDefault(); this.win.webContents.focus(); this.win.webContents.send('browser:shortcut', chord) }
    })
    const update = (): void => {
      if (t.wc !== wc || wc.isDestroyed()) return
      t.url = wc.getURL() || t.url
      t.title = wc.getTitle()
      this.emit()
    }
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'page-title-updated'] as const) wc.on(event as 'did-navigate', update)
    wc.on('did-navigate', () => { t.refs = undefined })
    wc.on('did-start-loading', () => { t.error = null; this.emit() })
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) { t.error = description; this.emit() }
    })
    wc.on('render-process-gone', (_event, details) => { t.error = `Page stopped: ${details.reason}. Reload to recover.`; this.emit() })
    wc.on('console-message', (event) => {
      t.logs.push({ level: event.level, message: event.message.slice(0, 16_000), timestamp: Date.now() })
      if (t.logs.length > 200) t.logs.shift()
    })
  }
  setLayout(layout: BrowserLayout): void {
    if (layout.workspaceId && !this.tabs.has(this.active.get(layout.workspaceId) ?? '')) layout.visible = false
    this.layout = layout
    this.applyLayout()
  }
  private applyLayout(): void {
    if (this.stopped || this.win.isDestroyed()) return
    const l = this.layout
    const [width, height] = this.win.getContentSize()
    for (const t of this.tabs.values()) {
      // Debugger detach can release its lease before the destroyed handler
      // removes a closing popup. Never recreate or lay out that native view.
      if (t.recovering || (t.view && !this.contents(t))) continue
      const shown = !!l?.visible && l.workspaceId === t.workspaceId && this.active.get(t.workspaceId) === t.id
      const view = shown ? this.materialize(t) : t.view
      if (!view) continue
      if (shown && l) {
        const paneWidth = t.viewport ? Math.min(t.viewport.width, l.width) : l.width
        const x = Math.max(0, Math.min(width - 1, Math.round(l.x + (l.width - paneWidth) / 2)))
        const y = Math.max(0, Math.min(height - 1, Math.round(l.y)))
        view.setBounds({ x, y, width: Math.max(1, Math.min(width - x, Math.round(paneWidth))), height: Math.max(1, Math.min(height - y, Math.round(t.viewport ? Math.min(t.viewport.height, l.height) : l.height))) })
      } else if (!shown && t.viewport && t.presented) view.setBounds({ x: 0, y: 0, ...t.viewport })
      // Agent leases affect eviction, never presentation. Only user panel
      // changes transfer pages between the visible and hidden hosts.
      if (shown !== t.presented || (!shown && this.background.isDestroyed())) {
        if (shown) this.win.contentView.addChildView(view)
        else this.backgroundHost().contentView.addChildView(view)
        t.presented = shown
      }
    }
    // Recreating either end of an opener relationship would break login flows.
    const related = new Set([...this.tabs.values()].flatMap((t) => t.openerId ? [t.id, t.openerId] : []))
    const hidden = [...this.tabs.values()].filter((t) => t.view && !t.busy && !related.has(t.id) && !(l?.visible && l.workspaceId === t.workspaceId && this.active.get(t.workspaceId) === t.id)).sort((a, b) => b.used - a.used)
    for (const t of hidden.slice(3)) this.disposeView(t)
  }
  private disposeView(t: Tab): void {
    if (!t.view) return
    const view = t.view
    const wc = this.contents(t)
    t.view = undefined
    t.wc = undefined
    t.presented = false
    // Native teardown can precede the destroyed event (e.g. debugger detach).
    // Do not pass a dead view back into Electron while cleaning up.
    if (!wc) return
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    if (!this.background.isDestroyed()) this.background.contentView.removeChildView(view)
    wc.close({ waitForBeforeUnload: false })
  }
  private recover(workspaceId: string, id: string): BrowserSnapshot {
    if (this.stopped || this.win.isDestroyed()) throw new Error('Browser is shutting down')
    const t = this.tab(workspaceId, id)
    t.recovering = true
    try {
      this.disposeView(t)
      // Existing CDP sessions belong to the old native page. Disconnect them
      // before rebuilding, including sessions released during native teardown.
      this.events.emit('tab-closed', { workspaceId, tabId: id })
      t.error = null
    } finally { t.recovering = false }
    this.materialize(t)
    this.applyLayout()
    this.emit()
    return this.snapshot()
  }
  select(workspaceId: string, id: string): void { this.tab(workspaceId, id); this.active.set(workspaceId, id); this.applyLayout(); this.emit() }
  close(workspaceId: string, id: string): void {
    const t = this.tab(workspaceId, id)
    this.tabs.delete(id)
    this.events.emit('tab-closed', { workspaceId, tabId: id })
    this.disposeView(t)
    if (this.active.get(workspaceId) === id) {
      const next = (t.openerId ? this.tabs.get(t.openerId) : undefined) ?? [...this.tabs.values()].find((t) => t.workspaceId === workspaceId)
      if (next) this.active.set(workspaceId, next.id); else this.active.delete(workspaceId)
    }
    this.applyLayout(); this.emit()
  }
  popupFamily(workspaceId: string, rootId: string): { tabId: string; openerId?: string }[] {
    this.tab(workspaceId, rootId)
    const family = [{ tabId: rootId, openerId: undefined } as { tabId: string; openerId?: string }]
    const ids = new Set([rootId])
    for (const item of family) {
      for (const t of this.tabs.values()) {
        if (t.workspaceId === workspaceId && t.openerId === item.tabId && !ids.has(t.id)) {
          family.push({ tabId: t.id, openerId: item.tabId }); ids.add(t.id)
        }
      }
    }
    return family
  }
  removeWorkspace(workspaceId: string): void { for (const t of [...this.tabs.values()]) if (t.workspaceId === workspaceId) this.close(workspaceId, t.id) }
  acquire(workspaceId: string, id: string): { wc: Electron.WebContents; release: () => void } {
    const t = this.tab(workspaceId, id)
    t.busy++
    let wc: Electron.WebContents
    try { this.materialize(t); wc = this.contents(t)!; this.applyLayout() } catch (err) { t.busy--; throw err }
    let released = false
    return { wc, release: () => { if (!released) { released = true; t.busy--; this.applyLayout() } } }
  }
  private async debug<T>(wc: Electron.WebContents, run: (cdp: Cdp) => Promise<T>): Promise<T> {
    const owned = !wc.debugger.isAttached()
    const frames: Frames = new Map()
    const track = (_event: unknown, method: string, params: any): void => {
      if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') frames.set(params.targetInfo.targetId, { session: params.sessionId, url: params.targetInfo.url })
      if (method === 'Target.detachedFromTarget') for (const [id, frame] of frames) if (frame.session === params.sessionId) frames.delete(id)
    }
    if (owned) wc.debugger.attach('1.3')
    wc.debugger.on('message', track)
    let attached = false
    const send = (method: string, params?: Record<string, unknown>, session?: string): Promise<any> => deadline(wc.debugger.sendCommand(method, params, session))
    try {
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
      return await run({
        send,
        frames: async () => {
          if (!attached) {
            attached = true
            await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          return frames
        }
      })
    } finally {
      if (!wc.isDestroyed()) {
        wc.debugger.off('message', track)
        if (attached && !owned && wc.debugger.isAttached()) await send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
        if (owned && wc.debugger.isAttached()) wc.debugger.detach()
      }
    }
  }
  private watched = new Set<string>()
  private watchNetwork(ses: Electron.Session, partition: string): void {
    if (this.watched.has(partition)) return
    this.watched.add(partition)
    const record = (details: Electron.OnCompletedListenerDetails | Electron.OnErrorOccurredListenerDetails, status: number | string): void => {
      const t = [...this.tabs.values()].find((t) => t.wc && !t.wc.isDestroyed() && t.wc.id === details.webContentsId)
      if (!t) return
      const requests = t.requests ??= []
      requests.push({ method: details.method, url: details.url.slice(0, 500), status, type: details.resourceType, timestamp: Math.round(details.timestamp) })
      if (requests.length > 300) requests.shift()
    }
    ses.webRequest.onCompleted((details) => record(details, details.statusCode))
    ses.webRequest.onErrorOccurred((details) => record(details, details.error))
  }
  private async waitForText(wc: Electron.WebContents, text: string): Promise<{ found: string }> {
    const until = Date.now() + 15_000
    while (Date.now() < until) {
      if (await deadline(wc.executeJavaScript(`Boolean(document.body?.innerText.includes(${JSON.stringify(text)}))`))) return { found: text }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Timed out waiting for text: ${text}`)
  }
  private setViewport(t: Tab, value?: string): void {
    t.viewport = parseViewport(value)
    if (t.view && !t.presented && this.contents(t)) t.view.setBounds({ x: 0, y: 0, width: t.viewport?.width ?? 1200, height: t.viewport?.height ?? 800 })
    this.applyLayout()
    this.emit()
  }
  async command(workspaceId: string, id: string, action: string, value?: string): Promise<unknown> {
    if (action === 'recover') return this.recover(workspaceId, id)
    if (action === 'viewport') { this.setViewport(this.tab(workspaceId, id), value); return this.snapshot() }
    const url = action === 'navigate' ? browserUrl(value ?? '') : undefined
    const lease = this.acquire(workspaceId, id)
    try {
      const wc = lease.wc
      switch (action) {
        case 'navigate': await deadline(wc.loadURL(url!)); break
        case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break
        case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break
        case 'reload': wc.reload(); break
        case 'devtools': wc.openDevTools({ mode: 'detach' }); break
        case 'eval': return await deadline(wc.executeJavaScript(value ?? 'document.title'))
        case 'screenshot': return { base64: (await deadline(wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))).toPNG().toString('base64') }
        case 'console': return this.tab(workspaceId, id).logs
        case 'snapshot': {
          const t = this.tab(workspaceId, id)
          const result = await this.debug(wc, snapshot)
          t.refs = result.refs
          return `Page: ${wc.getTitle()} (${wc.getURL()})\n${result.text}`
        }
        case 'click': case 'hover': case 'fill': case 'upload': {
          const [ref, ...rest] = action === 'upload' ? (value ?? '').split('\n') : (value ?? '').trim().split(' ')
          const target = refOf(this.tab(workspaceId, id).refs, ref)
          if (action === 'click') return { clicked: ref, ...await this.debug(wc, (cdp) => click(cdp, target)) }
          if (action === 'hover') return { hovered: ref, ...await this.debug(wc, (cdp) => hover(cdp, target)) }
          if (action === 'upload') return await this.debug(wc, (cdp) => upload(cdp, target, rest))
          await this.debug(wc, (cdp) => fill(cdp, target, rest.join(' ')))
          return { filled: ref }
        }
        case 'scroll': {
          const [first = 'down', amount = '600'] = (value ?? '').trim().split(/\s+/).filter(Boolean)
          if (isRef(first)) return { scrolledTo: first, ...await this.debug(wc, (cdp) => scrollTo(cdp, refOf(this.tab(workspaceId, id).refs, first))) }
          return await this.debug(wc, (cdp) => scroll(cdp, first, Number(amount)))
        }
        case 'network': {
          const requests = this.tab(workspaceId, id).requests ?? []
          return requests.filter((r) => !value || r.url.includes(value)).slice(-100)
        }
        case 'type': await this.debug(wc, (cdp) => cdp.send('Input.insertText', { text: value ?? '' })); return { typed: value ?? '' }
        case 'press': await this.debug(wc, (cdp) => press(cdp.send, value ?? 'Enter')); return { pressed: value ?? 'Enter' }
        case 'wait': if (!value) throw new Error('wait requires text'); return await this.waitForText(wc, value)
        default: throw new Error('Unknown browser action')
      }
      return this.snapshot()
    } finally { lease.release() }
  }
  stop(): void {
    this.stopped = true
    clearTimeout(this.saveTimer)
    this.flush()
    for (const t of this.tabs.values()) this.disposeView(t)
    if (!this.background.isDestroyed()) this.background.destroy()
    clearTimeout(this.saveTimer)
  }
}

let manager: BrowserManager | undefined
export function initBrowser(win: BrowserWindow): BrowserManager { manager = new BrowserManager(win); return manager }
export function getBrowser(): BrowserManager { if (!manager) throw new Error('Desktop browser is not available'); return manager }
export function removeBrowserWorkspace(id: string): void { manager?.removeWorkspace(id) }
