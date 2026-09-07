import { panelHoverEnter, panelHoverLeave, requestDeleteWorkspace, selectWorkspace, togglePanelPinned } from '../actions'
import { useStore } from '../store'
import type { AgentStatus, Workspace } from '../../../shared/types'
import { PANEL_WIDTH, RAIL_WIDTH, TOOLBAR_HEIGHT } from '../../../shared/layout'

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
  const pinned = useStore((s) => s.panelPinned)
  const open = useStore((s) => s.panelPinned || s.panel !== 'closed')
  if (!projects.length) return null

  const projectHasAgents = (projectId: string): boolean =>
    agents.some((a) => workspaces.some((w) => w.id === a.workspaceId && w.projectId === projectId))
  const visible = projects.filter((p) => projectHasAgents(p.id))

  return <>
    <div className="fixed left-0 z-50 bg-zinc-900" style={{ width: RAIL_WIDTH, top: TOOLBAR_HEIGHT, bottom: 0 }} onMouseEnter={panelHoverEnter} onMouseLeave={panelHoverLeave} />
    <div className={`fixed z-40 flex flex-col border-r border-zinc-800 bg-zinc-950/95 backdrop-blur transition-transform duration-150 ${open ? 'translate-x-0' : '-translate-x-full'}`} style={{ top: TOOLBAR_HEIGHT, bottom: 0, left: RAIL_WIDTH, width: PANEL_WIDTH }} onMouseEnter={panelHoverEnter} onMouseLeave={panelHoverLeave}>
      <div className="flex items-center justify-between px-4 pb-2 pt-3"><span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Workspaces</span><button onClick={togglePanelPinned} title={pinned ? 'Unpin panel' : 'Keep panel open'} className={`rounded px-1.5 py-0.5 text-[11px] transition ${pinned ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300'}`}>Always on</button></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {visible.map((project) => <div key={project.id} className="mb-3">
          <div className="mb-1 truncate px-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500" title={project.rootPath}>{project.name}</div>
          {workspaces.filter((w) => w.projectId === project.id).map((workspace) => {
            const index = workspaces.findIndex((w) => w.id === workspace.id)
            const status = workspaceStatus(workspace, agents, statuses)
            const count = agents.filter((a) => a.workspaceId === workspace.id).length
            const hasUnread = agents.some((a) => a.workspaceId === workspace.id && unread[a.id])
            return <button key={workspace.id} onClick={() => selectWorkspace(workspace.id, 'click')} className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-white/[0.04] ${workspace.id === selectedWorkspaceId ? 'bg-white/[0.07]' : ''}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'busy' ? 'animate-pulse' : ''}`} style={{ background: STATUS_COLOR[status], boxShadow: hasUnread ? '0 0 0 1.5px white' : undefined }} />
              <span className="min-w-0 flex-1 truncate text-zinc-200">{workspace.kind === 'main' ? 'Main' : workspace.name}</span>
              {count > 0 && <span className="text-[10px] text-zinc-600">{count}</span>}
              {workspace.kind === 'worktree' && <span role="button" title="Delete workspace" onClick={(e) => { e.stopPropagation(); void requestDeleteWorkspace(workspace.id) }} className="opacity-0 text-zinc-600 hover:text-red-400 group-hover:opacity-100">×</span>}
              {index < 9 && <kbd className="rounded border border-zinc-700/60 px-1 text-[10px] text-zinc-600">⌘{index + 1}</kbd>}
            </button>
          })}
        </div>)}
      </div>
      <div className="border-t border-zinc-800 p-2"><button onClick={() => useStore.setState({ settingsOpen: true })} className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800">Settings</button></div>
    </div>
  </>
}
