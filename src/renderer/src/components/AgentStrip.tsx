import { basename } from '../util'
import { panelHoverEnter, panelHoverLeave, selectAgent } from '../actions'
import { useStore } from '../store'
import type { AgentStatus } from '../../../shared/types'
import { AgentIcon } from './AgentIcon'
import { TOOLBAR_HEIGHT } from './TopBar'

const PASTELS = [
  '#a8c5e0', '#c5d6a0', '#e0b8c5', '#a0d6c8',
  '#d6c5a0', '#b8c5e0', '#e0caa0', '#c5a0d6',
  '#a0e0c5', '#d0a0c5', '#a0c5e0', '#cbd0a0'
]

const repoColorCache = new Map<string, { bg: string; bgActive: string; border: string }>()

function repoColor(root: string): { bg: string; bgActive: string; border: string } {
  const cached = repoColorCache.get(root)
  if (cached) return cached
  let hash = 0
  for (let i = 0; i < root.length; i++) {
    hash = ((hash << 5) - hash + root.charCodeAt(i)) | 0
  }
  const base = PASTELS[Math.abs(hash) % PASTELS.length]
  const r = parseInt(base.slice(1, 3), 16)
  const g = parseInt(base.slice(3, 5), 16)
  const b = parseInt(base.slice(5, 7), 16)
  const bg = `rgba(${r}, ${g}, ${b}, 0.10)`
  const bgActive = `rgba(${r}, ${g}, ${b}, 0.16)`
  const border = `rgba(${r}, ${g}, ${b}, 0.9)`
  const result = { bg, bgActive, border }
  repoColorCache.set(root, result)
  return result
}

export const STATUS_COLOR: Record<AgentStatus, string> = {
  busy: '#4ade80',
  waiting: '#f59e0b',
  idle: '#52525b',
  exited: '#ef4444'
}

export function AgentStrip(): React.JSX.Element | null {
  const agents = useStore((s) => s.agents)
  const selectedId = useStore((s) => s.selectedId)
  const statuses = useStore((s) => s.statuses)
  const unread = useStore((s) => s.unread)
  const titles = useStore((s) => s.titles)
  const panel = useStore((s) => s.panel)
  const config = useStore((s) => s.config)
  const open = panel !== 'closed'

  if (agents.length === 0) return null

  const repoCounts = new Map<string, number>()
  for (const a of agents) repoCounts.set(a.projectRoot, (repoCounts.get(a.projectRoot) ?? 0) + 1)

  return (
    <>
      <div
        className="fixed left-0 z-30 flex flex-col items-center bg-zinc-900 pt-3"
        style={{ width: 14, top: TOOLBAR_HEIGHT, bottom: 0 }}
        onMouseEnter={panelHoverEnter}
        onMouseLeave={panelHoverLeave}
      >
        {agents.map((a, i) => {
          const status = statuses[a.id] ?? 'idle'
          const newGroup = i > 0 && a.projectRoot !== agents[i - 1].projectRoot
          const rc = repoColor(a.projectRoot)
          const isSelected = a.id === selectedId
          return (
            <div
              key={a.id}
              className="relative flex w-full items-center justify-center py-3"
              style={{
                marginTop: newGroup ? 10 : 0,
                borderRadius: '0 6px 6px 0',
                background: isSelected ? 'rgba(255,255,255,0.08)' : 'transparent'
              }}
              title={titles[a.id] ?? a.title}
            >
              <button
                onClick={() => selectAgent(a.id, 'click')}
                className={status === 'busy' ? 'animate-pulse' : ''}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  background: STATUS_COLOR[status],
                  boxShadow: unread[a.id] ? '0 0 0 1.5px white' : `0 0 0 1px ${rc.border}`,
                  border: 'none',
                  padding: 0
                }}
              />
            </div>
          )
        })}
      </div>
      <div
        className={`fixed left-0 z-40 flex w-64 flex-col border-r border-zinc-800 bg-zinc-950/95 backdrop-blur transition-transform duration-150 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ top: TOOLBAR_HEIGHT, bottom: 0 }}
        onMouseEnter={panelHoverEnter}
        onMouseLeave={panelHoverLeave}
      >
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Agents
          </span>
          <span className="tabular-nums text-[11px] text-zinc-600">{agents.length}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
          {agents.map((a, i) => {
            const status = statuses[a.id] ?? 'idle'
            const kind = config?.agentKinds.find((k) => k.id === a.kindId) ?? null
            const newGroup = i === 0 || a.projectRoot !== agents[i - 1].projectRoot
            const rc = repoColor(a.projectRoot)
            const isSelected = a.id === selectedId
            return (
              <div key={a.id}>
                {newGroup && (
                  <div className="sticky top-0 z-10 -mx-2 mb-0.5 flex items-center gap-2 bg-zinc-950/95 px-3 pb-1 pt-3 backdrop-blur first:pt-1">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: rc.border }}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide text-zinc-400"
                      title={a.projectRoot}
                    >
                      {basename(a.projectRoot)}
                    </span>
                    <span className="tabular-nums text-[10px] text-zinc-600">
                      {repoCounts.get(a.projectRoot)}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => selectAgent(a.id, 'click')}
                  className="group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/[0.04]"
                  style={{ background: isSelected ? rc.bgActive : undefined }}
                >
                  {isSelected && (
                    <span
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full"
                      style={{ background: rc.border }}
                    />
                  )}
                  <span className="shrink-0" style={{ color: kind?.color ?? '#71717a' }}>
                    <AgentIcon kindId={a.kindId} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-zinc-200">
                      {titles[a.id] ?? a.sessionName}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          status === 'busy' ? 'animate-pulse' : ''
                        }`}
                        style={{ background: STATUS_COLOR[status] }}
                      />
                      <span className="capitalize" style={{ color: STATUS_COLOR[status] }}>
                        {status}
                      </span>
                      {a.worktreePath && (
                        <span className="min-w-0 truncate rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">
                          {basename(a.worktreePath)}
                        </span>
                      )}
                    </span>
                  </span>
                  {unread[a.id] && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                  )}
                  {i < 9 && (
                    <kbd className="shrink-0 rounded border border-zinc-700/60 bg-zinc-800/50 px-1 font-sans text-[10px] leading-tight text-zinc-500">
                      ⌘{i + 1}
                    </kbd>
                  )}
                </button>
              </div>
            )
          })}
        </div>
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={() => useStore.setState({ settingsOpen: true })}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
              <path d="M8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0zm0 12a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 12zM1.373 1.373a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.06l-1.061-1.06a.75.75 0 0 1 0-1.06zm10.073 10.073a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 1 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061zM0 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8zm12 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 12 8zM1.373 14.627a.75.75 0 0 1 0-1.06l1.06-1.061a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0zM11.446 4.554a.75.75 0 0 1 0-1.061l1.06-1.06a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0z" />
            </svg>
            Settings
          </button>
        </div>
      </div>
    </>
  )
}
