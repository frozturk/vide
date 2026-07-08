import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { TOOLBAR_HEIGHT } from './TopBar'

function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `http://${t}`
}

export function BrowserBar(): React.JSX.Element | null {
  const overlay = useStore((s) => s.overlay)
  const browser = useStore((s) => s.browser)
  const urlFocusSeq = useStore((s) => s.urlFocusSeq)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)

  useEffect(() => {
    if (overlay === 'browser' && urlFocusSeq > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [urlFocusSeq, overlay])

  if (overlay !== 'browser') return null

  return (
    <div
      className="fixed right-0 z-40 flex items-center gap-1.5 border-b border-l border-zinc-800 bg-zinc-900 px-2"
      style={{ width: '66.667%', height: TOOLBAR_HEIGHT, top: TOOLBAR_HEIGHT }}
    >
      <button
        onClick={() => void window.vide.browserBack()}
        disabled={!browser.canGoBack}
        className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
      >
        ←
      </button>
      <button
        onClick={() => void window.vide.browserReload()}
        className="rounded px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
      >
        ⟳
      </button>
      <input
        ref={inputRef}
        value={editing ?? browser.url}
        onChange={(e) => setEditing(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => setEditing(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const url = normalizeUrl(e.currentTarget.value)
            if (url) {
              void window.vide.browserLoadUrl(url)
              void window.vide.browserSetVisible(true, true)
            }
            setEditing(null)
          }
        }}
        spellCheck={false}
        className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
      />
      {browser.loading && <span className="animate-pulse text-xs text-zinc-500">…</span>}
    </div>
  )
}
