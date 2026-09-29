import { useEffect, useState } from 'react'
import type { LocalServer } from '../../../shared/types'
import { basename } from '../util'

function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, '~')
}

function location(cwd: string): React.JSX.Element {
  const match = cwd.match(/^(.*)\/\.vide\/worktrees\/([^/]+)\/?(.*)$/)
  if (!match) return <>{shortPath(cwd)}</>
  return (
    <>
      <span className="text-zinc-200">{basename(match[1])}</span>
      <span className="text-zinc-500"> / </span>
      <span className="text-zinc-200">{match[2]}</span>
      {match[3] && <span className="text-zinc-500"> · {match[3]}</span>}
    </>
  )
}

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function LocalServers(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<LocalServer[]>([])
  const [terminated, setTerminated] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const refresh = (): void => {
    window.vide.localServers().then(setServers).catch(() => {})
  }

  useEffect(() => {
    if (!open) return
    refresh()
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [open])

  const kill = async (pid: number): Promise<void> => {
    const force = terminated.has(pid)
    try {
      await window.vide.localServerKill(pid, force)
      setError(null)
      setTerminated((s) => new Set(s).add(pid))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setTimeout(refresh, 300)
  }

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen(!open)
          setError(null)
        }}
        className={`flex items-center justify-center rounded-md h-6 w-7 text-xs transition ${
          open ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        }`}
        title="Running localhost servers"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
          <rect x="2" y="9" width="12" height="4.5" rx="1" />
          <circle cx="4.75" cy="4.75" r="0.6" fill="currentColor" />
          <circle cx="4.75" cy="11.25" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 max-h-[70vh] w-[420px] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
            <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">Localhost</div>
            {servers.length === 0 && <div className="px-3 py-2 text-xs text-zinc-600">no running servers</div>}
            {servers.map((s) => (
              <div key={s.pid} className="flex items-start gap-2 border-t border-zinc-800 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[...new Set(s.ports.map((p) => p.port))].map((port) => (
                      <button
                        key={port}
                        onClick={() => void window.vide.openExternal(`http://localhost:${port}`)}
                        className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[11px] leading-none text-emerald-400 transition hover:bg-emerald-900/60"
                        title={`Open http://localhost:${port}`}
                      >
                        :{port}
                      </button>
                    ))}
                    <span className="text-xs font-medium text-zinc-200" title={s.args}>{s.command}</span>
                    <span className="text-[11px] text-zinc-500">pid {s.pid}</span>
                    {s.startedAt && (
                      <span className="text-[11px] text-zinc-500" title={`Started ${new Date(s.startedAt).toLocaleString()}`}>
                        · up {duration(Date.now() - s.startedAt)}
                      </span>
                    )}
                  </div>
                  {s.cwd && (
                    <div className="mt-1 truncate text-[11px] text-zinc-400" title={s.cwd}>
                      {location(s.cwd)}
                    </div>
                  )}
                  <div className="mt-0.5 text-[10px] text-zinc-600">
                    {[...new Set(s.ports.map((p) => p.host))].join(', ')}
                  </div>
                </div>
                <button
                  onClick={() => void kill(s.pid)}
                  className="shrink-0 rounded px-2 py-1 text-[11px] leading-none text-red-400 transition hover:bg-red-950/50"
                  title={terminated.has(s.pid) ? 'Send SIGKILL' : 'Send SIGTERM'}
                >
                  {terminated.has(s.pid) ? 'Force kill' : 'Kill'}
                </button>
              </div>
            ))}
            {error && <div className="border-t border-zinc-800 px-3 py-1 text-[11px] text-red-400">{error}</div>}
          </div>
        </>
      )}
    </div>
  )
}
