import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrphanWorktree } from '../../../shared/types'
import { closeDialog, spawnAgent } from '../actions'
import { selectedAgent, useStore } from '../store'
import { basename } from '../util'
import { AgentIcon } from './AgentIcon'

const DIR_LIMIT = 5

function FolderGlyph(): React.JSX.Element {
  return (
    <svg className="h-4 w-4 shrink-0 text-zinc-500" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-7.5A1.75 1.75 0 0 0 14.25 4H7.5L5.696 2.293A1.75 1.75 0 0 0 4.477 1.75L4.25 1H1.75z" />
    </svg>
  )
}

export function SpawnDialog(): React.JSX.Element | null {
  const dialog = useStore((s) => s.dialog)
  if (dialog?.kind !== 'spawn') return null
  return <SpawnDialogInner />
}

function SpawnDialogInner(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const agents = useStore((s) => s.agents)
  const recentDirs = useStore((s) => s.recentDirs)
  const current = useStore(selectedAgent)
  const kinds = config?.agentKinds ?? []
  const mainDir = current?.worktreePath ? current.projectRoot : null
  const [kindId, setKindId] = useState(current?.kindId ?? kinds[0]?.id ?? '')
  const initialDir = useRef(current?.cwd ?? recentDirs[0]?.path ?? '')
  const [dir, setDir] = useState(initialDir.current)
  const [picked, setPicked] = useState<string | null>(null)
  const [worktreeName, setWorktreeName] = useState('')
  const [orphans, setOrphans] = useState<OrphanWorktree[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedKind = kinds.find((k) => k.id === kindId)

  const dirOptions = useMemo(() => {
    const pinned = [initialDir.current, mainDir, picked].filter((p): p is string => !!p)
    const recents = recentDirs.map((d) => d.path)
    return [...new Set([...pinned, ...recents])].slice(0, DIR_LIMIT)
  }, [mainDir, recentDirs, picked])

  useEffect(() => {
    if (!dir) {
      setOrphans([])
      return
    }
    const livePaths = agents.map((a) => a.worktreePath).filter((p): p is string => !!p)
    window.vide
      .orphanWorktrees(dir, livePaths)
      .then(setOrphans)
      .catch(() => setOrphans([]))
  }, [dir, agents])

  async function confirm(adoptPath?: string): Promise<void> {
    if (busy || !kindId || !dir) return
    setBusy(true)
    setError(null)
    try {
      await spawnAgent({
        kindId,
        cwd: dir,
        worktreeName: adoptPath ? undefined : worktreeName.trim() || undefined,
        adoptWorktreePath: adoptPath
      })
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function pickDir(): Promise<void> {
    const chosen = await window.vide.pickDirectory()
    if (!chosen) return
    setPicked(chosen)
    setDir(chosen)
  }

  async function deleteOrphan(path: string): Promise<void> {
    await window.vide.deleteOrphanWorktree(path)
    setOrphans((o) => o.filter((x) => x.path !== path))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={closeDialog}>
      <div
        className="w-[520px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.repeat) {
            e.preventDefault()
            void confirm()
            return
          }
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && dirOptions.length > 1) {
            e.preventDefault()
            const idx = Math.max(0, dirOptions.indexOf(dir))
            const delta = e.key === 'ArrowDown' ? 1 : -1
            setDir(dirOptions[(idx + delta + dirOptions.length) % dirOptions.length])
            return
          }
          if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && kinds.length > 1) {
            e.preventDefault()
            const idx = kinds.findIndex((k) => k.id === kindId)
            const delta = e.key === 'ArrowRight' ? 1 : -1
            setKindId(kinds[(idx + delta + kinds.length) % kinds.length].id)
          }
        }}
      >
        <div className="border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-2">
            {selectedKind && (
              <span style={{ color: selectedKind.color }}>
                <AgentIcon kindId={selectedKind.id} size={18} />
              </span>
            )}
            <span className="text-base font-semibold text-zinc-100">New Agent</span>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Agent Type</div>
          <div className="mb-5 flex flex-wrap gap-2">
            {kinds.map((k) => {
              const active = k.id === kindId
              return (
                <button
                  key={k.id}
                  onClick={() => setKindId(k.id)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'border-transparent text-white'
                      : 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
                  }`}
                  style={active ? { background: k.color } : undefined}
                >
                  <span style={active ? { color: '#fff' } : { color: k.color }}>
                    <AgentIcon kindId={k.id} size={14} />
                  </span>
                  {k.name}
                </button>
              )
            })}
          </div>

          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Directory</div>
          {dirOptions.length > 0 && (
            <div className="mb-2 overflow-hidden rounded-xl border border-zinc-700">
              {dirOptions.map((path) => (
                <button
                  key={path}
                  onClick={() => setDir(path)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
                    path === dir ? 'bg-zinc-700/60' : 'bg-zinc-800/50 hover:bg-zinc-800'
                  }`}
                >
                  <FolderGlyph />
                  <span className="shrink-0 text-sm text-zinc-200">{basename(path)}</span>
                  {path === mainDir && (
                    <span className="shrink-0 rounded bg-zinc-700 px-1 text-[10px] font-medium uppercase tracking-wider text-zinc-300">
                      main
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-right text-xs text-zinc-600">
                    {path}
                  </span>
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => void pickDir()}
            className="mb-5 flex w-full items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-left transition hover:border-zinc-600 hover:bg-zinc-800"
          >
            <FolderGlyph />
            <span className="text-sm text-zinc-300">Choose another folder…</span>
          </button>

          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
            Worktree Name <span className="text-zinc-700">(optional — leave empty for none)</span>
          </div>
          <input
            autoFocus
            type="text"
            value={worktreeName}
            onChange={(e) => setWorktreeName(e.target.value)}
            placeholder="e.g. fix-auth-bug"
            className="mb-4 w-full rounded-xl border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-700"
          />

          {orphans.length > 0 && (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Orphan Worktrees
              </div>
              {orphans.map((o) => (
                <div key={o.path} className="flex items-center gap-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate text-zinc-400">{o.branch}</span>
                  <button
                    onClick={() => void confirm(o.path)}
                    className="rounded px-2 py-0.5 text-emerald-400 transition hover:bg-emerald-950/50"
                  >
                    adopt
                  </button>
                  <button
                    onClick={() => void deleteOrphan(o.path)}
                    className="rounded px-2 py-0.5 text-red-400 transition hover:bg-red-950/50"
                  >
                    delete
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">
          <span className="flex items-center gap-3 text-xs text-zinc-600">
            <span>
              <kbd className="rounded bg-zinc-800 px-1.5 py-0.5">⏎</kbd> to start
            </span>
            <span>
              <kbd className="rounded bg-zinc-800 px-1.5 py-0.5">←</kbd>
              <kbd className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5">→</kbd> type
            </span>
            <span>
              <kbd className="rounded bg-zinc-800 px-1.5 py-0.5">↑</kbd>
              <kbd className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5">↓</kbd> folder
            </span>
          </span>
          <div className="flex gap-2">
            <button
              onClick={closeDialog}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => void confirm()}
              disabled={busy || !dir || !kindId}
              className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Starting…' : 'Start Agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
