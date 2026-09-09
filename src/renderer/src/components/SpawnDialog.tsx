import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { OrphanWorktree, WorktreeBranch } from '../../../shared/types'
import { addTerminal, adoptWorkspace, closeDialog, createWorkspace, spawnFromDialog } from '../actions'
import { selectedWorkspace, useStore } from '../store'
import { basename } from '../util'
import { AgentIcon } from './AgentIcon'

const DIR_LIMIT = 5

function FolderGlyph(): React.JSX.Element {
  return <svg className="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-7.5A1.75 1.75 0 0 0 14.25 4H7.5L5.696 2.293A1.75 1.75 0 0 0 4.477 1.75L4.25 1H1.75z" /></svg>
}

export function SpawnDialog(): React.JSX.Element | null {
  const dialog = useStore((s) => s.dialog)
  if (dialog?.kind === 'spawn') return <NewAgentDialog />
  if (dialog?.kind === 'new-workspace' || dialog?.kind === 'add-terminal') return <WorkspaceDialog mode={dialog.kind} />
  return null
}

function AgentChoices({ kinds, kindId, setKindId }: { kinds: NonNullable<ReturnType<typeof useStore.getState>['config']>['agentKinds']; kindId: string; setKindId: (id: string) => void }): React.JSX.Element {
  return <div className="mb-5 flex flex-wrap gap-2">{kinds.map((kind) => {
    const active = kind.id === kindId
    return <button key={kind.id} onClick={() => setKindId(kind.id)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${active ? 'border-transparent text-white' : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'}`} style={active ? { background: kind.color } : undefined}><span style={active ? { color: '#fff' } : { color: kind.color }}><AgentIcon kindId={kind.id} size={14} /></span>{kind.name}</button>
  })}</div>
}

function DialogFrame({ title, icon, children, footer, onKeyDown }: { title: string; icon?: React.ReactNode; children: React.ReactNode; footer: React.ReactNode; onKeyDown?: React.KeyboardEventHandler }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const frame = ref.current
    if (!frame) return
    // Keep shortcuts available while the name input is disabled, then focus it
    // when ready unless the user has already focused another dialog control.
    if (document.activeElement === frame || !frame.contains(document.activeElement)) {
      const target = frame.querySelector<HTMLInputElement>('input:not(:disabled)') ?? frame
      target.focus()
    }
  })
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={closeDialog}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="flex max-h-[80vh] w-[520px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl outline-none" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}><div className="shrink-0 border-b border-zinc-800 px-6 py-4"><div className="flex items-center gap-2">{icon}<span className="text-base font-semibold text-zinc-100">{title}</span></div></div><div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div><div className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-6 py-4">{footer}</div></div></div>
}

function useWorktreeSupport(dir: string): boolean | null {
  const [result, setResult] = useState<{ dir: string; supported: boolean } | null>(null)
  useEffect(() => {
    let active = true
    if (dir) {
      window.vide.gitRepoRoot(dir).then((root) => {
        if (active) setResult({ dir, supported: !!root })
      }).catch(() => {
        if (active) setResult({ dir, supported: false })
      })
    }
    return () => { active = false }
  }, [dir])
  return !dir ? false : result?.dir === dir ? result.supported : null
}

function useBaseBranch(dir: string) {
  const [result, setResult] = useState<{ dir: string; branches: WorktreeBranch[]; error?: string } | null>(null)
  const [selection, setSelection] = useState<{ dir: string; branch: string } | null>(null)
  useEffect(() => {
    let active = true
    setSelection(null)
    setResult(null)
    if (dir) {
      window.vide.gitWorktreeBranches(dir).then((branches) => {
        if (active) setResult({ dir, branches })
      }).catch(() => {
        if (active) setResult({ dir, branches: [], error: 'Could not load branches. Reopen the dialog to retry.' })
      })
    }
    return () => { active = false }
  }, [dir])
  return {
    branches: result?.dir === dir ? result.branches : [],
    loading: !!dir && result?.dir !== dir,
    error: result?.dir === dir ? result.error : undefined,
    baseBranch: selection?.dir === dir ? selection.branch : '',
    setBaseBranch: (branch: string) => setSelection({ dir, branch })
  }
}

function BaseBranchSelect({ branches, loading, error, baseBranch, setBaseBranch, disabled }: ReturnType<typeof useBaseBranch> & { disabled: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const options = [{ ref: '', name: 'Main workspace’s current HEAD (default)' }, ...branches]
  const selected = options.find((branch) => branch.ref === baseBranch) ?? options[0]
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [open])
  useEffect(() => { if (loading || disabled) setOpen(false) }, [loading, disabled])
  return <div className="mb-4" onBlur={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
  }} onKeyDown={(e) => {
    e.stopPropagation()
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); trigger.current?.focus() }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))
      buttons[next]?.focus()
    }
  }}>
    <span id={`${id}-label`} className="mb-2 block text-xs font-medium uppercase tracking-wider text-zinc-500">Base Branch</span>
    <button ref={trigger} type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onClick={() => setOpen(!open)} disabled={disabled || loading} className="flex w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 disabled:opacity-50">
      <span id={`${id}-value`} className="min-w-0 flex-1 truncate">{loading ? 'Loading branches…' : selected.name}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div ref={list} id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="mt-1 max-h-40 overflow-y-auto overscroll-contain rounded-xl border border-zinc-700 bg-zinc-800 p-1">
      {options.map((branch) => <button key={branch.ref} type="button" role="option" aria-selected={branch.ref === baseBranch} tabIndex={branch.ref === baseBranch ? 0 : -1} title={branch.ref || branch.name} onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest' })} onClick={() => { setBaseBranch(branch.ref); setOpen(false); trigger.current?.focus() }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-700 focus:bg-zinc-700 focus:outline-none aria-selected:text-white">
        <span className="min-w-0 flex-1 truncate">{branch.name}</span>
        {branch.ref && <span className="shrink-0 text-[10px] text-zinc-500">{branch.ref.startsWith('refs/remotes/') ? 'origin' : 'local'}</span>}
        {branch.ref === baseBranch && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
    <span className="mt-1.5 block text-xs text-zinc-500">Local + origin branches · most recent commit first</span>
    {error && <span role="alert" className="mt-1 block text-xs text-red-400">{error}</span>}
  </div>
}

function NewAgentDialog(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const agents = useStore((s) => s.agents)
  const workspaces = useStore((s) => s.workspaces)
  const projects = useStore((s) => s.projects)
  const recentDirs = useStore((s) => s.recentDirs)
  const current = useStore(selectedWorkspace)
  const kinds = config?.agentKinds ?? []
  const currentProject = current ? projects.find((p) => p.id === current.projectId) : null
  const [kindId, setKindId] = useState(agents.find((a) => a.workspaceId === current?.id)?.kindId ?? kinds[0]?.id ?? '')
  const initialDir = useRef(current?.path ?? recentDirs[0]?.path ?? currentProject?.rootPath ?? '')
  const [dir, setDir] = useState(initialDir.current)
  const worktreeSupported = useWorktreeSupport(dir)
  const branchPicker = useBaseBranch(worktreeSupported ? dir : '')
  const [picked, setPicked] = useState<string | null>(null)
  const [worktreeName, setWorktreeName] = useState('')
  const [orphans, setOrphans] = useState<OrphanWorktree[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedKind = kinds.find((k) => k.id === kindId)
  const dirOptions = useMemo(() => [...new Set([initialDir.current, currentProject?.rootPath, picked, ...recentDirs.map((d) => d.path)].filter((p): p is string => !!p))].slice(0, DIR_LIMIT), [currentProject?.rootPath, picked, recentDirs])

  useEffect(() => {
    let active = true
    setOrphans([])
    if (!dir || !worktreeSupported) return
    const livePaths = workspaces.filter((w) => w.kind === 'worktree').map((w) => w.path)
    window.vide.orphanWorktrees(dir, livePaths).then((found) => { if (active) setOrphans(found) }).catch(() => { if (active) setOrphans([]) })
    return () => { active = false }
  }, [dir, workspaces, worktreeSupported])

  useEffect(() => { setWorktreeName('') }, [dir])

  async function launch(adoptPath?: string): Promise<void> {
    if (busy || !kindId || !dir) return
    setBusy(true); setError(null)
    try { await spawnFromDialog(kindId, dir, worktreeSupported ? worktreeName.trim() || undefined : undefined, worktreeSupported ? adoptPath : undefined, branchPicker.baseBranch || undefined) }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : String(err)) }
  }
  async function pickDir(): Promise<void> { const chosen = await window.vide.pickDirectory(); if (chosen) { setPicked(chosen); setDir(chosen) } }
  async function deleteOrphan(path: string): Promise<void> { await window.vide.deleteOrphanWorktree(path); setOrphans((all) => all.filter((x) => x.path !== path)) }

  return <DialogFrame title="New Agent" icon={selectedKind && <span style={{ color: selectedKind.color }}><AgentIcon kindId={selectedKind.id} size={18} /></span>} onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.repeat) { e.preventDefault(); void launch(); return }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && dirOptions.length > 1) { e.preventDefault(); const i = Math.max(0, dirOptions.indexOf(dir)); setDir(dirOptions[(i + (e.key === 'ArrowDown' ? 1 : -1) + dirOptions.length) % dirOptions.length]); return }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && kinds.length > 1) { e.preventDefault(); const i = kinds.findIndex((k) => k.id === kindId); setKindId(kinds[(i + (e.key === 'ArrowRight' ? 1 : -1) + kinds.length) % kinds.length].id) }
  }} footer={<><span className="flex items-center gap-3 text-xs text-zinc-600"><span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5">⏎</kbd> start</span><span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5">←</kbd><kbd className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5">→</kbd> type</span><span><kbd className="rounded bg-zinc-800 px-1.5 py-0.5">↑</kbd><kbd className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5">↓</kbd> folder</span></span><div className="flex gap-2"><button onClick={closeDialog} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button><button onClick={() => void launch()} disabled={busy || !dir || !kindId} className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40">{busy ? 'Starting…' : 'Start Agent'}</button></div></>}>
    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Agent Type</div><AgentChoices kinds={kinds} kindId={kindId} setKindId={setKindId} />
    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Directory</div>
    {dirOptions.length > 0 && <div className="mb-2 overflow-hidden rounded-xl border border-zinc-700">{dirOptions.map((path) => <button key={path} onClick={() => setDir(path)} className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${path === dir ? 'bg-zinc-700/60' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}><FolderGlyph /><span className="shrink-0 text-sm text-zinc-200">{basename(path)}</span>{path === currentProject?.rootPath && <span className="rounded bg-zinc-700 px-1 text-[10px] uppercase text-zinc-300">main</span>}<span className="min-w-0 flex-1 truncate text-right text-xs text-zinc-600">{path}</span></button>)}</div>}
    <button onClick={() => void pickDir()} className="mb-5 flex w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-left hover:border-zinc-600 hover:bg-zinc-800"><FolderGlyph /><span className="text-sm text-zinc-300">Choose another folder…</span></button>
    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Worktree Name <span className="text-zinc-700">(optional — leave empty for none)</span></div>
    <input autoFocus disabled={!worktreeSupported} value={worktreeName} onChange={(e) => setWorktreeName(e.target.value)} placeholder={worktreeSupported === null ? 'Checking Git repository…' : worktreeSupported ? 'e.g. fix-auth-bug' : 'Worktrees require a Git repository'} className="mb-4 w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-700" />
    {worktreeSupported && worktreeName.trim() && <BaseBranchSelect {...branchPicker} disabled={busy} />}
    {worktreeSupported && orphans.length > 0 && <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"><div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Orphan Worktrees</div>{orphans.map((orphan) => <div key={orphan.path} className="flex items-center gap-2 py-1 text-xs"><span className="min-w-0 flex-1 truncate text-zinc-400">{orphan.branch}</span><button onClick={() => void launch(orphan.path)} className="rounded px-2 py-0.5 text-emerald-400 hover:bg-emerald-950/50">adopt</button><button onClick={() => void deleteOrphan(orphan.path)} className="rounded px-2 py-0.5 text-red-400 hover:bg-red-950/50">delete</button></div>)}</div>}
    {error && <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">{error}</div>}
  </DialogFrame>
}

function WorkspaceDialog({ mode }: { mode: 'new-workspace' | 'add-terminal' }): React.JSX.Element {
  const config = useStore((s) => s.config)
  const projects = useStore((s) => s.projects)
  const current = useStore(selectedWorkspace)
  const kinds = config?.agentKinds ?? []
  const [kindId, setKindId] = useState(kinds[0]?.id ?? '')
  const [projectId, setProjectId] = useState(current?.projectId ?? projects[0]?.id ?? '')
  const project = projects.find((p) => p.id === projectId)
  const worktreeSupported = useWorktreeSupport(mode === 'new-workspace' ? project?.rootPath ?? '' : '')
  const branchPicker = useBaseBranch(worktreeSupported ? project?.rootPath ?? '' : '')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm(): Promise<void> { if (busy || (mode === 'new-workspace' && !worktreeSupported)) return; setBusy(true); try { if (mode === 'add-terminal') { await addTerminal(kindId); closeDialog() } else { const launchError = await createWorkspace(projectId, name, kindId, branchPicker.baseBranch || undefined); if (launchError) alert(launchError) } } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : String(err)) } }
  return <DialogFrame title={mode === 'new-workspace' ? 'New Workspace' : `Add Terminal · ${current?.name ?? ''}`} footer={<><span /><div className="flex gap-2"><button onClick={closeDialog} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button><button onClick={() => void confirm()} disabled={busy || !kindId || (mode === 'new-workspace' && (!projectId || !name.trim() || !worktreeSupported))} className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40">{busy ? 'Starting…' : 'Launch'}</button></div></>}>
    {mode === 'new-workspace' && <><div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Project</div><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mb-5 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Workspace Name</div><input autoFocus disabled={!worktreeSupported} value={name} onChange={(e) => setName(e.target.value)} className="mb-5 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 focus:outline-none" /></>}
    {mode === 'new-workspace' && worktreeSupported && <BaseBranchSelect {...branchPicker} disabled={busy} />}
    {mode === 'new-workspace' && project && !worktreeSupported && <div className="mb-4 text-sm text-zinc-400">{worktreeSupported === null ? 'Checking Git repository…' : 'Worktrees require a Git repository. You can add terminals to this folder’s Main workspace.'}</div>}
    <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Agent Type</div><AgentChoices kinds={kinds} kindId={kindId} setKindId={setKindId} />{error && <div className="text-xs text-red-400">{error}</div>}
  </DialogFrame>
}
