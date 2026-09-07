import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrphanWorktree } from '../../../shared/types'
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={closeDialog}><div className="w-[520px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}><div className="border-b border-zinc-800 px-6 py-4"><div className="flex items-center gap-2">{icon}<span className="text-base font-semibold text-zinc-100">{title}</span></div></div><div className="px-6 py-5">{children}</div><div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">{footer}</div></div></div>
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
  const [picked, setPicked] = useState<string | null>(null)
  const [worktreeName, setWorktreeName] = useState('')
  const [orphans, setOrphans] = useState<OrphanWorktree[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedKind = kinds.find((k) => k.id === kindId)
  const dirOptions = useMemo(() => [...new Set([initialDir.current, currentProject?.rootPath, picked, ...recentDirs.map((d) => d.path)].filter((p): p is string => !!p))].slice(0, DIR_LIMIT), [currentProject?.rootPath, picked, recentDirs])

  useEffect(() => {
    if (!dir) { setOrphans([]); return }
    const livePaths = workspaces.filter((w) => w.kind === 'worktree').map((w) => w.path)
    window.vide.orphanWorktrees(dir, livePaths).then(setOrphans).catch(() => setOrphans([]))
  }, [dir, workspaces])

  async function launch(adoptPath?: string): Promise<void> {
    if (busy || !kindId || !dir) return
    setBusy(true); setError(null)
    try { await spawnFromDialog(kindId, dir, worktreeName.trim() || undefined, adoptPath) }
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
    <input autoFocus value={worktreeName} onChange={(e) => setWorktreeName(e.target.value)} placeholder="e.g. fix-auth-bug" className="mb-4 w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-700" />
    {orphans.length > 0 && <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"><div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Orphan Worktrees</div>{orphans.map((orphan) => <div key={orphan.path} className="flex items-center gap-2 py-1 text-xs"><span className="min-w-0 flex-1 truncate text-zinc-400">{orphan.branch}</span><button onClick={() => void launch(orphan.path)} className="rounded px-2 py-0.5 text-emerald-400 hover:bg-emerald-950/50">adopt</button><button onClick={() => void deleteOrphan(orphan.path)} className="rounded px-2 py-0.5 text-red-400 hover:bg-red-950/50">delete</button></div>)}</div>}
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
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function confirm(): Promise<void> { setBusy(true); try { if (mode === 'add-terminal') { await addTerminal(kindId); closeDialog() } else { const launchError = await createWorkspace(projectId, name, kindId); if (launchError) alert(launchError) } } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : String(err)) } }
  return <DialogFrame title={mode === 'new-workspace' ? 'New Workspace' : `Add Terminal · ${current?.name ?? ''}`} footer={<><span /><div className="flex gap-2"><button onClick={closeDialog} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800">Cancel</button><button onClick={() => void confirm()} disabled={busy || !kindId || (mode === 'new-workspace' && (!projectId || !name.trim()))} className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 disabled:opacity-40">{busy ? 'Starting…' : 'Launch'}</button></div></>}>
    {mode === 'new-workspace' && <><div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Project</div><select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mb-5 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200">{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Workspace Name</div><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="mb-5 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-200 focus:outline-none" /></>}
    <div className="mb-2 text-xs uppercase tracking-wider text-zinc-500">Agent Type</div><AgentChoices kinds={kinds} kindId={kindId} setKindId={setKindId} />{error && <div className="text-xs text-red-400">{error}</div>}
  </DialogFrame>
}
