import { BrowserWindow, Menu, app, dialog, shell } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import type { MenuItemConstructorOptions } from 'electron'
import { getConfig } from './config'
import { wireIpc } from './ipc'
import { initBrowser } from './browser'
import { liveCount, setTarget, detachAll, beginShutdown, startTitlePoller, reapOrphanSessions, sessionName } from './pty'
import { loadSession } from './session'

function probePath(shellPath: string): Promise<void> {
  return new Promise((resolve) => {
    execFile(shellPath, ['-ilc', 'printf %s "$PATH"'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout.trim()) process.env.PATH = stdout.trim()
      resolve()
    })
  })
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] }
  ]
  return Menu.buildFromTemplate(template)
}

let confirmedQuit = false

async function createWindow(): Promise<void> {
  const cfg = getConfig()
  await probePath(cfg.shell ?? process.env.SHELL ?? '/bin/zsh')
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#09090b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })
  setTarget(win.webContents)
  wireIpc(win)
  initBrowser(win, () => getConfig().defaultBrowserUrl)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  let confirming = false
  win.on('close', (e) => {
    const n = liveCount()
    if (confirmedQuit || n === 0) return
    e.preventDefault()
    if (confirming) return
    confirming = true
    dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `${n} agent${n > 1 ? 's' : ''} still running — quit and keep them in background?`
      })
      .then(({ response }) => {
        confirming = false
        if (response === 0) {
          confirmedQuit = true
          beginShutdown()
          detachAll()
          win.close()
        }
      })
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu())
  startTitlePoller()
  const saved = loadSession()
  const keep = new Set(saved.filter((s) => s.id).map((s) => sessionName(s.id, s.kindId, s.cwd)))
  await reapOrphanSessions(keep)
  await createWindow()
})

app.on('will-quit', () => {
  beginShutdown()
  detachAll()
})
app.on('window-all-closed', () => app.quit())
