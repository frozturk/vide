import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { matchChord } from '../../shared/chords'
import { useStore } from './store'

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
  nativeSelectionHandler: ((event: MouseEvent) => void) | null
  lastOutputAt: number
  lastResizeAt: number
}

export const terminals = new Map<string, TermEntry>()

export function ctrlOf(ch: string): string {
  if (ch === ' ' || ch === '@') return '\x00'
  if (ch === '?') return '\x7f'
  const code = ch.toUpperCase().charCodeAt(0)
  return code >= 64 && code <= 95 ? String.fromCharCode(code & 0x1f) : ch
}
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
    fontSize: useStore.getState().compact ? 12 : 13,
    fontFamily: 'SF Mono, Menlo, monospace',
    scrollback: 10000,
    // Keep trackpad scrolling at xterm's baseline speed.
    scrollSensitivity: 1,
    macOptionClickForcesSelection: true,
    theme: {
      background: '#09090b',
      foreground: '#d4d4d8',
      cursor: '#d4d4d8',
      selectionBackground: '#3f3f46'
    }
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon((_e, uri) => void window.vide.openExternal(uri)))
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
    if (e.type === 'keydown' && e.key.toLowerCase() === 'v' && e.metaKey && !e.ctrlKey && !e.altKey && !useStore.getState().isWeb) {
      e.preventDefault()
      void window.vide.clipboardReadText().then((text) => {
        if (text && terminals.get(agentId)?.term === term) term.paste(text)
      })
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
  term.onData((d) => {
    if (useStore.getState().ctrlArmed && d.length === 1) {
      useStore.setState({ ctrlArmed: false })
      d = ctrlOf(d)
    }
    window.vide.ptyInput(agentId, d)
  })
  term.onResize(({ cols, rows }) => window.vide.ptyResize(agentId, cols, rows))
  const entry: TermEntry = {
    term,
    fit,
    search,
    webgl: null,
    observer: null,
    container: null,
    nativeSelectionHandler: null,
    lastOutputAt: Date.now(),
    lastResizeAt: 0
  }
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
  // tmux mouse mode is enabled for wheel scrolling, but its default drag action
  // enters copy mode (yellow selection and a position counter). Force ordinary
  // left drags through xterm's native selection path instead.
  const isMac = navigator.platform.toLowerCase().includes('mac')
  const nativeSelectionHandler = (event: MouseEvent): void => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    event.preventDefault()
    event.stopImmediatePropagation()
    event.target?.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: event.view,
        detail: event.detail,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        altKey: isMac,
        shiftKey: !isMac,
        metaKey: event.metaKey
      })
    )
  }
  container.addEventListener('mousedown', nativeSelectionHandler, true)
  e.nativeSelectionHandler = nativeSelectionHandler
  e.term.open(container)
  if (useStore.getState().isWeb) installTouch(agentId, container)
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => fitIfVisible(agentId))
  })
  ro.observe(container)
  e.observer = ro
}

const WHEEL_STEP = 18

function installTouch(agentId: string, container: HTMLElement): void {
  let lastY = 0
  let startX = 0
  let startY = 0
  let acc = 0
  let moved = false
  let velocity = 0
  let lastT = 0
  let raf = 0
  const cell = (x: number, y: number): [number, number] => {
    const e = terminals.get(agentId)
    const rect = container.getBoundingClientRect()
    if (!e) return [1, 1]
    const col = Math.max(1, Math.min(e.term.cols, Math.floor(((x - rect.left) / rect.width) * e.term.cols) + 1))
    const row = Math.max(1, Math.min(e.term.rows, Math.floor(((y - rect.top) / rect.height) * e.term.rows) + 1))
    return [col, row]
  }
  const wheel = (dy: number): void => {
    acc += dy
    const [col, row] = cell(startX, startY)
    while (Math.abs(acc) >= WHEEL_STEP) {
      const up = acc > 0
      acc -= up ? WHEEL_STEP : -WHEEL_STEP
      window.vide.ptyInput(agentId, `\x1b[<${up ? 64 : 65};${col};${row}M`)
    }
  }
  container.addEventListener('touchstart', (ev) => {
    cancelAnimationFrame(raf)
    const t = ev.touches[0]
    startX = t.clientX
    startY = lastY = t.clientY
    lastT = performance.now()
    acc = 0
    velocity = 0
    moved = false
  }, { passive: true, capture: true })
  container.addEventListener('touchmove', (ev) => {
    const t = ev.touches[0]
    const dy = t.clientY - lastY
    if (!moved && Math.abs(t.clientY - startY) < 8) return
    moved = true
    ev.preventDefault()
    ev.stopPropagation()
    const now = performance.now()
    velocity = dy / Math.max(1, now - lastT)
    lastT = now
    lastY = t.clientY
    wheel(dy)
  }, { passive: false, capture: true })
  container.addEventListener('touchend', (ev) => {
    if (!moved) {
      terminals.get(agentId)?.term.focus()
      return
    }
    ev.preventDefault()
    ev.stopPropagation()
    let v = velocity * 16
    const glide = (): void => {
      if (Math.abs(v) < 0.6) return
      wheel(v)
      v *= 0.92
      raf = requestAnimationFrame(glide)
    }
    raf = requestAnimationFrame(glide)
  }, { passive: false, capture: true })
}

export function refit(agentId: string): void {
  const e = terminals.get(agentId)
  if (e) window.vide.ptyResize(agentId, e.term.cols, e.term.rows)
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
    refit(agentId)
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
    if (!useStore.getState().compact) e.term.focus()
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
  if (e.container && e.nativeSelectionHandler) {
    e.container.removeEventListener('mousedown', e.nativeSelectionHandler, true)
  }
  e.webgl?.dispose()
  e.term.dispose()
}
