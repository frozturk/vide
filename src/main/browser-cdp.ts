export interface CdpPage {
  tabId: string
  targetId: string
  sessionId: string
  openerId?: string
  attached: boolean
  info: () => { url: string; title: string }
}

/** Only the requested tab and its popup descendants are exposed to a client. */
export class PaneCdp {
  private pages = new Map<string, CdpPage>()
  private discover = false
  private autoAttach = false
  constructor(private rootId: string, private emit: (value: unknown) => void) {}

  add(tabId: string, targetId: string, info: CdpPage['info'], openerId?: string): CdpPage {
    if (tabId !== this.rootId && (!openerId || !this.pages.has(openerId))) throw new Error('Popup opener is outside this connection')
    const page = { tabId, targetId, info, openerId, sessionId: `vide-session-${tabId}`, attached: false }
    this.pages.set(tabId, page)
    if (this.discover) this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.target(page) } })
    if (this.autoAttach) this.attach(page)
    return page
  }
  remove(tabId: string): void {
    const page = this.pages.get(tabId)
    if (!page) return
    this.detach(page)
    this.pages.delete(tabId)
    this.emit({ method: 'Target.targetDestroyed', params: { targetId: page.targetId } })
  }
  target(page: CdpPage) {
    const opener = page.openerId ? this.pages.get(page.openerId) : undefined
    return { ...page.info(), targetId: page.targetId, type: 'page', browserContextId: `context-${this.rootId}`, attached: page.attached, canAccessOpener: !!opener, ...(opener ? { openerId: opener.targetId } : {}) }
  }
  pageForSession(sessionId?: string): CdpPage {
    const page = sessionId ? [...this.pages.values()].find((p) => p.sessionId === sessionId) : this.pages.get(this.rootId)
    if (!page) throw new Error('Session is outside this connection')
    return page
  }
  private byTarget(targetId: string): CdpPage {
    const page = [...this.pages.values()].find((p) => p.targetId === targetId)
    if (!page) throw new Error('Target is outside this connection')
    return page
  }
  event(page: CdpPage, method: string, params: unknown): void {
    if (page.attached) this.emit({ method, params, sessionId: page.sessionId })
  }
  changed(page: CdpPage): void {
    if (this.discover || page.attached) this.emit({ method: 'Target.targetInfoChanged', params: { targetInfo: this.target(page) } })
  }
  private attach(page: CdpPage): void {
    if (page.attached) return
    page.attached = true
    this.emit({ method: 'Target.attachedToTarget', params: { sessionId: page.sessionId, targetInfo: this.target(page), waitingForDebugger: false } })
  }
  private detach(page: CdpPage): void {
    if (!page.attached) return
    page.attached = false
    this.emit({ method: 'Target.detachedFromTarget', params: { sessionId: page.sessionId, targetId: page.targetId } })
  }
  command(method: string, params: any, sessionId: string | undefined, close: (tabId: string) => void, select: (tabId: string) => void): { result: unknown } | null {
    const ok = (result: unknown = {}) => ({ result })
    switch (method) {
      case 'Target.getTargets': return ok({ targetInfos: [...this.pages.values()].map((p) => this.target(p)) })
      case 'Target.getTargetInfo': return ok({ targetInfo: this.target(params?.targetId ? this.byTarget(params.targetId) : this.pageForSession(sessionId)) })
      case 'Target.getBrowserContexts': return ok({ browserContextIds: [] })
      case 'Target.setDiscoverTargets':
        this.discover = !!params?.discover
        if (this.discover) for (const page of this.pages.values()) this.emit({ method: 'Target.targetCreated', params: { targetInfo: this.target(page) } })
        return ok()
      case 'Target.setAutoAttach':
        // Playwright also requests auto-attach on each page for OOPIFs. Popup
        // targets belong to this browser connection, not nested page sessions.
        if (sessionId) return ok()
        this.autoAttach = !!params?.autoAttach
        for (const page of this.pages.values()) this.autoAttach ? this.attach(page) : this.detach(page)
        return ok()
      case 'Target.attachToTarget': {
        const page = this.byTarget(params?.targetId)
        this.attach(page)
        return ok({ sessionId: page.sessionId })
      }
      case 'Target.activateTarget': select(this.byTarget(params?.targetId).tabId); return ok()
      case 'Target.detachFromTarget': this.detach(params?.sessionId ? this.pageForSession(params.sessionId) : this.byTarget(params?.targetId)); return ok()
      case 'Target.closeTarget': close(this.byTarget(params?.targetId).tabId); return ok({ success: true })
      case 'Target.createTarget': throw new Error('Open unrelated tabs through the Vide browser API')
      case 'Browser.setDownloadBehavior': return ok()
      case 'Browser.getWindowForTarget': return ok({ windowId: 1, bounds: { left: 0, top: 0, width: 1200, height: 800, windowState: 'normal' } })
      case 'Browser.getVersion': return null
    }
    if (method.startsWith('Target.') || method.startsWith('Browser.')) throw new Error(`Unsupported pane command: ${method}`)
    return null
  }
}
