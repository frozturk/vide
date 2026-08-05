import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { attachTerminal } from '../terminals'
import { spawnInDir } from '../actions'
import { basename } from '../util'
import { AgentIcon } from './AgentIcon'
import { SearchBar } from './SearchBar'

export function TerminalPane(): React.JSX.Element {
  const agents = useStore((s) => s.agents)
  const selectedId = useStore((s) => s.selectedId)
  return (
    <div className="relative h-full w-full">
      {agents.map((a) => (
        <TerminalHost key={a.id} id={a.id} visible={a.id === selectedId} />
      ))}
      <SearchBar />
      {agents.length === 0 && <EmptyState />}
    </div>
  )
}

function TerminalHost({ id, visible }: { id: string; visible: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) attachTerminal(id, ref.current)
  }, [id])
  return <div ref={ref} className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }} />
}

function EmptyState(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const recentDirs = useStore((s) => s.recentDirs)
  const kinds = config?.agentKinds.filter((k) => k.command) ?? []

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto">
      <div className="w-full max-w-2xl px-8 py-12">
        <div className="mb-8 text-center">
          <div className="mb-3 text-2xl font-bold text-zinc-200">No agents running</div>
          <div className="flex items-center justify-center gap-3 text-sm text-zinc-500">
            Press{' '}
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">⌘T</kbd>{' '}
            to start an agent
            <span className="text-zinc-700">·</span>
            <button
              onClick={() => useStore.setState({ settingsOpen: true })}
              className="inline-flex items-center gap-1 text-zinc-400 transition hover:text-zinc-200"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 1.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />
                <path d="M8 0a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 8 0zm0 12a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 8 12zM1.373 1.373a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 0 1-1.06 1.06l-1.061-1.06a.75.75 0 0 1 0-1.06zm10.073 10.073a.75.75 0 0 1 1.06 0l1.061 1.06a.75.75 0 1 1-1.06 1.061l-1.061-1.06a.75.75 0 0 1 0-1.061zM0 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 8zm12 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 12 8zM1.373 14.627a.75.75 0 0 1 0-1.06l1.06-1.061a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0zM11.446 4.554a.75.75 0 0 1 0-1.061l1.06-1.06a.75.75 0 1 1 1.061 1.06l-1.06 1.061a.75.75 0 0 1-1.061 0z" />
              </svg>
              Settings
            </button>
          </div>
        </div>

        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {kinds.map((k) => (
            <button
              key={k.id}
              onClick={() => {
                window.vide.pickDirectory().then((dir) => {
                  if (dir) void spawnInDir(dir)
                })
              }}
              className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <span style={{ color: k.color }}>
                <AgentIcon kindId={k.id} size={16} />
              </span>
              {k.name}
            </button>
          ))}
        </div>

        {recentDirs.length > 0 && (
          <div>
            <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Recent
            </div>
            <div className="flex flex-col gap-1">
              {recentDirs.map((d) => (
                <RecentDirRow key={d.path} path={d.path} kinds={kinds} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RecentDirRow({ path, kinds }: { path: string; kinds: { id: string; name: string; color: string }[] }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800/50 hover:text-zinc-200"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <svg className="h-4 w-4 shrink-0 text-zinc-600" viewBox="0 0 16 16" fill="currentColor">
        <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-7.5A1.75 1.75 0 0 0 14.25 4H7.5L5.696 2.293A1.75 1.75 0 0 0 4.477 1.75L4.25 1H1.75z" />
      </svg>
      <button
        onClick={() => void spawnInDir(path)}
        className="min-w-0 flex-1 truncate text-left"
      >
        {basename(path)}
      </button>
      <div className={`flex shrink-0 items-center gap-1 transition ${hovered ? 'opacity-100' : 'opacity-0'}`}>
        {kinds.map((k) => (
          <button
            key={k.id}
            onClick={() => void spawnInDir(path, k.id)}
            className="flex h-6 w-6 items-center justify-center rounded-md transition hover:bg-zinc-700"
            style={{ color: k.color }}
            title={k.name}
          >
            <AgentIcon kindId={k.id} size={14} />
          </button>
        ))}
      </div>
      <span className="shrink-0 text-xs text-zinc-700">{path}</span>
    </div>
  )
}
