import type { AgentStatus } from '../../../shared/types'

export const STATUS_COLOR: Record<AgentStatus, string> = { busy: '#4ade80', waiting: '#f59e0b', idle: '#71717a', exited: '#ef4444' }

export function StatusMark({ status, unread = false, size = 10 }: { status: AgentStatus; unread?: boolean; size?: number }): React.JSX.Element {
  const label = status === 'idle' && unread ? 'done' : status
  const color = STATUS_COLOR[status]
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" role="img" aria-label={label} className={`shrink-0 ${status === 'busy' ? 'animate-spin motion-reduce:animate-none' : ''}`}>
      {status === 'busy' && <>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2" />
        <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      </>}
      {status === 'waiting' && <>
        <circle cx="6" cy="6" r="6" fill={color} />
        <path d="M6 3v3.6" stroke="#09090b" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="6" cy="8.9" r="0.95" fill="#09090b" />
      </>}
      {status === 'idle' && (unread
        ? <circle cx="6" cy="6" r="4" fill="#f4f4f5" />
        : <circle cx="6" cy="6" r="3.6" fill="none" stroke={color} strokeWidth="1.5" />)}
      {status === 'exited' && <path d="M3 3l6 6M9 3l-6 6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  )
}

export function age(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}
