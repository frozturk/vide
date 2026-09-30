import { useRef, useState } from 'react'
import { openSpawnDialog, panelHoverEnter, panelHoverLeave, requestDeleteWorkspace, selectAgent, selectWorkspace, togglePanelPinned } from '../actions'
import { useStore } from '../store'
import { sidebarWorkspaces, terminalNavigation, workspaceNavigation } from '../workspaceNavigation'
import type { AgentStatus, Workspace } from '../../../shared/types'
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, RAIL_WIDTH } from '../../../shared/layout'
import { Resizer } from './Resizer'

export const STATUS_COLOR: Record<AgentStatus, string> = { busy: '#4ade80', waiting: '#f59e0b', idle: '#52525b', exited: '#ef4444' }

function workspaceStatus(workspace: Workspace, agents: ReturnType<typeof useStore.getState>['agents'], statuses: Record<string, AgentStatus>): AgentStatus {
  const values = agents.filter((a) => a.workspaceId === workspace.id).map((a) => statuses[a.id] ?? 'idle')
  if (values.includes('waiting')) return 'waiting'
  if (values.includes('busy')) return 'busy'
  if (values.length && values.every((v) => v === 'exited')) return 'exited'
  return 'idle'
}

export function AgentStrip(): React.JSX.Element | null {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const agents = useStore((s) => s.agents)
  const statuses = useStore((s) => s.statuses)
  const unread = useStore((s) => s.unread)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const selectedId = useStore((s) => s.selectedId)
  const pinned = useStore((s) => s.panelPinned)
  const panelWidth = useStore((s) => s.panelWidth)
  const open = useStore((s) => s.panelPinned || s.panel !== 'closed')
  const [resizing, setResizing] = useState(false)
  const compact = useStore((s) => s.compact)
  if (compact) return <CompactDrawer />
  if (!projects.length) return null

  const navigation = workspaceNavigation(projects, workspaces, agents)
  const listed = sidebarWorkspaces(projects, workspaces, agents)
  const railAgents = terminalNavigation(navigation, agents)
  const projectByWorkspace = new Map(navigation.map((w) => [w.id, w.projectId]))
  const visible = projects.filter((p) => listed.some((w) => w.projectId === p.id))

  return <>
    <div className="fixed left-0 z-50 flex flex-col items-center bg-zinc-900 pt-3" style={{ width: RAIL_WIDTH, top: 'var(--toolbar-h)', bottom: 0 }} onMouseEnter={panelHoverEnter} onMouseLeave={panelHoverLeave}>
      {railAgents.map((agent, index) => {
        const status = statuses[agent.id] ?? 'idle'
        const previous = railAgents[index - 1]
        const newProject = previous && projectByWorkspace.get(previous.workspaceId) !== projectByWorkspace.get(agent.workspaceId)
        const selected = agent.id === selectedId
        return <button key={agent.id} onClick={(event) => { selectAgent(agent.id, 'click'); event.currentTarget.blur() }} aria-label={`${agent.title}: ${status}`} className="relative flex w-full items-center justify-center py-3" style={{ marginTop: newProject ? 10 : 0, borderRadius: '0 6px 6px 0', background: selected ? 'rgba(255,255,255,0.08)' : 'transparent' }} title={`${agent.title} · ${status}`}><span className={status === 'busy' ? 'animate-pulse' : ''} style={{ width: 8, height: 8, borderRadius: 9999, background: STATUS_COLOR[status], boxShadow: unread[agent.id] ? '0 0 0 1.5px white' : '0 0 0 1px rgba(255,255,255,0.2)' }} /></button>
      })}
    </div>
    <div className={`fixed z-40 flex flex-col border-r border-zinc-800 bg-zinc-950/95 backdrop-blur ${resizing ? '' : 'transition-transform duration-150'} ${open ? 'translate-x-0' : '-translate-x-full'}`} style={{ top: 'var(--toolbar-h)', bottom: 0, left: RAIL_WIDTH, width: panelWidth }} onMouseEnter={panelHoverEnter} onMouseLeave={panelHoverLeave}>
      <div className="flex items-center justify-between gap-1 px-4 pb-2 pt-3"><span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Workspaces</span><button onClick={togglePanelPinned} title={pinned ? 'Unpin workspace navigation' : 'Keep workspace navigation open'} aria-label={pinned ? 'Unpin workspace navigation' : 'Pin workspace navigation'} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${pinned ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'}`}><svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 2 6 0-1 4 2 2H4l2-2-1-4Z"/><path d="M8 8v6"/></svg></button></div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-3">
        {visible.map((project) => <div key={project.id} className="mb-3">
          <div className="mb-1 truncate px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500" title={project.rootPath}>{project.name}</div>
          {listed.filter((w) => w.projectId === project.id).map((workspace) => {
            const index = navigation.findIndex((w) => w.id === workspace.id)
            const status = workspaceStatus(workspace, agents, statuses)
            const count = agents.filter((a) => a.workspaceId === workspace.id).length
            const hasUnread = agents.some((a) => a.workspaceId === workspace.id && unread[a.id])
            return <button key={workspace.id} onClick={() => selectWorkspace(workspace.id, 'click')} className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/[0.04] ${workspace.id === selectedWorkspaceId ? 'bg-white/[0.07]' : ''}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'busy' ? 'animate-pulse' : ''}`} style={{ background: STATUS_COLOR[status], boxShadow: hasUnread ? '0 0 0 1.5px white' : undefined }} />
              <span className="min-w-0 flex-1 truncate text-zinc-200">{workspace.kind === 'main' ? 'Main' : workspace.name}</span>
              {count > 0 && <span className="text-[10px] text-zinc-600">{count}</span>}
              {workspace.kind === 'worktree' && <span role="button" title="Delete workspace" onClick={(e) => { e.stopPropagation(); void requestDeleteWorkspace(workspace.id) }} className="opacity-0 text-zinc-600 hover:text-red-400 group-hover:opacity-100">×</span>}
              {index >= 0 && index < 9 && <kbd className="rounded border border-zinc-700/60 px-1 text-[10px] text-zinc-600">⌘{index + 1}</kbd>}
            </button>
          })}
        </div>)}
      </div>
      <div className="overflow-hidden border-t border-zinc-800 p-2"><button onClick={() => useStore.setState({ settingsOpen: true })} className="w-full truncate rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800">Settings</button></div>
      <Resizer onStart={() => { setResizing(true); panelHoverEnter() }} onDrag={(clientX) => { const width = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, clientX - RAIL_WIDTH)); localStorage.setItem('panelWidth', String(width)); useStore.setState({ panelWidth: width }) }} onEnd={() => setResizing(false)} style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 8 }} />
    </div>
  </>
}

function CompactDrawer(): React.JSX.Element {
  const projects = useStore((s) => s.projects)
  const workspaces = useStore((s) => s.workspaces)
  const agents = useStore((s) => s.agents)
  const statuses = useStore((s) => s.statuses)
  const unread = useStore((s) => s.unread)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const open = useStore((s) => s.drawerOpen)
  const [drag, setDrag] = useState(0)
  const startX = useRef<number | null>(null)
  const listed = sidebarWorkspaces(projects, workspaces, agents)
  const visible = projects.filter((p) => listed.some((w) => w.projectId === p.id))
  const close = (): void => useStore.setState({ drawerOpen: false })

  return <>
    <div onClick={close} className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
    <aside
      aria-hidden={!open}
      className={`fixed bottom-0 left-0 top-0 z-50 flex flex-col border-r border-zinc-800/80 bg-zinc-950 shadow-2xl ${drag ? '' : 'transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]'}`}
      style={{ width: 'min(85vw, 320px)', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', transform: open ? `translateX(${Math.min(0, drag)}px)` : 'translateX(-100%)' }}
      onTouchStart={(e) => { startX.current = e.touches[0].clientX }}
      onTouchMove={(e) => { if (startX.current !== null) setDrag(Math.min(0, e.touches[0].clientX - startX.current)) }}
      onTouchEnd={() => { if (drag < -70) close(); startX.current = null; setDrag(0) }}
    >
      <div className="flex h-14 shrink-0 items-center justify-between px-5">
        <span className="text-[13px] font-semibold uppercase tracking-wider text-zinc-500">Workspaces</span>
        <button onClick={() => { close(); openSpawnDialog() }} className="flex h-9 items-center gap-1.5 rounded-full bg-zinc-100 px-3.5 text-[13px] font-semibold text-zinc-900 transition active:scale-95">
          <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {visible.length === 0 && <div className="px-2 py-6 text-sm text-zinc-600">No projects yet.</div>}
        {visible.map((project) => <div key={project.id} className="mb-4">
          <div className="mb-1 truncate px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">{project.name}</div>
          {listed.filter((w) => w.projectId === project.id).map((workspace) => {
            const status = workspaceStatus(workspace, agents, statuses)
            const count = agents.filter((a) => a.workspaceId === workspace.id).length
            const hasUnread = agents.some((a) => a.workspaceId === workspace.id && unread[a.id])
            const active = workspace.id === selectedWorkspaceId
            return <button key={workspace.id} onClick={() => selectWorkspace(workspace.id, 'click')} className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] transition active:scale-[0.98] ${active ? 'bg-white/[0.08] text-zinc-50' : 'text-zinc-300 active:bg-white/[0.05]'}`}>
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status === 'busy' ? 'animate-pulse' : ''}`} style={{ background: STATUS_COLOR[status], boxShadow: hasUnread ? '0 0 0 2px #09090b, 0 0 0 3.5px white' : undefined }} />
              <span className="min-w-0 flex-1 truncate">{workspace.kind === 'main' ? 'Main' : workspace.name}</span>
              {count > 0 && <span className="rounded-full bg-zinc-800/80 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">{count}</span>}
            </button>
          })}
        </div>)}
      </div>
      <div className="shrink-0 border-t border-zinc-800/80 p-3">
        <button onClick={() => { close(); useStore.setState({ settingsOpen: true }) }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-zinc-400 transition active:bg-zinc-800">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" strokeLinecap="round" /></svg>
          Settings
        </button>
      </div>
    </aside>
  </>
}
