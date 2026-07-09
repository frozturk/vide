import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import type { DiffFile, DiffResult } from '../../../shared/types'
import { selectedAgent, useStore } from '../store'
import { basename, dirname } from '../util'
import { DEFAULT_PANE_FRACTION } from '../../../shared/layout'
import { Resizer, useHSplit } from './Resizer'
import { TOOLBAR_HEIGHT } from './TopBar'

const STATUS_LETTER: Record<DiffFile['status'], { letter: string; color: string }> = {
  modified: { letter: 'M', color: '#f59e0b' },
  added: { letter: 'A', color: '#4ade80' },
  deleted: { letter: 'D', color: '#ef4444' },
  renamed: { letter: 'R', color: '#60a5fa' },
  untracked: { letter: 'U', color: '#4ade80' }
}

export function DiffOverlay(): React.JSX.Element | null {
  const overlay = useStore((s) => s.overlay)
  const agent = useStore(selectedAgent)
  if (overlay !== 'diff') return null
  return <DiffOverlayInner key={agent?.cwd ?? 'none'} cwd={agent?.cwd ?? null} />
}

function DiffOverlayInner({ cwd }: { cwd: string | null }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<DiffResult | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showNums, setShowNums] = useState(() => localStorage.getItem('diffShowNums') === '1')
  const [frac, setFrac] = useHSplit('diffSplit', DEFAULT_PANE_FRACTION, 0.2, 0.85)
  const [sidebarFrac, setSidebarFrac] = useHSplit('diffSidebarSplit', 0.25, 0.12, 0.6)
  const lastHash = useRef('')

  const refresh = useCallback(async (): Promise<void> => {
    if (!cwd) return
    try {
      const res = await window.vide.diffGet(cwd)
      setResult(res)
      if (res.kind === 'ok') {
        setSelectedPath((prev) =>
          prev && res.files.some((f) => f.path === prev) ? prev : (res.files[0]?.path ?? null)
        )
      }
      lastHash.current = await window.vide.diffStatusHash(cwd)
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [cwd])

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!cwd) {
      setResult({ kind: 'no-repo' })
      return
    }
    lastHash.current = ''
    void refresh()
    const timer = setInterval(async () => {
      try {
        const h = await window.vide.diffStatusHash(cwd)
        if (h !== lastHash.current) void refresh()
      } catch {
        /* transient git failure; next tick retries */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [cwd, refresh])

  function move(delta: number): void {
    if (result?.kind !== 'ok' || result.files.length === 0) return
    const idx = result.files.findIndex((f) => f.path === selectedPath)
    const next = result.files[Math.min(result.files.length - 1, Math.max(0, idx + delta))]
    setSelectedPath(next.path)
  }

  const selected = result?.kind === 'ok' ? (result.files.find((f) => f.path === selectedPath) ?? null) : null

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
        {selected && (
          <>
            <span className="shrink-0 font-semibold text-zinc-300">{basename(selected.path)}</span>
            <span className="min-w-0 truncate text-zinc-600">{selected.path}</span>
          </>
        )}
        <span className="ml-auto shrink-0">j/k navigate · n numbers · r refresh · esc close</span>
      </div>
      {result?.kind === 'no-repo' && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">not a git repository</div>
      )}
      {result?.kind === 'error' && (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-red-400">
          {result.message}
        </div>
      )}
      {result?.kind === 'ok' && result.files.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">no changes</div>
      )}
      {result?.kind === 'ok' && result.files.length > 0 && (
        <div ref={bodyRef} className="relative flex min-h-0 flex-1">
          <div
            className="shrink-0 overflow-y-auto border-r border-zinc-800"
            style={{ width: `${sidebarFrac * 100}%` }}
          >
            {result.files.map((f) => {
              const s = STATUS_LETTER[f.status]
              return (
                <button
                  key={f.path}
                  onClick={() => setSelectedPath(f.path)}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-none focus:outline-none hover:bg-zinc-900 ${
                    f.path === selectedPath ? 'bg-zinc-900' : ''
                  }`}
                  title={f.path}
                >
                  <span className="w-3 shrink-0 font-mono font-bold" style={{ color: s.color }}>
                    {s.letter}
                  </span>
                  <span className="shrink-0 text-zinc-300">{basename(f.path)}</span>
                  {dirname(f.path) && (
                    <span className="min-w-0 truncate text-zinc-600">{dirname(f.path)}</span>
                  )}
                </button>
              )
            })}
            {result.truncated > 0 && (
              <div className="px-2 py-1.5 text-xs text-zinc-600">+{result.truncated} more untracked</div>
            )}
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
          <div className={`min-w-0 flex-1 overflow-auto ${showNums ? '' : 'hide-diff-nums'}`}>
            {selected &&
              (selected.hunks ? (
                <DiffView
                  key={selected.path}
                  data={{
                    oldFile: { fileName: selected.path },
                    newFile: { fileName: selected.path },
                    hunks: [selected.hunks]
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
              ))}
          </div>
        </div>
      )}
    </div>
  )
}
