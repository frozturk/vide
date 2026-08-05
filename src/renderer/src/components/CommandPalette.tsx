import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  closePalette,
  openSearch,
  openSpawnDialog,
  reloadConfig,
  selectAgent,
  spawnInDir,
  toggleOverlay
} from '../actions'
import { basename } from '../util'
import { AgentIcon } from './AgentIcon'
import { STATUS_COLOR } from './AgentStrip'
import type { AgentStatus } from '../../../shared/types'

interface PaletteItem {
  id: string
  label: string
  hint: string
  kindId?: string
  kindColor?: string
  status?: AgentStatus
  kbd?: string
  action: () => void
}

function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    if (found === ti) score += 2
    if (found === 0 || ' /-_.'.includes(t[found - 1])) score += 3
    ti = found + 1
  }
  return score
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useStore((s) => s.paletteOpen)
  if (!open) return null
  return <CommandPaletteInner />
}

function CommandPaletteInner(): React.JSX.Element {
  const agents = useStore((s) => s.agents)
  const statuses = useStore((s) => s.statuses)
  const titles = useStore((s) => s.titles)
  const config = useStore((s) => s.config)
  const recentDirs = useStore((s) => s.recentDirs)
  const selectedId = useStore((s) => s.selectedId)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = agents.map((a) => {
      const kind = config?.agentKinds.find((k) => k.id === a.kindId)
      return {
        id: `agent:${a.id}`,
        label: titles[a.id] ?? a.sessionName,
        hint: `${basename(a.projectRoot)} · ${statuses[a.id] ?? 'idle'}`,
        kindId: a.kindId,
        kindColor: kind?.color,
        status: statuses[a.id] ?? 'idle',
        action: () => selectAgent(a.id, 'click')
      }
    })
    all.push(
      { id: 'cmd:spawn', label: 'New Agent', hint: 'command', kbd: '⌘T', action: openSpawnDialog },
      { id: 'cmd:diff', label: 'Toggle Diff', hint: 'command', kbd: '⌘D', action: () => toggleOverlay('diff') },
      { id: 'cmd:browser', label: 'Toggle Browser', hint: 'command', kbd: '⌘B', action: () => toggleOverlay('browser') },
      { id: 'cmd:find', label: 'Find in Terminal', hint: 'command', kbd: '⌘F', action: openSearch },
      { id: 'cmd:settings', label: 'Settings', hint: 'command', action: () => useStore.setState({ settingsOpen: true }) },
      { id: 'cmd:reload', label: 'Reload Config', hint: 'command', kbd: '⌘⇧R', action: () => void reloadConfig() }
    )
    for (const d of recentDirs) {
      all.push({
        id: `dir:${d.path}`,
        label: `New agent in ${basename(d.path)}`,
        hint: d.path,
        action: () => void spawnInDir(d.path)
      })
    }
    return all
  }, [agents, statuses, titles, config, recentDirs])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    return items
      .map((item) => ({ item, score: fuzzyScore(query.trim(), `${item.label} ${item.hint}`) }))
      .filter((x): x is { item: PaletteItem; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item)
  }, [items, query])

  const active = Math.min(index, filtered.length - 1)

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function run(item: PaletteItem): void {
    closePalette()
    item.action()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={closePalette}
    >
      <div
        className="mt-24 h-fit w-[560px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex(filtered.length ? (active + 1) % filtered.length : 0)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex(filtered.length ? (active - 1 + filtered.length) % filtered.length : 0)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const item = filtered[active]
              if (item) run(item)
            }
          }}
          placeholder="Jump to agent, run a command…"
          className="w-full border-b border-zinc-800 bg-transparent px-5 py-4 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
        <div ref={listRef} className="max-h-96 overflow-y-auto py-1.5">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              onClick={() => run(item)}
              onMouseMove={() => setIndex(i)}
              className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm ${
                i === active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300'
              }`}
            >
              {item.kindId ? (
                <span className="shrink-0" style={{ color: item.kindColor ?? '#71717a' }}>
                  <AgentIcon kindId={item.kindId} size={15} />
                </span>
              ) : (
                <span className="w-[15px] shrink-0 text-center text-zinc-600">›</span>
              )}
              <span className="min-w-0 flex-1 truncate">
                {item.label}
                {item.id === `agent:${selectedId}` && <span className="ml-1.5 text-zinc-600">current</span>}
              </span>
              {item.status && (
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.status === 'busy' ? 'animate-pulse' : ''}`}
                  style={{ background: STATUS_COLOR[item.status] }}
                />
              )}
              <span className="max-w-40 shrink-0 truncate text-xs text-zinc-600">{item.hint}</span>
              {item.kbd && (
                <kbd className="shrink-0 rounded border border-zinc-700/60 bg-zinc-800/50 px-1 font-sans text-[10px] text-zinc-500">
                  {item.kbd}
                </kbd>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-zinc-600">no matches</div>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-600">
          <span>
            <kbd className="rounded bg-zinc-800 px-1 py-0.5">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded bg-zinc-800 px-1 py-0.5">⏎</kbd> select
          </span>
          <span>
            <kbd className="rounded bg-zinc-800 px-1 py-0.5">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
