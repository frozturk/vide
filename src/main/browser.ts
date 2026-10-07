import { app, BrowserWindow, BaseWindow, WebContentsView, session } from 'electron'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import type { BrowserTab, BrowserLayout, BrowserSnapshot, Workspace } from '../shared/types'
import { loadState } from './state'
import { browserPartition, browserUrl, deadline } from './browser-policy'
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
  presented?: boolean
  logs: { level: string; message: string; timestamp: number }[]
  used: number
  busy: number
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
    this.background = new BaseWindow({ show: false, width: 1600, height: 1200, focusable: false, skipTaskbar: true })
  }

  async restore(): Promise<void> {
    const { workspaces } = await loadState()
    try {
      const saved = JSON.parse(readFileSync(this.file(), 'utf8'))
      for (const t of Array.isArray(saved.tabs) ? saved.tabs.slice(0, 100) : []) {
        const w = workspaces.find((w) => w.id === t.workspaceId)
        if (!w || typeof t.id !== 'string' || typeof t.url !== 'string') continue
        try { this.tabs.set(t.id, { id: t.id, workspaceId: w.id, projectId: w.projectId, url: browserUrl(t.url), title: String(t.title ?? ''), error: null, logs: [], used: 0, busy: 0 }) } catch {}
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
      writeFileSync(`${file}.tmp`, JSON.stringify({ tabs: [...this.tabs.values()].map(({ id, workspaceId, url, title }) => ({ id, workspaceId, url, title })), active: Object.fromEntries(this.active) }), { mode: 0o600 })
      renameSync(`${file}.tmp`, file)
    } catch (error) { console.error('[browser] save failed', error) }
  }
  snapshot(): BrowserSnapshot {
    return { tabs: [...this.tabs.values()].map((t): BrowserTab => {
      const wc = t.view?.webContents
      return { id: t.id, workspaceId: t.workspaceId, url: t.url, title: t.title, error: t.error, loading: wc?.isLoading() ?? false, canGoBack: wc?.navigationHistory.canGoBack() ?? false, canGoForward: wc?.navigationHistory.canGoForward() ?? false }
    }), active: Object.fromEntries(this.active) }
  }
  private emit(): void {
    if (!this.stopped && !this.win.webContents.isDestroyed()) this.win.webContents.send('browser:state', this.snapshot())
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
    if (this.stopped) throw new Error('Browser is shutting down')
    if (this.tabs.size >= 100) throw new Error('Close a browser tab before opening more (limit 100)')
    const t: Tab = { id: randomUUID(), workspaceId, projectId: w.projectId, url: normalized, title: '', error: null, logs: [], used: Date.now(), busy: 0 }
    this.tabs.set(t.id, t)
    this.active.set(workspaceId, t.id)
    this.materialize(t)
    this.applyLayout()
    this.emit()
    return this.snapshot().tabs.find((x) => x.id === t.id)!
  }
  private materialize(t: Tab): WebContentsView {
    t.used = Date.now()
    if (t.view) {
      const wc = t.view.webContents
      if (!wc || wc.isDestroyed()) throw new Error('Browser tab is closing')
      return t.view
    }
    const ses = session.fromPartition(browserPartition(t.projectId, isDevelopmentRuntime()))
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    this.attachView(t, view)
    void view.webContents.loadURL(t.url).catch(() => {})
    return view
  }
  private attachView(t: Tab, view: WebContentsView): void {
    t.view = view
    t.presented = false
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 })
    view.setVisible(false)
    this.background.contentView.addChildView(view)
    view.setVisible(true)
    const wc = view.webContents
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
      if (this.tabs.has(t.id) && !this.stopped) this.close(t.workspaceId, t.id)
    })
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.control || input.alt) return
      const chord = matchBrowserShortcut(input.key, input.meta, input.shift) ?? matchChord(input.key, input.meta, input.shift)
      if (chord) { event.preventDefault(); this.win.webContents.focus(); this.win.webContents.send('browser:shortcut', chord) }
    })
    const update = (): void => {
      if (wc.isDestroyed()) return
      t.url = wc.getURL() || t.url
      t.title = wc.getTitle()
      this.emit()
    }
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-stop-loading', 'page-title-updated'] as const) wc.on(event as 'did-navigate', update)
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
      if (t.view && (!t.view.webContents || t.view.webContents.isDestroyed())) continue
      const shown = !!l?.visible && l.workspaceId === t.workspaceId && this.active.get(t.workspaceId) === t.id
      const view = shown ? this.materialize(t) : t.view
      if (!view) continue
      if (shown && l) {
        const x = Math.max(0, Math.min(width - 1, Math.round(l.x)))
        const y = Math.max(0, Math.min(height - 1, Math.round(l.y)))
        view.setBounds({ x, y, width: Math.max(1, Math.min(width - x, Math.round(l.width))), height: Math.max(1, Math.min(height - y, Math.round(l.height))) })
      }
      // Agent leases affect eviction, never presentation. Only user panel
      // changes transfer pages between the visible and hidden hosts.
      if (shown !== t.presented) {
        if (shown) this.win.contentView.addChildView(view)
        else this.background.contentView.addChildView(view)
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
    t.view = undefined
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    if (!this.background.isDestroyed()) this.background.contentView.removeChildView(view)
    if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
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
    try { wc = this.materialize(t).webContents } catch (err) { t.busy--; throw err }
    this.applyLayout()
    let released = false
    return { wc, release: () => { if (!released) { released = true; t.busy--; this.applyLayout() } } }
  }
  async command(workspaceId: string, id: string, action: string, value?: string): Promise<unknown> {
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
