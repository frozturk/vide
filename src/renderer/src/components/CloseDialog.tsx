import { useState } from 'react'
import { closeDialog, confirmDeleteWorkspace } from '../actions'
import { useStore } from '../store'

export function CloseDialog(): React.JSX.Element | null {
  const dialog = useStore((s) => s.dialog)
  const workspace = useStore((s) => dialog?.kind === 'delete-workspace' ? s.workspaces.find((w) => w.id === dialog.workspaceId) : null)
  const [confirmation, setConfirmation] = useState('')
  const [deleteBranch, setDeleteBranch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (dialog?.kind !== 'delete-workspace' || !workspace) return null
  const risky = dialog.dirty || dialog.hasOwnCommits
  const hasOwnCommits = dialog.hasOwnCommits
  const allowed = !risky || confirmation === workspace.name

  async function remove(): Promise<void> {
    if (!allowed || busy) return
    setBusy(true)
    try {
      await confirmDeleteWorkspace(risky, hasOwnCommits ? deleteBranch : true)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={closeDialog}>
    <div className="w-[480px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
      <div className="border-b border-zinc-800 px-6 py-4 text-base font-semibold text-zinc-100">Delete Workspace</div>
      <div className="space-y-3 px-6 py-5 text-sm text-zinc-300">
        <p>Remove <span className="font-medium text-zinc-100">{workspace.name}</span> and stop all of its terminals?</p>
        {dialog.dirty && <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">Uncommitted changes will be permanently lost.</div>}
        {dialog.hasOwnCommits && <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs text-zinc-400"><input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} />Also delete branch <span className="font-mono text-zinc-300">{workspace.branch}</span></label>}
        {risky && <div><label className="mb-1 block text-xs text-zinc-500">Type <span className="font-mono text-zinc-300">{workspace.name}</span> to confirm</label><input autoFocus value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:outline-none" /></div>}
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-6 py-4"><button onClick={closeDialog} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button><button onClick={() => void remove()} disabled={!allowed || busy} className="rounded-lg bg-red-950/50 px-4 py-2 text-sm font-medium text-red-400 disabled:opacity-40">{busy ? 'Deleting…' : 'Delete Workspace'}</button></div>
    </div>
  </div>
}
