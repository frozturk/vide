import { useEffect, useState } from 'react'
import { selectedAgent, useStore } from '../store'
import { basename } from '../util'
import { AgentIcon } from './AgentIcon'
import { toggleOverlay } from '../actions'
import logoWhite from '../assets/v-white.svg'
import type { GitSummary } from '../../../shared/types'
import { TOOLBAR_HEIGHT } from '../../../shared/layout'

export function TopBar(): React.JSX.Element {
  const agent = useStore(selectedAgent)
  const config = useStore((s) => s.config)
  const title = useStore((s) => (agent ? s.titles[agent.id] ?? null : null))
  const overlay = useStore((s) => s.overlay)
  const [summary, setSummary] = useState<GitSummary | null>(null)

  const cwd = agent?.cwd ?? null

  useEffect(() => {
    if (!cwd) {
      setSummary(null)
      return
    }
    let cancelled = false
    const fetch = (): void => {
      window.vide
        .gitSummary(cwd)
        .then((s) => {
          if (!cancelled) setSummary(s)
        })
        .catch(() => {})
    }
    fetch()
    const timer = setInterval(fetch, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cwd])

  const kind = agent ? config?.agentKinds.find((k) => k.id === agent.kindId) ?? null : null

  return (
    <div
      className="fixed left-0 right-0 top-0 z-20 flex items-center border-b border-zinc-800 bg-zinc-900 select-none"
      style={{ height: TOOLBAR_HEIGHT, paddingTop: 3, WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div style={{ width: 88, flexShrink: 0 }} />

      <div className="flex min-w-0 flex-1 items-center gap-3 h-full">
        {agent && kind ? (
          <>
            <span style={{ color: kind.color }} className="shrink-0 flex items-center">
              <AgentIcon kindId={kind.id} size={15} />
            </span>
            <span className="truncate text-sm font-medium text-zinc-300 leading-none">
              {title ?? agent.sessionName}
            </span>
            <span className="shrink-0 text-xs text-zinc-600 leading-none">·</span>
            <span className="shrink-0 truncate text-xs text-zinc-500 leading-none" title={agent.cwd}>
              {basename(agent.cwd)}
            </span>

            {summary?.branch && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 leading-none">
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 9.5 3.25zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM2 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 2 3.25z" />
                </svg>
                {summary.branch}
              </span>
            )}

            {summary && (summary.ahead > 0) && (
              <span className="shrink-0 rounded bg-emerald-950/50 px-1.5 py-0.5 text-[11px] leading-none text-emerald-400">
                ↑{summary.ahead}
              </span>
            )}
            {summary && (summary.behind > 0) && (
              <span className="shrink-0 rounded bg-amber-950/50 px-1.5 py-0.5 text-[11px] leading-none text-amber-400">
                ↓{summary.behind}
              </span>
            )}

            {summary && (summary.modified > 0 || summary.staged > 0 || summary.untracked > 0) && (
              <span className="flex shrink-0 items-center gap-1.5 leading-none">
                {summary.staged > 0 && (
                  <span className="text-[11px] leading-none text-emerald-400">+{summary.staged}</span>
                )}
                {summary.modified > 0 && (
                  <span className="text-[11px] leading-none text-amber-400">~{summary.modified}</span>
                )}
                {summary.untracked > 0 && (
                  <span className="text-[11px] leading-none text-blue-400">?{summary.untracked}</span>
                )}
              </span>
            )}

            {agent.worktreePath && (
              <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] leading-none text-zinc-400">
                {basename(agent.worktreePath)}
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-2">
            <img src={logoWhite} alt="vide" className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium text-zinc-500">vide</span>
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 pr-3 h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {agent && (
          <>
            <button
              onClick={() => toggleOverlay('diff')}
              className={`flex items-center justify-center rounded-md h-6 w-7 text-xs transition ${
                overlay === 'diff' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
              }`}
              title="Diff (⌘D)"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 1h6v6H1zm8 0h6v6H9zM1 9h6v6H1zm8 0h6v6H9z" opacity="0.3" />
                <path d="M4 3v2M4 2v2M3 4h2M11 11v2M11 10v2M10 12h2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => void window.vide.openInEditor(agent.cwd)}
              className="flex items-center gap-1.5 rounded-md h-6 px-2 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
              title="Open in VS Code"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M14.85 3.1 11.5 2.2 8.4 4.3 5.3 2.2 2 3.1v9.8l3.3.9 3.1-2.1 3.1 2.1 3.3-.9V3.1zM5.3 11.3l-2.3.6V4.1l2.3-.6v7.8zm.5-7.3 2.6 1.8v6.4L5.8 10.4V4zm4.4 6.4V5.8l2.6-1.8v6.4l-2.6 1.8zm3.1-6.7-2.3.6v7.8l2.3-.6V3.7z" />
              </svg>
              VS Code
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export { TOOLBAR_HEIGHT }
