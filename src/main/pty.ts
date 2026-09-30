import * as pty from 'node-pty'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { basename } from 'path'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { ownsTmuxSession, tmuxSessionPrefix } from './runtime'
import { post } from './clients'
import { AGENT_ENV, STATE_OPTION, answersPrompt, parsePaneStatus } from './agentHooks'

const exec = promisify(execFile)

const exec1 = (cmd: string, args: string[], env?: Record<string, string>): Promise<{ stdout: string; stderr: string; code: number | null; message: string }> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, env }, (err, stdout, stderr) => {
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, message: err ? err.message : '' })
    })
  })

function buildEnv(): Record<string, string> {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG
  if (!locale || !/utf-?8/i.test(locale)) {
    env.LANG = 'en_US.UTF-8'
    env.LC_CTYPE = 'en_US.UTF-8'
  }
  return env
}

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
export function getTmux(): string {
  if (tmuxBin) return tmuxBin
  tmuxBin = resolveTmux()
  return tmuxBin
}

interface Entry {
  p: pty.IPty
  agentId: string
  clientId: string
  sessionName: string
  alive: boolean
  exited: boolean
}

let shuttingDown = false
const ptys = new Map<string, Map<string, Entry>>()

export function beginShutdown(): void {
  shuttingDown = true
}

function entryOf(clientId: string, agentId: string): Entry | undefined {
  return ptys.get(agentId)?.get(clientId)
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'session'
}

export function sessionName(agentId: string, kindId?: string, cwd?: string): string {
  const prefix = tmuxSessionPrefix()
  if (!agentId) return `${prefix}session`
  const short = agentId.slice(0, 6)
  if (kindId && cwd) {
    return `${prefix}${sanitize(kindId)}-${sanitize(basename(cwd))}-${short}`
  }
  return `${prefix}${short}`
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

async function configureSession(name: string): Promise<void> {
  await exec1(getTmux(), ['set-option', '-t', name, 'status', 'off'])
  await exec1(getTmux(), ['set-option', '-t', name, 'focus-events', 'on'])
  await exec1(getTmux(), ['set-option', '-t', name, 'mouse', 'on'])
}

export async function spawnPty(
  clientId: string,
  agentId: string,
  shell: string,
  command: string,
  cwd: string,
  kindId?: string
): Promise<void> {
  const name = sessionName(agentId, kindId, cwd)
  await exec1(getTmux(), ['kill-session', '-t', name])
  const env = buildEnv()
  const newArgs = [
    '-f', '/dev/null',
    'new-session', '-d', '-s', name, '-x', '80', '-y', '24',
    '-c', cwd,
    '-e', `${AGENT_ENV}=${agentId}`,
    '--', shell
  ]
  if (command) {
    newArgs.push('-ilc', command)
  } else {
    newArgs.push('-il')
  }
  console.log('[vide/spawnPty] tmux:', getTmux(), 'args:', newArgs.join(' '))
  const result = await exec1(getTmux(), newArgs, env)
  console.log('[vide/spawnPty] tmux result code:', result.code, 'stderr:', JSON.stringify(result.stderr), 'stdout:', JSON.stringify(result.stdout), 'message:', result.message)
  if (result.code !== 0) {
    throw new Error(`tmux new-session failed (code ${result.code}): ${result.stderr || result.message}`)
  }
  await configureSession(name)
  const exists = await sessionExists(name)
  console.log('[vide/spawnPty] session created:', name, 'exists:', exists)
  await attachInternal(clientId, agentId, name, env)
}

async function attachInternal(clientId: string, agentId: string, name: string, env: Record<string, string>): Promise<void> {
  const p = pty.spawn(getTmux(), ['attach', '-t', name], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: env.PWD ?? process.env.HOME ?? '/',
    env
  })
  const entry: Entry = { p, agentId, clientId, sessionName: name, alive: true, exited: false }
  const clients = ptys.get(agentId) ?? new Map<string, Entry>()
  clients.set(clientId, entry)
  ptys.set(agentId, clients)
  p.onData((data) => {
    if (entry.alive) post(clientId, 'pty:data', { agentId, data })
  })
  p.onExit(({ exitCode }) => {
    entry.exited = true
    if (shuttingDown || !entry.alive) return
    post(clientId, 'pty:exit', { agentId, exitCode })
  })
  const title = lastTitles.get(agentId)
  if (title) post(clientId, 'pty:title', { agentId, title })
  const state = lastStates.get(agentId)
  if (state) post(clientId, 'pty:state', { agentId, state })
}

export async function attachPty(clientId: string, agentId: string, kindId?: string, cwd?: string): Promise<boolean> {
  const name = sessionName(agentId, kindId, cwd)
  if (!(await sessionExists(name))) return false
  await configureSession(name)
  const existing = entryOf(clientId, agentId)
  if (existing && !existing.exited) return true
  const env = buildEnv()
  await attachInternal(clientId, agentId, name, env)
  return true
}

export function writePty(clientId: string, agentId: string, data: string): void {
  const e = entryOf(clientId, agentId)
  if (!e || !e.alive || e.exited) return
  e.p.write(data)
  if (lastStates.get(agentId) === 'waiting' && answersPrompt(data)) {
    lastStates.set(agentId, 'idle')
    void exec1(getTmux(), ['set-option', '-p', '-t', e.sessionName, STATE_OPTION, 'idle'])
    for (const c of ptys.get(agentId)?.values() ?? []) post(c.clientId, 'pty:state', { agentId, state: 'idle' })
  }
}

export function resizePty(clientId: string, agentId: string, cols: number, rows: number): void {
  const e = entryOf(clientId, agentId)
  if (!e || !e.alive || e.exited || cols < 2 || rows < 2) return
  void exec1(getTmux(), ['resize-window', '-t', e.sessionName, '-x', String(cols), '-y', String(rows)])
  try {
    e.p.resize(cols, rows)
  } catch {
    /* race with exit */
  }
}

export async function killPty(agentId: string): Promise<void> {
  const clients = ptys.get(agentId)
  const name = clients?.values().next().value?.sessionName ?? sessionName(agentId)
  await exec1(getTmux(), ['kill-session', '-t', name])
  if (clients) {
    for (const e of clients.values()) detachEntry(e)
    ptys.delete(agentId)
  }
}

export function detachClient(clientId: string): void {
  for (const [agentId, clients] of ptys) {
    const e = clients.get(clientId)
    if (!e) continue
    detachEntry(e)
    clients.delete(clientId)
    if (!clients.size) ptys.delete(agentId)
  }
}

export function detachAll(): void {
  for (const clients of ptys.values()) {
    for (const e of clients.values()) detachEntry(e)
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
  for (const clients of ptys.values()) if ([...clients.values()].some((e) => !e.exited)) n++
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
    if (!ownsTmuxSession(name)) continue
    if (keepNames.has(name)) continue
    await exec1(getTmux(), ['kill-session', '-t', name])
    console.log('[vide/reap] killed orphan tmux session:', name)
  }
}

let titleTimer: ReturnType<typeof setInterval> | null = null
const lastTitles = new Map<string, string>()
const lastStates = new Map<string, string>()

export function startTitlePoller(): void {
  if (titleTimer) return
  titleTimer = setInterval(pollTitles, 1000)
}

async function pollTitles(): Promise<void> {
  for (const [agentId, clients] of ptys) {
    const entry = [...clients.values()].find((e) => !e.exited)
    if (!entry) continue
    let line: string
    try {
      const { stdout } = await exec(getTmux(), ['display-message', '-p', '-t', entry.sessionName, `#{pane_title}\t#{${STATE_OPTION}}`], { timeout: 3000 })
      line = stdout.replace(/\n$/, '')
    } catch {
      continue
    }
    const { title, state } = parsePaneStatus(line)
    if (state && lastStates.get(agentId) !== state) {
      lastStates.set(agentId, state)
      for (const e of clients.values()) post(e.clientId, 'pty:state', { agentId, state })
    }
    if (!title || lastTitles.get(agentId) === title) continue
    lastTitles.set(agentId, title)
    for (const e of clients.values()) post(e.clientId, 'pty:title', { agentId, title })
  }
}
