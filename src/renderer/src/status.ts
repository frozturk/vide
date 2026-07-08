import type { AgentKind, AgentStatus } from '../../shared/types'
import type { Terminal } from '@xterm/xterm'
import { kindOf, useStore } from './store'
import { terminals } from './terminals'

const FALLBACK_WAITING = /\((y\/n|yes\/no)\)/i
const FALLBACK_BUSY = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/

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
    const now = Date.now()
    const recentOutput = now - entry.lastOutputAt < 1000
    const postResize = now - entry.lastResizeAt < 1200
    const next = recentOutput && !postResize ? 'busy' : scanBuffer(entry.term, kind)
    if (next === prev) continue
    changed = true
    statuses[agent.id] = next
    if (!s.suppressUnread && agent.id !== s.selectedId && prev === 'busy' && next !== 'busy') {
      unread[agent.id] = true
    }
  }
  if (changed) useStore.setState({ statuses, unread })
}

function scanBuffer(term: Terminal, kind: AgentKind | null): AgentStatus {
  const buf = term.buffer.active
  const end = buf.baseY + buf.cursorY
  let text = ''
  for (let i = Math.max(0, end - 14); i <= end; i++) {
    text += (buf.getLine(i)?.translateToString(true) ?? '') + '\n'
  }
  if (safeTest(kind?.waitingRegex, text, FALLBACK_WAITING)) return 'waiting'
  if (safeTest(kind?.busyRegex, text, FALLBACK_BUSY)) return 'busy'
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
