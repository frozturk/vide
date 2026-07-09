import { BrowserWindow, WebContentsView, session, shell } from 'electron'
import { matchChord } from '../shared/chords'
import { BROWSER_TOP, DEFAULT_PANE_FRACTION } from '../shared/layout'

interface Tab {
  id: number
  view: WebContentsView
}

let win: BrowserWindow | null = null
let tabs: Tab[] = []
let activeId: number | null = null
let visible = false
let dragging = false
let widthFraction = DEFAULT_PANE_FRACTION
let nextId = 1
let getDefaultUrl: () => string = () => 'about:blank'

export function initBrowser(w: BrowserWindow, defaultUrl: () => string): void {
  win = w
  getDefaultUrl = defaultUrl
  w.on('resize', layout)
}

function activeTab(): Tab | null {
  return tabs.find((t) => t.id === activeId) ?? null
}

function layout(): void {
  if (!win) return
  const t = activeTab()
  if (!t) return
  const [w, h] = win.getContentSize()
  const x = Math.round(w * (1 - widthFraction))
  t.view.setBounds({ x, y: BROWSER_TOP, width: w - x, height: h - BROWSER_TOP })
}

export function setBrowserSplit(fraction: number): void {
  widthFraction = Math.min(0.85, Math.max(0.2, fraction))
  if (visible && !dragging) layout()
}

export function setBrowserDragging(value: boolean): void {
  dragging = value
  applyVisibility()
  if (!dragging) layout()
}

function applyVisibility(): void {
  for (const t of tabs) t.view.setVisible(visible && !dragging && t.id === activeId)
}

function sendState(): void {
  if (!win) return
  win.webContents.send('browser:state', {
    activeId,
    tabs: tabs.map((t) => {
      const wc = t.view.webContents
      return {
        id: t.id,
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward()
      }
    })
  })
}

function createTab(url: string): Tab {
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition('persist:vide-browser'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const wc = view.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (e, u) => {
    if (!/^(https?|about|devtools):/.test(u)) e.preventDefault()
  })
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.control || input.alt) return
    const chord = matchChord(input.key, input.meta, input.shift)
    if (chord) {
      e.preventDefault()
      win?.webContents.focus()
      win?.webContents.send('shortcut', { chord })
    }
  })
  for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading'] as const) {
    wc.on(ev as 'did-navigate', sendState)
  }
  wc.on('page-title-updated', sendState)
  const tab: Tab = { id: nextId++, view }
  tabs.push(tab)
  win!.contentView.addChildView(view)
  view.setVisible(false)
  wc.loadURL(url).catch(() => {})
  return tab
}

function showActive(focusPage: boolean): void {
  applyVisibility()
  if (!visible) {
    win?.webContents.focus()
    return
  }
  layout()
  if (focusPage) activeTab()?.view.webContents.focus()
}

export function setBrowserVisible(vis: boolean, focusPage: boolean): void {
  if (!vis && tabs.length === 0) return
  visible = vis
  if (vis && tabs.length === 0) {
    const t = createTab(getDefaultUrl())
    activeId = t.id
    sendState()
  }
  showActive(focusPage)
}

export function browserNewTab(): void {
  const t = createTab(getDefaultUrl())
  activeId = t.id
  showActive(false)
  sendState()
}

export function browserOpenUrl(url: string): void {
  visible = true
  const t = createTab(url)
  activeId = t.id
  showActive(true)
  sendState()
}

export function browserCloseTab(id: number): void {
  const idx = tabs.findIndex((t) => t.id === id)
  if (idx === -1) return
  const [closed] = tabs.splice(idx, 1)
  win?.contentView.removeChildView(closed.view)
  closed.view.webContents.close()
  if (activeId === id) activeId = (tabs[idx] ?? tabs[idx - 1] ?? null)?.id ?? null
  showActive(false)
  sendState()
}

export function browserSelectTab(id: number): void {
  if (!tabs.some((t) => t.id === id)) return
  activeId = id
  showActive(true)
  sendState()
}

export function browserLoadUrl(url: string): void {
  const t = activeTab()
  if (t) {
    t.view.webContents.loadURL(url).catch(() => {})
    return
  }
  const created = createTab(url)
  activeId = created.id
  showActive(false)
  sendState()
}

export function browserBack(): void {
  activeTab()?.view.webContents.navigationHistory.goBack()
}

export function browserForward(): void {
  activeTab()?.view.webContents.navigationHistory.goForward()
}

export function browserReload(): void {
  activeTab()?.view.webContents.reload()
}
