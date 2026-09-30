import { useRef } from 'react'
import { useStore } from '../store'
import { terminals } from '../terminals'

type Key = { label: React.ReactNode; aria: string; send?: string | ((appCursor: boolean) => string); repeat?: boolean; action?: 'ctrl' | 'paste' | 'keyboard'; wide?: boolean }

const arrow = (dir: string) => (appCursor: boolean) => `\x1b${appCursor ? 'O' : '['}${dir}`

const KEYS: Key[] = [
  { label: 'esc', aria: 'Escape', send: '\x1b' },
  { label: 'tab', aria: 'Tab', send: '\t' },
  { label: 'ctrl', aria: 'Control modifier', action: 'ctrl' },
  { label: '^C', aria: 'Interrupt', send: '\x03' },
  { label: '↑', aria: 'Up', send: arrow('A'), repeat: true },
  { label: '↓', aria: 'Down', send: arrow('B'), repeat: true },
  { label: '←', aria: 'Left', send: arrow('D'), repeat: true },
  { label: '→', aria: 'Right', send: arrow('C'), repeat: true },
  { label: '⇧tab', aria: 'Shift Tab', send: '\x1b[Z' },
  { label: '/', aria: 'Slash', send: '/' },
  { label: '⏎', aria: 'Enter', send: '\r', wide: true },
  {
    label: <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="3.5" y="3" width="9" height="11" rx="1.5" /><path d="M6 3V2h4v1" /></svg>,
    aria: 'Paste',
    action: 'paste'
  },
  {
    label: <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1.5" y="3.5" width="13" height="7" rx="1.5" /><path d="M4 6h.01M6.5 6h.01M9 6h.01M11.5 6h.01M5 8.5h6M6 13l2 1.5 2-1.5" /></svg>,
    aria: 'Toggle keyboard',
    action: 'keyboard'
  }
]

function haptic(): void {
  try {
    navigator.vibrate?.(8)
  } catch {
    return
  }
}

export function KeyBar(): React.JSX.Element | null {
  const selectedId = useStore((s) => s.selectedId)
  const ctrlArmed = useStore((s) => s.ctrlArmed)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (!selectedId) return null

  const stop = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const fire = (key: Key): void => {
    const entry = terminals.get(selectedId)
    if (!entry) return
    if (key.action === 'ctrl') return useStore.setState({ ctrlArmed: !useStore.getState().ctrlArmed })
    if (key.action === 'keyboard') {
      const textarea = entry.term.textarea
      if (textarea && document.activeElement === textarea) textarea.blur()
      else entry.term.focus()
      return
    }
    if (key.action === 'paste') {
      void window.vide.clipboardReadText().then((text) => {
        if (text) entry.term.paste(text)
      })
      return
    }
    const data = typeof key.send === 'function' ? key.send(entry.term.modes.applicationCursorKeysMode) : key.send
    if (data) window.vide.ptyInput(selectedId, data)
  }

  const press = (key: Key): void => {
    haptic()
    fire(key)
    if (!key.repeat) return
    const loop = (delay: number): void => {
      timer.current = setTimeout(() => {
        fire(key)
        loop(55)
      }, delay)
    }
    loop(380)
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-30 border-t border-zinc-800/80 bg-zinc-900/95 backdrop-blur-md"
      style={{ height: 'var(--keybar-h)', paddingBottom: 'calc(var(--keybar-h) - 48px)' }}
    >
      <div className="no-scrollbar flex h-12 items-center gap-1.5 overflow-x-auto px-2">
        {KEYS.map((key) => {
          const armed = key.action === 'ctrl' && ctrlArmed
          return (
            <button
              key={key.aria}
              aria-label={key.aria}
              aria-pressed={key.action === 'ctrl' ? armed : undefined}
              onPointerDown={(e) => {
                e.preventDefault()
                press(key)
              }}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              onContextMenu={(e) => e.preventDefault()}
              className={`flex h-9 shrink-0 select-none items-center justify-center rounded-lg font-mono text-[13px] transition-[transform,background-color,color] duration-100 active:scale-90 ${key.wide ? 'min-w-14 px-3' : 'min-w-10 px-2.5'} ${
                armed ? 'bg-sky-500 text-white shadow-[0_0_0_1px_rgba(56,189,248,0.5)]' : 'bg-zinc-800 text-zinc-200 active:bg-zinc-700'
              }`}
            >
              {key.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
