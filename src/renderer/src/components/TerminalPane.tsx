import { useEffect, useRef, useState } from 'react'
import { openAddTerminalDialog, selectAgent, spawnInDir } from '../actions'
import { useStore } from '../store'
import { attachTerminal } from '../terminals'
import { AgentIcon } from './AgentIcon'
import { SearchBar } from './SearchBar'
import { basename } from '../util'

export function TerminalPane(): React.JSX.Element {
  const agents = useStore((s) => s.agents)
  const selectedId = useStore((s) => s.selectedId)
  const selectedWorkspaceId = useStore((s) => s.selectedWorkspaceId)
  const config = useStore((s) => s.config)
  const workspaceAgents = agents.filter((a) => a.workspaceId === selectedWorkspaceId)
  return <div className="relative h-full w-full">
    {selectedWorkspaceId && <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2">
      {workspaceAgents.map((agent) => { const kind = config?.agentKinds.find((k) => k.id === agent.kindId); return <button key={agent.id} onClick={() => selectAgent(agent.id, 'click')} className={`flex h-6 max-w-48 items-center gap-1.5 rounded px-2 text-xs ${agent.id === selectedId ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800'}`}><span style={{ color: kind?.color }}><AgentIcon kindId={agent.kindId} size={12} /></span><span className="truncate">{agent.title}</span></button> })}
      <button onClick={openAddTerminalDialog} title="Add terminal (⌘T)" className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">+</button>
    </div>}
    <div className={selectedWorkspaceId ? 'absolute inset-x-0 bottom-0 top-8' : 'absolute inset-0'}>
      {agents.map((a) => <TerminalHost key={a.id} id={a.id} visible={a.id === selectedId && a.workspaceId === selectedWorkspaceId} />)}
      <SearchBar />
      {agents.length === 0 ? <EmptyState /> : selectedWorkspaceId && workspaceAgents.length === 0 ? <WorkspaceEmpty /> : null}
    </div>
  </div>
}

function TerminalHost({ id, visible }: { id: string; visible: boolean }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) attachTerminal(id, ref.current) }, [id])
  return <div ref={ref} className="absolute inset-0" style={{ visibility: visible ? 'visible' : 'hidden' }} />
}

function EmptyState(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const recentDirs = useStore((s) => s.recentDirs)
  const kinds = config?.agentKinds.filter((k) => k.command) ?? []
  return <div className="flex h-full items-center justify-center overflow-y-auto"><div className="w-full max-w-2xl px-8 py-12">
    <div className="mb-8 text-center"><div className="mb-3 text-2xl font-bold text-zinc-200">No agents running</div><div className="flex items-center justify-center gap-3 text-sm text-zinc-500">Press <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300">⌘T</kbd> to start an agent<span className="text-zinc-700">·</span><button onClick={() => useStore.setState({ settingsOpen: true })} className="text-zinc-400 hover:text-zinc-200">Settings</button></div></div>
    <div className="mb-8 flex flex-wrap justify-center gap-2">{kinds.map((kind) => <button key={kind.id} onClick={() => { window.vide.pickDirectory().then((dir) => { if (dir) void spawnInDir(dir, kind.id) }) }} className="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800/50 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"><span style={{ color: kind.color }}><AgentIcon kindId={kind.id} size={16} /></span>{kind.name}</button>)}</div>
    {recentDirs.length > 0 && <div><div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-600">Recent</div><div className="flex flex-col gap-1">{recentDirs.map((d) => <RecentDirRow key={d.path} path={d.path} kinds={kinds} />)}</div></div>}
  </div></div>
}

function RecentDirRow({ path, kinds }: { path: string; kinds: { id: string; name: string; color: string }[] }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return <div className="group flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800/50 hover:text-zinc-200" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <svg className="h-4 w-4 shrink-0 text-zinc-600" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-7.5A1.75 1.75 0 0 0 14.25 4H7.5L5.696 2.293A1.75 1.75 0 0 0 4.477 1.75L4.25 1H1.75z" /></svg>
    <button onClick={() => void spawnInDir(path)} className="min-w-0 flex-1 truncate text-left">{basename(path)}</button>
    <div className={`flex shrink-0 items-center gap-1 transition ${hovered ? 'opacity-100' : 'opacity-0'}`}>{kinds.map((kind) => <button key={kind.id} onClick={() => void spawnInDir(path, kind.id)} className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-700" style={{ color: kind.color }} title={kind.name}><AgentIcon kindId={kind.id} size={14} /></button>)}</div>
    <span className="shrink-0 text-xs text-zinc-700">{path}</span>
  </div>
}

function WorkspaceEmpty(): React.JSX.Element {
  return <div className="flex h-full flex-col items-center justify-center gap-3"><div className="text-sm text-zinc-500">This workspace has no running terminals.</div><button onClick={openAddTerminalDialog} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">Launch Agent or Shell</button></div>
}
