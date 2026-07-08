import * as pty from 'node-pty'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type { WebContents } from 'electron'

const exec = promisify(execFile)

const exec1 = (cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null; message: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, message: err ? err.message : '' })
    })
  })

function resolveTmux(): string {
  if (process.env.VIDE_TMUX) return process.env.VIDE_TMUX
  const candidates = [
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/usr/bin/tmux',
    '/bin/tmux',
    `${homedir()}/.nix-profile/bin/tmux`,
    '/run/current-system/sw/bin/tmux'
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return 'tmux'
}

let tmuxBin: string | null = null
function getTmux(): string {
  if (tmuxBin) return tmuxBin
  tmuxBin = resolveTmux()
  return tmuxBin
}

interface Entry {
  p: pty.IPty
  agentId: string
  sessionName: string
  alive: boolean
  exited: boolean
}

let shuttingDown = false
const ptys = new Map<string, Entry>()

export function beginShutdown(): void {
  shuttingDown = true
}
let target: WebContents | null = null

export function setTarget(wc: WebContents): void {
  target = wc
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'session'
}

export function sessionName(agentId: string, kindId?: string, cwd?: string): string {
  if (!agentId) return 'vide-session'
  const short = agentId.slice(0, 6)
  if (kindId && cwd) {
    return `vide-${sanitize(kindId)}-${sanitize(basename(cwd))}-${short}`
  }
  return `vide-${short}`
}

async function tmux(args: string[]): Promise<string> {
  const { stdout } = await exec(getTmux(), args, { timeout: 5000 })
  return stdout
}

async function sessionExists(name: string): Promise<boolean> {
  try {
    await tmux(['has-session', '-t', name])
    return true
  } catch {
    return false
  }
}

export async function spawnPty(
  agentId: string,
  shell: string,
  command: string,
  cwd: string,
  kindId?: string
): Promise<void> {
  const name = sessionName(agentId, kindId, cwd)
  await exec1(getTmux(), ['kill-session', '-t', name])
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const newArgs = [
    '-f', '/dev/null',
    'new-session', '-d', '-s', name, '-x', '80', '-y', '24',
    '-c', cwd,
    '--', shell
  ]
  if (command) {
    newArgs.push('-ilc', command)
  } else {
    newArgs.push('-il')
  }
  console.log('[vide/spawnPty] tmux:', getTmux(), 'args:', newArgs.join(' '))
  const result = await exec1(getTmux(), newArgs)
  console.log('[vide/spawnPty] tmux result code:', result.code, 'stderr:', JSON.stringify(result.stderr), 'stdout:', JSON.stringify(result.stdout), 'message:', result.message)
  if (result.code !== 0) {
    throw new Error(`tmux new-session failed (code ${result.code}): ${result.stderr || result.message}`)
  }
  await exec1(getTmux(), ['set-option', '-t', name, 'status', 'off'])
  await exec1(getTmux(), ['set-option', '-t', name, 'focus-events', 'on'])
  const exists = await sessionExists(name)
  console.log('[vide/spawnPty] session created:', name, 'exists:', exists)
  await attachInternal(agentId, name, env)
}

async function attachInternal(agentId: string, name: string, env: Record<string, string>): Promise<void> {
  const p = pty.spawn(getTmux(), ['attach', '-t', name], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: env.PWD ?? process.env.HOME ?? '/',
    env
  })
  const entry: Entry = { p, agentId, sessionName: name, alive: true, exited: false }
  ptys.set(agentId, entry)
  p.onData((data) => {
    if (target && !target.isDestroyed()) target.send('pty:data', { agentId, data })
  })
  p.onExit(({ exitCode }) => {
    entry.exited = true
    if (shuttingDown) return
    if (target && !target.isDestroyed()) target.send('pty:exit', { agentId, exitCode })
  })
}

export async function attachPty(agentId: string, kindId?: string, cwd?: string): Promise<boolean> {
  const name = sessionName(agentId, kindId, cwd)
  if (!(await sessionExists(name))) return false
  const existing = ptys.get(agentId)
  if (existing && !existing.exited) return true
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  await attachInternal(agentId, name, env)
  return true
}

export function writePty(agentId: string, data: string): void {
  const e = ptys.get(agentId)
  if (e && e.alive && !e.exited) e.p.write(data)
}

export function resizePty(agentId: string, cols: number, rows: number): void {
  const e = ptys.get(agentId)
  if (!e || !e.alive || e.exited || cols < 2 || rows < 2) return
  void exec1(getTmux(), ['resize-window', '-t', e.sessionName, '-x', String(cols), '-y', String(rows)])
  try {
    e.p.resize(cols, rows)
  } catch {
    /* race with exit */
  }
}

export async function killPty(agentId: string): Promise<void> {
  const e = ptys.get(agentId)
  const name = e?.sessionName ?? sessionName(agentId)
  await exec1(getTmux(), ['kill-session', '-t', name])
  if (e) {
    detachEntry(e)
    ptys.delete(agentId)
  }
}

export function killAll(killSessions = false): void {
  for (const e of ptys.values()) {
    detachEntry(e)
    if (killSessions) void exec1(getTmux(), ['kill-session', '-t', e.sessionName])
  }
  ptys.clear()
}

export function detachAll(): void {
  for (const e of ptys.values()) {
    detachEntry(e)
  }
  ptys.clear()
}

function detachEntry(e: Entry): void {
  e.alive = false
  if (!e.exited) {
    try {
      e.p.kill()
    } catch {
      /* ignore */
    }
  }
}

export function liveCount(): number {
  let n = 0
  for (const e of ptys.values()) if (!e.exited) n++
  return n
}

export async function reapOrphanSessions(keepNames: Set<string>): Promise<void> {
  let list: string
  try {
    const { stdout } = await exec(getTmux(), ['list-sessions', '-F', '#{session_name}'], { timeout: 5000 })
    list = stdout
  } catch {
    return
  }
  for (const line of list.split('\n')) {
    const name = line.trim()
    if (!name.startsWith('vide-')) continue
    if (keepNames.has(name)) continue
    await exec1(getTmux(), ['kill-session', '-t', name])
    console.log('[vide/reap] killed orphan tmux session:', name)
  }
}

let titleTimer: ReturnType<typeof setInterval> | null = null
const lastTitles = new Map<string, string>()

export function startTitlePoller(): void {
  if (titleTimer) return
  titleTimer = setInterval(pollTitles, 2000)
}

async function pollTitles(): Promise<void> {
  for (const [agentId, entry] of ptys) {
    if (entry.exited) continue
    let title: string
    try {
      const { stdout } = await exec(getTmux(), ['display-message', '-p', '-t', entry.sessionName, '#{pane_title}'], { timeout: 3000 })
      title = stdout.trim()
    } catch {
      continue
    }
    if (!title) continue
    const prev = lastTitles.get(agentId)
    if (prev === title) continue
    lastTitles.set(agentId, title)
    if (target && !target.isDestroyed()) target.send('pty:title', { agentId, title })
  }
}
