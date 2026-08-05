import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { matchChord } from '../../shared/chords'
import { useStore } from './store'
import { openUrlInBrowser } from './actions'

const MAC_LINE_EDIT: Record<string, string> = {
  Backspace: '\x15',
  Delete: '\x0b',
  ArrowLeft: '\x01',
  ArrowRight: '\x05'
}

export interface TermEntry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  webgl: WebglAddon | null
  observer: ResizeObserver | null
  container: HTMLElement | null
  lastOutputAt: number
  lastResizeAt: number
}

export const terminals = new Map<string, TermEntry>()
const pending = new Map<string, string[]>()

export function feedData(agentId: string, data: string): void {
  const e = terminals.get(agentId)
  if (e) {
    e.lastOutputAt = Date.now()
    e.term.write(data)
  } else {
    const q = pending.get(agentId) ?? []
    q.push(data)
    if (q.length > 500) q.shift()
    pending.set(agentId, q)
  }
}

export function createTerminal(agentId: string): void {
  if (terminals.has(agentId)) return
  const term = new Terminal({
    allowProposedApi: true,
    fontSize: 13,
    fontFamily: 'SF Mono, Menlo, monospace',
    scrollback: 10000,
    theme: {
      background: '#09090b',
      foreground: '#d4d4d8',
      cursor: '#d4d4d8',
      selectionBackground: '#3f3f46'
    }
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((_e, uri) => openUrlInBrowser(uri)))
  const fit = new FitAddon()
  term.loadAddon(fit)
  const search = new SearchAddon()
  term.loadAddon(search)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      window.vide.ptyInput(agentId, '\x1b\r')
      return false
    }
    if (e.type === 'keydown' && e.metaKey && !e.ctrlKey && !e.altKey) {
      const seq = MAC_LINE_EDIT[e.key]
      if (seq) {
        e.preventDefault()
        window.vide.ptyInput(agentId, seq)
        return false
      }
    }
    if (e.type === 'keydown' && !e.ctrlKey && !e.altKey && matchChord(e.key, e.metaKey, e.shiftKey)) {
      return false
    }
    return true
  })
  term.onData((d) => window.vide.ptyInput(agentId, d))
  term.onResize(({ cols, rows }) => window.vide.ptyResize(agentId, cols, rows))
  const entry: TermEntry = { term, fit, search, webgl: null, observer: null, container: null, lastOutputAt: Date.now(), lastResizeAt: 0 }
  terminals.set(agentId, entry)
  const q = pending.get(agentId)
  if (q) {
    pending.delete(agentId)
    for (const d of q) term.write(d)
  }
}

export function attachTerminal(agentId: string, container: HTMLElement): void {
  const e = terminals.get(agentId)
  if (!e || e.container) return
  e.container = container
  e.term.open(container)
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => fitIfVisible(agentId))
  })
  ro.observe(container)
  e.observer = ro
}

function fitIfVisible(agentId: string): void {
  const e = terminals.get(agentId)
  if (!e || !e.container) return
  const rect = e.container.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return
  if (getComputedStyle(e.container).visibility === 'hidden') return
  try {
    e.fit.fit()
    e.lastResizeAt = Date.now()
  } catch {
    /* container in flux */
  }
}

export function activateVisual(agentId: string): void {
  for (const [id, e] of terminals) {
    if (id !== agentId && e.webgl) {
      e.webgl.dispose()
      e.webgl = null
    }
  }
  requestAnimationFrame(() => {
    if (useStore.getState().selectedId !== agentId) return
    const e = terminals.get(agentId)
    if (!e) return
    fitIfVisible(agentId)
    if (!e.webgl) {
      try {
        const gl = new WebglAddon()
        gl.onContextLoss(() => {
          gl.dispose()
          if (e.webgl === gl) e.webgl = null
        })
        e.term.loadAddon(gl)
        e.webgl = gl
      } catch {
        e.webgl = null
      }
    }
    e.term.focus()
  })
}

const SEARCH_DECORATIONS = {
  matchBackground: '#3f3f46',
  matchOverviewRuler: '#71717a',
  activeMatchBackground: '#78350f',
  activeMatchColorOverviewRuler: '#f59e0b'
}

export function findInTerminal(agentId: string, query: string, dir: 'next' | 'prev', incremental = false): void {
  const e = terminals.get(agentId)
  if (!e) return
  if (!query) {
    e.search.clearDecorations()
    return
  }
  const opts = { decorations: SEARCH_DECORATIONS, incremental }
  if (dir === 'next') e.search.findNext(query, opts)
  else e.search.findPrevious(query, opts)
}

export function clearTerminalSearch(agentId: string): void {
  terminals.get(agentId)?.search.clearDecorations()
}

export function onSearchResults(
  agentId: string,
  cb: (r: { resultIndex: number; resultCount: number }) => void
): () => void {
  const e = terminals.get(agentId)
  if (!e) return () => {}
  const d = e.search.onDidChangeResults(cb)
  return () => d.dispose()
}

export function focusTerminal(agentId: string | null): void {
  if (!agentId) return
  terminals.get(agentId)?.term.focus()
}

export function disposeTerminal(agentId: string): void {
  const e = terminals.get(agentId)
  terminals.delete(agentId)
  pending.delete(agentId)
  if (!e) return
  e.observer?.disconnect()
  e.webgl?.dispose()
  e.term.dispose()
}
