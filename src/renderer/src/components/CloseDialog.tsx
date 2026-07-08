import { closeDialog, confirmClose } from '../actions'
import { useStore } from '../store'
import { AgentIcon } from './AgentIcon'

export function CloseDialog(): React.JSX.Element | null {
  const dialog = useStore((s) => s.dialog)
  const agents = useStore((s) => s.agents)
  const config = useStore((s) => s.config)
  if (dialog?.kind !== 'close') return null
  const agent = agents.find((a) => a.id === dialog.agentId)
  if (!agent) return null

  const kind = config?.agentKinds.find((k) => k.id === agent.kindId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={closeDialog}
    >
      <div
        className="w-[480px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            {kind && (
              <span style={{ color: kind.color }}>
                <AgentIcon kindId={kind.id} size={18} />
              </span>
            )}
            <span className="text-base font-semibold text-zinc-100">Close Agent</span>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="mb-1 text-sm text-zinc-300">
            This agent owns worktree{' '}
            <span className="font-mono text-zinc-100">{agent.worktreeBranch}</span>
          </div>
          {dialog.dirty && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.457 1.047c.659-1.135 2.42-1.135 3.079 0l6 10.286c.641 1.097-.19 2.457-1.54 2.457H1.998c-1.349 0-2.18-1.36-1.54-2.457l6-10.286zM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5zm0 6a.875.875 0 1 0 0-1.75.875.875 0 0 0 0 1.75z" />
              </svg>
              It has uncommitted changes — deleting will destroy them.
            </div>
          )}
          {dialog.hasOwnCommits && (
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-500">
              It has its own commits — the branch will be kept either way.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-6 py-4">
          <button
            onClick={closeDialog}
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={() => void confirmClose(true)}
            className="rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-950/60"
          >
            {dialog.dirty ? 'Delete Anyway' : 'Delete Worktree'}
          </button>
          <button
            autoFocus
            onClick={() => void confirmClose(false)}
            className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white"
          >
            Keep Worktree
          </button>
        </div>
      </div>
    </div>
  )
}
