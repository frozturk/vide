import { BrowserWindow, WebContentsView, session, shell } from 'electron'
import { matchChord } from '../shared/chords'

const BAR_HEIGHT = 40

let win: BrowserWindow | null = null
let view: WebContentsView | null = null
let getDefaultUrl: () => string = () => 'about:blank'

export function initBrowser(w: BrowserWindow, defaultUrl: () => string): void {
  win = w
  getDefaultUrl = defaultUrl
  w.on('resize', layout)
}

function layout(): void {
  if (!win || !view) return
  const [w, h] = win.getContentSize()
  const x = Math.ceil(w / 3)
  view.setBounds({ x, y: BAR_HEIGHT, width: w - x, height: h - BAR_HEIGHT })
}

function sendState(): void {
  if (!win || !view) return
  const wc = view.webContents
  win.webContents.send('browser:state', {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack()
  })
}

function ensureView(): WebContentsView {
  if (view) return view
  view = new WebContentsView({
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
  wc.on('will-navigate', (e, url) => {
    if (!/^(https?|about|devtools):/.test(url)) e.preventDefault()
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
  win!.contentView.addChildView(view)
  layout()
  view.setVisible(false)
  wc.loadURL(getDefaultUrl()).catch(() => {})
  return view
}

export function setBrowserVisible(visible: boolean, focusPage: boolean): void {
  if (!visible && !view) return
  const v = ensureView()
  v.setVisible(visible)
  if (visible) {
    layout()
    if (focusPage) v.webContents.focus()
  } else {
    win?.webContents.focus()
  }
}

export function browserLoadUrl(url: string): void {
  ensureView().webContents.loadURL(url).catch(() => {})
}

export function browserBack(): void {
  view?.webContents.navigationHistory.goBack()
}

export function browserReload(): void {
  view?.webContents.reload()
}
