import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserManager } from './browser'

const mocks = vi.hoisted(() => ({ views: [] as any[], hosts: [] as any[], failAttach: false }))
vi.mock('fs', () => ({ readFileSync: vi.fn(), writeFileSync: vi.fn(), renameSync: vi.fn() }))
vi.mock('./state', () => ({ loadState: async () => ({ workspaces: [{ id: 'workspace', projectId: 'project' }] }) }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('events')
  class Contents extends EventEmitter {
    destroyed = false
    url = ''
    title = ''
    navigationHistory = { canGoBack: () => this.check(false), canGoForward: () => this.check(false) }
    isDestroyed(): boolean { return this.destroyed }
    check<T>(value: T): T {
      if (this.destroyed) throw new TypeError('Object has been destroyed')
      return value
    }
    isLoading(): boolean { return this.check(false) }
    getURL(): string { return this.check(this.url) }
    getTitle(): string { return this.check(this.title) }
    setWindowOpenHandler = vi.fn()
    loadURL = vi.fn(async (url: string) => { this.url = this.check(url) })
    reload = vi.fn(() => this.check(undefined))
    executeJavaScript = vi.fn(async () => this.check('page result'))
    close = vi.fn(() => {
      this.destroyed = true
      this.emit('destroyed')
    })
  }
  class View {
    contents = new Contents()
    options: unknown
    constructor(options: unknown) { this.options = options; mocks.views.push(this) }
    get webContents(): Contents { return this.contents.check(this.contents) }
    setBounds = vi.fn(() => this.contents.check(undefined))
    setVisible = vi.fn(() => this.contents.check(undefined))
  }
  class Host {
    destroyed = false
    contents = new Contents()
    children = new Set<View>()
    contentView = {
      addChildView: vi.fn((view: View) => {
        if (this.destroyed || mocks.failAttach) throw new TypeError('Object has been destroyed')
        view.contents.check(undefined)
        for (const host of mocks.hosts) host.children.delete(view)
        this.children.add(view)
      }),
      removeChildView: vi.fn((view: View) => { view.contents.check(undefined); this.children.delete(view) })
    }
    constructor() { mocks.hosts.push(this) }
    get webContents(): Contents { if (this.destroyed) throw new TypeError('Object has been destroyed'); return this.contents }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void { this.destroyed = true }
  }
  return {
    app: { getPath: () => '/tmp/vide-browser-test' },
    BaseWindow: Host,
    WebContentsView: View,
    session: { fromPartition: (partition: string) => ({ partition, setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn() }) }
  }
})

let browser: BrowserManager
let win: any
beforeEach(() => {
  vi.useFakeTimers()
  mocks.views.length = 0
  mocks.hosts.length = 0
  mocks.failAttach = false
  let destroyed = false
  const renderer = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: vi.fn() })
  win = {
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true },
    get webContents() { if (destroyed) throw new TypeError('Object has been destroyed'); return renderer },
    getContentSize: () => [1400, 900],
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn((view) => view.contents.check(undefined)) }
  }
  browser = new BrowserManager(win as BrowserWindow)
})
afterEach(() => { mocks.failAttach = false; browser.stop(); vi.useRealTimers() })

describe('browser recovery', () => {
  it('opens and lists tabs while another native view is destroyed before its event runs', async () => {
    const first = await browser.open('workspace', 'https://example.com')
    const dead = mocks.views[0].contents
    dead.destroyed = true
    // Electron may invalidate the native wrapper before notifying listeners.
    const next = await browser.open('workspace', 'https://example.org')
    expect(browser.snapshot().tabs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, loading: false, canGoBack: false }),
      expect.objectContaining({ id: next.id })
    ]))
    dead.emit('destroyed')
    expect(browser.snapshot().tabs.map((tab) => tab.id)).toEqual([next.id])
  })

  it('closes a destroyed view without passing it to native removal methods', async () => {
    const tab = await browser.open('workspace')
    mocks.views[0].contents.destroyed = true
    expect(() => browser.close('workspace', tab.id)).not.toThrow()
    expect(browser.snapshot().tabs).toEqual([])
    expect(win.contentView.removeChildView).not.toHaveBeenCalled()
  })

  it('rebuilds a broken tab at its saved URL and ignores delayed events from the old view', async () => {
    const tab = await browser.open('workspace', 'https://example.com/path')
    const oldView = mocks.views[0]
    oldView.contents.destroyed = true
    const closed = vi.fn()
    browser.events.on('tab-closed', closed)
    const result = await browser.command('workspace', tab.id, 'recover')
    const newView = mocks.views[1]
    expect(result).toMatchObject({ tabs: [expect.objectContaining({ id: tab.id, url: tab.url, error: null })] })
    expect(newView.contents.loadURL).toHaveBeenCalledWith(tab.url)
    expect(newView.options.webPreferences.session.partition).toBe(oldView.options.webPreferences.session.partition)
    expect(closed).toHaveBeenCalledWith({ workspaceId: 'workspace', tabId: tab.id })
    oldView.contents.emit('destroyed')
    expect(await browser.command('workspace', tab.id, 'eval')).toBe('page result')
    expect(browser.snapshot().tabs).toHaveLength(1)
  })

  it('disconnects leases during recovery without recreating the visible tab twice', async () => {
    const tab = await browser.open('workspace')
    browser.setLayout({ workspaceId: 'workspace', visible: true, x: 0, y: 0, width: 800, height: 600 })
    const lease = browser.acquire('workspace', tab.id)
    lease.wc.once('destroyed', lease.release)
    browser.events.on('tab-closed', lease.release)
    await browser.command('workspace', tab.id, 'recover')
    expect(mocks.views).toHaveLength(2)
    expect(win.contentView.addChildView).toHaveBeenLastCalledWith(mocks.views[1])
    expect(await browser.command('workspace', tab.id, 'eval')).toBe('page result')
  })

  it('recreates a lost background host and reparents its living pages', async () => {
    const first = await browser.open('workspace')
    mocks.hosts[0].destroy()
    const next = await browser.open('workspace')
    expect(mocks.hosts).toHaveLength(2)
    expect(mocks.hosts[1].children).toEqual(new Set(mocks.views))
    expect(browser.snapshot().tabs.map((tab) => tab.id)).toEqual([first.id, next.id])
  })

  it('rolls back failed opens so retries do not accumulate ghost tabs', async () => {
    const tab = await browser.open('workspace')
    mocks.failAttach = true
    await expect(browser.open('workspace')).rejects.toThrow('Object has been destroyed')
    expect(browser.snapshot()).toMatchObject({ tabs: [expect.objectContaining({ id: tab.id })], active: { workspace: tab.id } })
    expect(mocks.views[1].contents.close).toHaveBeenCalledOnce()
    mocks.failAttach = false
    await expect(browser.open('workspace')).resolves.toHaveProperty('id')
  })

  it('rejects recovery across workspaces and after shutdown', async () => {
    const tab = await browser.open('workspace')
    await expect(browser.command('other', tab.id, 'recover')).rejects.toThrow('not found in workspace')
    browser.stop()
    await expect(browser.command('workspace', tab.id, 'recover')).rejects.toThrow('shutting down')
    expect(mocks.views).toHaveLength(1)
  })

  it('does not read a destroyed app window while handling pending tab events', async () => {
    await browser.open('workspace')
    win.destroy()
    expect(() => mocks.views[0].contents.emit('did-stop-loading')).not.toThrow()
    await expect(browser.open('workspace')).rejects.toThrow('shutting down')
  })
})
