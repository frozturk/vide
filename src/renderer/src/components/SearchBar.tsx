import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { closeSearch } from '../actions'
import { findInTerminal, onSearchResults } from '../terminals'

export function SearchBar(): React.JSX.Element | null {
  const open = useStore((s) => s.searchOpen)
  const selectedId = useStore((s) => s.selectedId)
  if (!open || !selectedId) return null
  return <SearchBarInner key={selectedId} agentId={selectedId} />
}

function SearchBarInner({ agentId }: { agentId: string }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const searchSeq = useStore((s) => s.searchSeq)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ resultIndex: number; resultCount: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [searchSeq])

  useEffect(() => onSearchResults(agentId, setResults), [agentId])

  function update(q: string): void {
    setQuery(q)
    if (!q) setResults(null)
    findInTerminal(agentId, q, 'next', true)
  }

  return (
    <div className="absolute right-3 top-2 z-30 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            findInTerminal(agentId, query, e.shiftKey ? 'prev' : 'next')
          }
        }}
        placeholder="Find in terminal…"
        className="w-48 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
      />
      <span className="shrink-0 tabular-nums text-[11px] text-zinc-500">
        {query ? (results && results.resultCount > 0 ? `${results.resultIndex + 1}/${results.resultCount}` : '0/0') : ''}
      </span>
      <button
        onClick={() => findInTerminal(agentId, query, 'prev')}
        className="rounded px-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        title="Previous (⇧⏎)"
      >
        ↑
      </button>
      <button
        onClick={() => findInTerminal(agentId, query, 'next')}
        className="rounded px-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
        title="Next (⏎)"
      >
        ↓
      </button>
      <button
        onClick={closeSearch}
        className="rounded px-1 text-xs text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200"
        title="Close (esc)"
      >
        ✕
      </button>
    </div>
  )
}
