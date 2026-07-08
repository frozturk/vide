import type { AgentKind, AgentStatus } from '../../shared/types'
import type { Terminal } from '@xterm/xterm'
import { kindOf, useStore } from './store'
import { terminals } from './terminals'

const FALLBACK_WAITING = /\((y\/n|yes\/no)\)/i
const FALLBACK_BUSY = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/
export const SPINNER_GLYPHS = /[⠀-⣿◐◓◑◒◴◷◶◵]/

export function startStatusTicker(): void {
  setInterval(tick, 500)
}

function tick(): void {
  const s = useStore.getState()
  const statuses = { ...s.statuses }
  const unread = { ...s.unread }
  let changed = false
  for (const agent of s.agents) {
    const entry = terminals.get(agent.id)
    if (!entry) continue
    const kind = kindOf(s, agent)
    const prev = statuses[agent.id] ?? 'idle'
    if (prev === 'exited') continue
    const next = scanBuffer(entry.term, kind, s.titleBusy[agent.id] ?? false)
    if (next === prev) continue
    changed = true
    statuses[agent.id] = next
    if (!s.suppressUnread && agent.id !== s.selectedId && prev === 'busy' && next === 'idle') {
      unread[agent.id] = true
    }
  }
  if (changed) useStore.setState({ statuses, unread })
}

function scanBuffer(term: Terminal, kind: AgentKind | null, titleBusy: boolean): AgentStatus {
  const buf = term.buffer.active
  const end = buf.length - 1
  let text = ''
  for (let i = end; i >= 0 && text.length < 200; i--) {
    text = (buf.getLine(i)?.translateToString(true) ?? '') + '\n' + text
  }
  text = text.slice(-200)
  if (safeTest(kind?.waitingRegex, text, FALLBACK_WAITING)) return 'waiting'
  if (titleBusy || safeTest(kind?.busyRegex, text, FALLBACK_BUSY)) return 'busy'
  return 'idle'
}

function safeTest(pattern: string | undefined, text: string, fallback: RegExp): boolean {
  if (!pattern) return fallback.test(text)
  try {
    return new RegExp(pattern, 'm').test(text)
  } catch {
    return fallback.test(text)
  }
}
