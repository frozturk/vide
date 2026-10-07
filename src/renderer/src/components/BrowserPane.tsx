import { useEffect, useRef, useState } from 'react'
import type { BrowserSnapshot } from '../../../shared/types'
import { useStore } from '../store'
import { Resizer } from './Resizer'
import { browserLoadError, type BrowserShortcut } from '../../../shared/browser-shortcuts'
import { dispatch } from '../shortcuts'

const empty: BrowserSnapshot = { tabs: [], active: {} }

export function BrowserPane(): React.JSX.Element | null {
  const workspaceId = useStore((s) => s.selectedWorkspaceId)
  const isWeb = useStore((s) => s.isWeb)
  const open = useStore((s) => s.browserOpen)
  const fraction = useStore((s) => s.browserFraction)
  const obscured = useStore((s) => !!s.dialog || s.settingsOpen || s.paletteOpen || s.overlay !== 'none' || s.drawerOpen || s.panel !== 'closed' || Object.values(s.browserMenus).some(Boolean))
  const [snapshot, setSnapshot] = useState(empty)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const addressInput = useRef<HTMLInputElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const tabs = snapshot.tabs.filter((t) => t.workspaceId === workspaceId)
  const active = tabs.find((t) => t.id === snapshot.active[workspaceId ?? ''])
  const visible = !isWeb && open && !!workspaceId
  const run = (operation: Promise<unknown>): void => { setError(null); void operation.catch((err) => setError(String(err.message ?? err))) }

  useEffect(() => {
    if (isWeb) return
    const receive = (state: BrowserSnapshot): void => { setSnapshot(state); useStore.setState({ browserTabs: state.tabs }) }
    const off = window.vide.onBrowserState(receive)
    const keys = window.vide.onBrowserShortcut(dispatch)
    void window.vide.browserSnapshot().then(receive).catch((err) => setError(String(err)))
    return () => { off(); keys() }
  }, [isWeb])
  useEffect(() => { setAddress(null); setError(null) }, [active?.id, workspaceId])
  useEffect(() => {
    if (isWeb) return
    const update = (): void => {
      const rect = viewport.current?.getBoundingClientRect()
      void window.vide.browserLayout({ workspaceId, visible: visible && !obscured && !dragging && !!active && !active.error, x: rect?.x ?? 0, y: rect?.y ?? 0, width: rect?.width ?? 1, height: rect?.height ?? 1 }).catch(() => {})
    }
    update()
    const observer = new ResizeObserver(update)
    if (viewport.current) observer.observe(viewport.current)
    window.addEventListener('resize', update)
    return () => { observer.disconnect(); window.removeEventListener('resize', update) }
  }, [isWeb, workspaceId, visible, obscured, dragging, active?.id, active?.error, fraction])

  useEffect(() => {
    if (!visible || !workspaceId) return
    const onShortcut = (event: Event): void => {
      const action = (event as CustomEvent<BrowserShortcut>).detail
      if (action === 'browser-address') { addressInput.current?.focus(); addressInput.current?.select() }
      else if (action === 'browser-new-tab') run(window.vide.browserOpen(workspaceId))
      else if (action === 'browser-close-tab' && active) run(window.vide.browserClose(workspaceId, active.id))
      else if (action === 'browser-reload' && active) run(window.vide.browserCommand(workspaceId, active.id, 'reload'))
    }
    window.addEventListener('vide:browser-shortcut', onShortcut)
    return () => window.removeEventListener('vide:browser-shortcut', onShortcut)
  }, [visible, workspaceId, active?.id])

  if (!visible) return null
  const command = (action: string, value?: string): void => { if (active) run(window.vide.browserCommand(workspaceId!, active.id, action, value)) }
  const navigate = (): void => {
    const url = address?.trim()
    if (!url) return
    if (active) command('navigate', url); else run(window.vide.browserOpen(workspaceId!, url))
    setAddress(null)
  }
  return (
    <section data-browser-pane aria-label="Workspace browser" className="fixed bottom-0 right-0 z-10 flex flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl" style={{ top: 'var(--toolbar-h)', width: `${fraction * 100}%` }}>
      <Resizer onStart={() => setDragging(true)} onEnd={() => setDragging(false)} onDrag={(x) => {
        const next = Math.min(0.85, Math.max(0.25, (window.innerWidth - x) / window.innerWidth))
        useStore.setState({ browserFraction: next }); localStorage.setItem('browserFraction', String(next))
      }} style={{ position: 'absolute', top: 0, bottom: 0, left: -4, width: 8 }} />
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-zinc-800 bg-zinc-900 px-2 text-xs">
        {tabs.map((t) => <div key={t.id} className={`flex max-w-44 shrink-0 items-center rounded px-2 py-1 ${t.id === active?.id ? 'bg-zinc-700' : 'text-zinc-400'}`}>
          <button className="truncate" onClick={() => run(window.vide.browserSelect(workspaceId!, t.id))}>{t.title || (t.url === 'about:blank' ? 'New tab' : t.url)}</button>
          <button className="ml-2" aria-label={`Close ${t.title || 'tab'}`} onClick={() => run(window.vide.browserClose(workspaceId!, t.id))}>×</button>
        </div>)}
        <button aria-label="New browser tab" className="px-2" onClick={() => run(window.vide.browserOpen(workspaceId!))}>+</button>
        <button aria-label="Hide browser" className="ml-auto px-2" onClick={() => useStore.setState({ browserOpen: false })}>×</button>
      </div>
      <form className="flex h-9 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-2 text-xs" onSubmit={(e) => { e.preventDefault(); navigate() }}>
        <button type="button" aria-label="Back" disabled={!active?.canGoBack} className="disabled:opacity-30" onClick={() => command('back')}>←</button>
        <button type="button" aria-label="Forward" disabled={!active?.canGoForward} className="disabled:opacity-30" onClick={() => command('forward')}>→</button>
        <button type="button" aria-label="Reload" onClick={() => command('reload')}>↻</button>
        <input ref={addressInput} aria-label="Browser address" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 outline-none focus:ring-1 focus:ring-zinc-500" placeholder="Enter a URL" value={address ?? (active?.url === 'about:blank' ? '' : active?.url) ?? ''} onChange={(e) => setAddress(e.target.value)} onFocus={(e) => e.target.select()} onBlur={() => setAddress(null)} />
        {active?.loading && <span aria-label="Loading" className="animate-pulse">…</span>}
        <button type="button" title="Developer tools" onClick={() => command('devtools')}>⌥</button>
      </form>
      {error && !active?.error && <div role="alert" className="bg-red-950 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div ref={viewport} className="min-h-0 flex-1">
        {active?.error ? <div role="alert" className="p-6 text-sm text-red-300">{browserLoadError(active.error)}<button className="ml-3 underline" onClick={() => command('reload')}>Retry</button></div> : !active && <div className="p-6 text-sm text-zinc-500">Enter a URL or open a local server to start browsing.</div>}
      </div>
    </section>
  )
}
