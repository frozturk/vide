import { useRef, useState } from 'react'
import { useStore } from '../store'
import { ctrlOf, terminals } from '../terminals'

const MAX_HEIGHT = 120

export function Composer({ agentId }: { agentId: string }): React.JSX.Element {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`
  }

  const send = (): void => {
    const entry = terminals.get(agentId)
    if (!entry) return
    if (text) entry.term.paste(text)
    setTimeout(() => window.vide.ptyInput(agentId, '\r'), text ? 60 : 0)
    setText('')
    requestAnimationFrame(grow)
  }

  const onChange = (value: string): void => {
    if (useStore.getState().ctrlArmed && value.length === text.length + 1 && value.startsWith(text)) {
      useStore.setState({ ctrlArmed: false })
      window.vide.ptyInput(agentId, ctrlOf(value.slice(-1)))
      return
    }
    setText(value)
    requestAnimationFrame(grow)
  }

  return (
    <div className="flex items-end gap-2 px-2 pt-2">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        enterKeyHint="send"
        autoCapitalize="sentences"
        placeholder="Message the agent…"
        className="min-h-10 min-w-0 flex-1 resize-none rounded-2xl border border-zinc-700/80 bg-zinc-800/70 px-3.5 py-2 text-[16px] leading-6 text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-zinc-500"
        style={{ maxHeight: MAX_HEIGHT }}
      />
      <button
        aria-label="Send"
        onPointerDown={(e) => e.preventDefault()}
        onClick={send}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-90 ${text ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {text ? <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /> : <path d="M13 3v5.5a2 2 0 0 1-2 2H3M6 7.5 3 10.5l3 3" />}
        </svg>
      </button>
    </div>
  )
}
