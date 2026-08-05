import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import type { DiffFile, DiffResult, GitCommit } from '../../../shared/types'
import { selectedAgent, useStore } from '../store'
import { basename, dirname } from '../util'
import { DEFAULT_PANE_FRACTION } from '../../../shared/layout'
import { Resizer, useHSplit } from './Resizer'
import { TOOLBAR_HEIGHT } from './TopBar'
import { FileIcon } from './FileIcon'

const STATUS_LETTER: Record<DiffFile['status'], { letter: string; color: string }> = {
  modified: { letter: 'M', color: '#f59e0b' },
  added: { letter: 'A', color: '#4ade80' },
  deleted: { letter: 'D', color: '#ef4444' },
  renamed: { letter: 'R', color: '#60a5fa' },
  untracked: { letter: 'U', color: '#4ade80' }
}

const DiffBody = memo(function DiffBody({
  path,
  hunks,
  showNums
}: {
  path: string
  hunks: string
  showNums: boolean
}): React.JSX.Element {
  return (
    <div className={`min-w-0 flex-1 overflow-auto ${showNums ? '' : 'hide-diff-nums'}`}>
      {hunks ? (
        <DiffView
          key={path}
          data={{
            oldFile: { fileName: path },
            newFile: { fileName: path },
            hunks: [hunks]
          }}
          diffViewMode={DiffModeEnum.Unified}
          diffViewTheme="dark"
          diffViewHighlight
          diffViewFontSize={12}
          diffViewWrap
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-zinc-600">
          binary, empty or too large
        </div>
      )}
    </div>
  )
})

function GitTree({
  commits,
  selectedRef,
  expanded,
  hasMore,
  onToggle,
  onSelect,
  onLoadMore
}: {
  commits: GitCommit[]
  selectedRef: string | null
  expanded: boolean
  hasMore: boolean
  onToggle: () => void
  onSelect: (ref: string | null) => void
  onLoadMore: () => void
}): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-zinc-800">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1 px-1.5 py-1.5 text-left text-xs font-semibold text-zinc-400 outline-none focus:outline-none hover:bg-zinc-900"
      >
        <span className="inline-block w-3 shrink-0 text-center text-zinc-600">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="flex-1">Commits</span>
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-zinc-900">
          <button
            onClick={() => onSelect(null)}
            className={`flex w-full items-center gap-1 px-1.5 py-1.5 text-left text-xs outline-none focus:outline-none hover:bg-zinc-900 ${
              selectedRef === null ? 'bg-zinc-900' : ''
            }`}
          >
            <span className="w-14 shrink-0 font-mono text-emerald-400">working</span>
            <span className="min-w-0 flex-1 truncate text-zinc-300">Current work</span>
          </button>
          {commits.map((c) => (
            <button
              key={c.sha}
              onClick={() => onSelect(c.sha)}
              className={`flex w-full items-center gap-1 px-1.5 py-1.5 text-left text-xs outline-none focus:outline-none hover:bg-zinc-900 ${
                selectedRef === c.sha ? 'bg-zinc-900' : ''
              }`}
              title={`${c.short} · ${c.author} · ${c.date}`}
            >
              <span className="w-14 shrink-0 font-mono text-amber-500">{c.short}</span>
              <span className="min-w-0 flex-1 truncate text-zinc-300">{c.subject}</span>
              <span className="shrink-0 text-zinc-600">{c.date}</span>
            </button>
          ))}
          {hasMore && (
            <button
              onClick={onLoadMore}
              className="w-full px-1.5 py-1.5 text-left text-xs text-zinc-500 outline-none focus:outline-none hover:bg-zinc-900 hover:text-zinc-300"
            >
              <span className="inline-block w-14" />
              load more…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const COMMIT_PAGE = 10

export function DiffOverlay(): React.JSX.Element | null {
  const overlay = useStore((s) => s.overlay)
  const agent = useStore(selectedAgent)
  if (overlay !== 'diff') return null
  return (
    <DiffOverlayInner
      key={agent?.cwd ?? 'none'}
      cwd={agent?.cwd ?? null}
      root={agent?.repoRoot ?? null}
    />
  )
}

function DiffOverlayInner({ cwd, root }: { cwd: string | null; root: string | null }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<DiffResult | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [selectedRef, setSelectedRef] = useState<string | null>(null)
  const [treeExpanded, setTreeExpanded] = useState(
    () => localStorage.getItem('diffTreeExpanded') === '1'
  )
  const [showNums, setShowNums] = useState(() => localStorage.getItem('diffShowNums') === '1')
  const [hasMore, setHasMore] = useState(false)
  const [frac, setFrac] = useHSplit('diffSplit', DEFAULT_PANE_FRACTION, 0.2, 0.85)
  const [sidebarFrac, setSidebarFrac] = useHSplit('diffSidebarSplit', 0.25, 0.12, 0.6)
  const lastHash = useRef('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) return
    try {
      const res = await window.vide.diffGet(cwd, selectedRef ?? undefined)
      setResult(res)
      if (res.kind === 'ok') {
        setSelectedPath((prev) =>
          prev && res.files.some((f) => f.path === prev) ? prev : (res.files[0]?.path ?? null)
        )
      }
      if (!selectedRef) lastHash.current = await window.vide.diffStatusHash(cwd)
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [cwd, selectedRef])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!cwd) return
    void window.vide.gitLog(cwd).then((cs) => {
      setCommits(cs)
      setHasMore(cs.length === COMMIT_PAGE)
    })
  }, [cwd])

  const loadMore = useCallback(async (): Promise<void> => {
    if (!cwd) return
    const cs = await window.vide.gitLog(cwd, commits.length)
    setCommits((prev) => [...prev, ...cs])
    setHasMore(cs.length === COMMIT_PAGE)
  }, [cwd, commits.length])

  const openFile = useCallback(
    (path: string | null): void => {
      if (root && path) void window.vide.openInIde(`${root}/${path}`)
    },
    [root]
  )

  useEffect(() => {
    if (!cwd) {
      setResult({ kind: 'no-repo' })
      return
    }
    lastHash.current = ''
    void refresh()
    if (selectedRef) return
    const timer = setInterval(async () => {
      try {
        const h = await window.vide.diffStatusHash(cwd)
        if (h !== lastHash.current) void refresh()
      } catch {
        /* transient git failure; next tick retries */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [cwd, refresh, selectedRef])

  function move(delta: number): void {
    if (result?.kind !== 'ok' || result.files.length === 0) return
    const idx = result.files.findIndex((f) => f.path === selectedPath)
    const next = result.files[Math.min(result.files.length - 1, Math.max(0, idx + delta))]
    setSelectedPath(next.path)
  }

  const selected = result?.kind === 'ok' ? (result.files.find((f) => f.path === selectedPath) ?? null) : null
  const selectedCommit = selectedRef ? commits.find((c) => c.sha === selectedRef) : null

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'r') {
          void refresh()
        } else if (e.key === 'n') {
          e.preventDefault()
          setShowNums((v) => {
            const next = !v
            localStorage.setItem('diffShowNums', next ? '1' : '0')
            return next
          })
        } else if (e.key === 'o') {
          e.preventDefault()
          openFile(selectedPath)
        }
      }}
      className="fixed right-0 z-40 flex flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl outline-none"
      style={{ top: TOOLBAR_HEIGHT, bottom: 0, width: `${frac * 100}%` }}
    >
      <Resizer
        onDrag={(clientX) => setFrac((window.innerWidth - clientX) / window.innerWidth)}
        style={{
          position: 'fixed',
          top: TOOLBAR_HEIGHT,
          bottom: 0,
          width: 7,
          right: `calc(${frac * 100}% - 3px)`
        }}
      />
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">
        {selectedCommit && (
          <span className="shrink-0 font-mono text-amber-500">{selectedCommit.short}</span>
        )}
        {selected && (
          <>
            <span className="shrink-0 font-semibold text-zinc-300">{basename(selected.path)}</span>
            <span className="min-w-0 truncate text-zinc-600">{selected.path}</span>
          </>
        )}
        <span className="ml-auto shrink-0">j/k navigate · o open · n numbers · r refresh · esc close</span>
      </div>
      {result?.kind === 'no-repo' && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">not a git repository</div>
      )}
      {result?.kind === 'error' && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-red-400">
          {result.message}
        </div>
      )}
      {result?.kind === 'ok' && (
        <div ref={bodyRef} className="relative flex min-h-0 flex-1">
          <div
            className="flex shrink-0 flex-col border-r border-zinc-800"
            style={{ width: `${sidebarFrac * 100}%` }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {result.files.map((f) => {
                const s = STATUS_LETTER[f.status]
                return (
                  <div
                    key={f.path}
                    onClick={() => setSelectedPath(f.path)}
                    className={`group flex w-full cursor-pointer items-center gap-1 px-1.5 py-1.5 text-left text-xs hover:bg-zinc-900 ${
                      f.path === selectedPath ? 'bg-zinc-900' : ''
                    }`}
                    title={f.path}
                  >
                    <FileIcon path={f.path} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-zinc-300">{basename(f.path)}</span>
                      {dirname(f.path) && (
                        <span className="ml-1.5 text-zinc-600">{dirname(f.path)}</span>
                      )}
                    </span>
                    {f.status !== 'deleted' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          openFile(f.path)
                        }}
                        className="hidden shrink-0 rounded px-0.5 text-zinc-500 hover:text-zinc-200 group-hover:block"
                        title="Open in IDE (o)"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.216 2.784 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5a.75.75 0 0 0-1.5 0v3.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5a.25.25 0 0 1 .25-.25h3.5a.75.75 0 0 0 0-1.5h-3.5z" />
                          <path d="M9.5 2a.75.75 0 0 0 0 1.5h1.94L7.22 7.72a.75.75 0 1 0 1.06 1.06l4.22-4.22v1.94a.75.75 0 0 0 1.5 0V2.75A.75.75 0 0 0 13.25 2H9.5z" />
                        </svg>
                      </button>
                    )}
                    <span
                      className="w-3 shrink-0 text-center font-mono font-bold"
                      style={{ color: s.color }}
                    >
                      {s.letter}
                    </span>
                  </div>
                )
              })}
              {result.truncated > 0 && (
                <div className="px-2 py-1.5 text-xs text-zinc-600">+{result.truncated} more untracked</div>
              )}
            </div>
            <GitTree
              commits={commits}
              selectedRef={selectedRef}
              expanded={treeExpanded}
              hasMore={hasMore}
              onToggle={() =>
                setTreeExpanded((v) => {
                  const next = !v
                  localStorage.setItem('diffTreeExpanded', next ? '1' : '0')
                  return next
                })
              }
              onSelect={setSelectedRef}
              onLoadMore={() => void loadMore()}
            />
          </div>
          <Resizer
            onDrag={(clientX) => {
              const rect = bodyRef.current?.getBoundingClientRect()
              if (rect) setSidebarFrac((clientX - rect.left) / rect.width)
            }}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 7,
              left: `calc(${sidebarFrac * 100}% - 3px)`
            }}
          />
          {selected ? (
            <DiffBody path={selected.path} hunks={selected.hunks} showNums={showNums} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
              {selectedRef ? 'empty commit' : 'no changes'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
