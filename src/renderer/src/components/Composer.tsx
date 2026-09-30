import { useRef, useState } from 'react'
import { useStore } from '../store'
import { ctrlOf, terminals } from '../terminals'
import { anticipateKeyboard, focusWithoutPan } from '../keyboard'

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
    <div className="mx-auto w-full max-w-2xl px-3 pt-3">
      <div className="flex items-end gap-1 rounded-[22px] bg-black py-1 pl-4 pr-1 shadow-[0_10px_40px_-8px_rgba(0,0,0,0.9)] ring-1 ring-white/10 transition-shadow focus-within:ring-white/20">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onPointerDown={(e) => {
            if (e.pointerType !== 'touch' || document.activeElement === e.currentTarget) return
            e.preventDefault()
            anticipateKeyboard(true)
            focusWithoutPan(e.currentTarget)
          }}
          onBlur={() => anticipateKeyboard(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          enterKeyHint="send"
          autoCapitalize="sentences"
          placeholder="Message the agent"
          className="min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-[16px] leading-6 text-zinc-100 caret-zinc-100 outline-none placeholder:text-zinc-600"
          style={{ maxHeight: MAX_HEIGHT }}
        />
        <button
          aria-label={text ? 'Send' : 'Press Enter'}
          onPointerDown={(e) => e.preventDefault()}
          onClick={send}
          className={`mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90 ${text ? 'bg-white text-black' : 'bg-white/[0.06] text-zinc-500'}`}
        >
          <svg className="h-[15px] w-[15px]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {text ? <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" /> : <path d="M13 3v5.5a2 2 0 0 1-2 2H3M6 7.5 3 10.5l3 3" />}
          </svg>
        </button>
      </div>
    </div>
  )
}
