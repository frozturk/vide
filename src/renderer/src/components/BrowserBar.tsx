import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { closeBrowserTab } from '../actions'
import {
  TOOLBAR_HEIGHT,
  TAB_STRIP_HEIGHT,
  NAV_BAR_HEIGHT,
  BROWSER_CHROME_HEIGHT
} from '../../../shared/layout'
import type { BrowserTab } from '../../../shared/types'

function normalizeUrl(input: string): string {
  const t = input.trim()
  if (!t) return ''
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `http://${t}`
}

function tabLabel(t: BrowserTab): string {
  if (t.loading && !t.title) return 'Loading…'
  return t.title || t.url.replace(/^https?:\/\//, '') || 'New Tab'
}

export function BrowserBar(): React.JSX.Element | null {
  const overlay = useStore((s) => s.overlay)
  const { tabs, activeId } = useStore((s) => s.browser)
  const urlFocusSeq = useStore((s) => s.urlFocusSeq)
  const inputRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const active = tabs.find((t) => t.id === activeId) ?? null

  useEffect(() => {
    if (overlay === 'browser' && urlFocusSeq > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [urlFocusSeq, overlay])

  if (overlay !== 'browser') return null

  return (
    <div
      className="fixed right-0 z-40 flex flex-col border-b border-l border-zinc-800 bg-zinc-900/95 backdrop-blur"
      style={{ width: '66.667%', height: BROWSER_CHROME_HEIGHT, top: TOOLBAR_HEIGHT }}
    >
      <div
        className="flex items-center gap-1 overflow-x-auto px-1.5"
        style={{ height: TAB_STRIP_HEIGHT }}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId
          return (
            <div
              key={t.id}
              onClick={() => void window.vide.browserSelectTab(t.id)}
              className={`group flex h-[22px] min-w-0 max-w-[160px] shrink-0 cursor-default items-center gap-1 rounded-md px-2 text-xs ${
                isActive
                  ? 'bg-zinc-700/70 text-zinc-100'
                  : 'text-zinc-400 hover:bg-zinc-800/70'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{tabLabel(t)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeBrowserTab(t.id)
                }}
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-zinc-500 opacity-0 hover:bg-zinc-600 hover:text-zinc-200 group-hover:opacity-100"
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          onClick={() => void window.vide.browserNewTab()}
          className="flex h-[22px] w-6 shrink-0 items-center justify-center rounded-md text-sm text-zinc-500 hover:bg-zinc-800/70 hover:text-zinc-200"
        >
          +
        </button>
      </div>

      <div
        className="flex items-center gap-1 border-t border-zinc-800/70 px-1.5"
        style={{ height: NAV_BAR_HEIGHT }}
      >
        <button
          onClick={() => void window.vide.browserBack()}
          disabled={!active?.canGoBack}
          className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
        >
          ←
        </button>
        <button
          onClick={() => void window.vide.browserForward()}
          disabled={!active?.canGoForward}
          className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800 disabled:opacity-30"
        >
          →
        </button>
        <button
          onClick={() => void window.vide.browserReload()}
          className="rounded px-1.5 py-0.5 text-sm text-zinc-400 hover:bg-zinc-800"
        >
          ⟳
        </button>
        <input
          ref={inputRef}
          value={editing ?? active?.url ?? ''}
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
          className="min-w-0 flex-1 rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-0.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
        {active?.loading && <span className="animate-pulse text-xs text-zinc-500">…</span>}
      </div>
    </div>
  )
}
