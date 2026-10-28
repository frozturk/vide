import { basename, join } from 'path'
import { app } from 'electron'
import { shellArgv } from './platform'
import { attach, ensureServer, listSessions, request, type Attached, type LitemuxSession } from './litemux'
import { runtimeStateFile, sessionPrefix } from './runtime'
import { post } from './clients'
import { AGENT_ENV, parseState, replyText, stateAfterInput, type Reply } from './agentHooks'

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

export function litemuxBin(): string {
  const name = process.platform === 'win32' ? 'litemux.exe' : 'litemux'
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'litemux', 'target', 'release', name)
}

function litemuxInfo(): string {
  return runtimeStateFile(join(app.getPath('userData'), 'litemux'))
}

const INHERITED_SESSION_VAR = /^(TMUX|TMUX_PANE|CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|CHILD_SESSION|SESSION_\w+|MESSAGING_\w+))$/

function sessionEnv(env: Record<string, string>, agentId: string): Record<string, string> {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !INHERITED_SESSION_VAR.test(key)))
  return { ...clean, [AGENT_ENV]: agentId }
}

interface Entry {
  p: Attached
  agentId: string
  clientId: string
  sessionName: string
  alive: boolean
  exited: boolean
  size: Size | null
}

export interface Size {
  cols: number
  rows: number
}

let shuttingDown = false
const ptys = new Map<string, Map<string, Entry>>()
const views = new Map<string, string | null>()
const applied = new Map<string, Size>()

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
  const prefix = sessionPrefix()
  if (!agentId) return `${prefix}session`
  const short = agentId.slice(0, 6)
  if (kindId && cwd) {
    return `${prefix}${sanitize(kindId)}-${sanitize(basename(cwd))}-${short}`
  }
  return `${prefix}${short}`
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
  await ensureServer(litemuxBin(), litemuxInfo())
  await request(litemuxInfo(), { op: 'spawn', name, cwd, argv: shellArgv(shell, command), env: sessionEnv(buildEnv(), agentId), cols: 80, rows: 24 })
  await attachInternal(clientId, agentId, name)
}

async function attachInternal(clientId: string, agentId: string, name: string): Promise<void> {
  const p = await attach(litemuxInfo(), name)
  const entry: Entry = { p, agentId, clientId, sessionName: name, alive: true, exited: false, size: null }
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
  const state = parseState(lastStates.get(agentId) ?? '')
  if (state) post(clientId, 'pty:state', { agentId, ...state })
  const reply = lastReplies.get(agentId)
  if (reply) post(clientId, 'pty:reply', { agentId, ...reply })
}

export async function attachPty(clientId: string, agentId: string, kindId?: string, cwd?: string): Promise<boolean> {
  const name = sessionName(agentId, kindId, cwd)
  if (!(await litemuxSessions()).some((s) => s.name === name)) return false
  const existing = entryOf(clientId, agentId)
  if (existing && !existing.exited) return true
  await attachInternal(clientId, agentId, name)
  return true
}

function litemuxSessions(): Promise<LitemuxSession[]> {
  return listSessions(litemuxInfo()).catch(() => [])
}

export function writePty(clientId: string, agentId: string, data: string): void {
  const e = entryOf(clientId, agentId)
  if (!e || !e.alive || e.exited) return
  e.p.write(data)
  const next = stateAfterInput(lastStates.get(agentId), data)
  if (next) {
    lastStates.set(agentId, next)
    void request(litemuxInfo(), { op: 'state', name: e.sessionName, value: next }).catch(() => {})
    for (const c of ptys.get(agentId)?.values() ?? []) post(c.clientId, 'pty:state', { agentId, ...parseState(next)! })
  }
}

export function smallestSize(sizes: Size[]): Size | null {
  if (!sizes.length) return null
  return { cols: Math.min(...sizes.map((s) => s.cols)), rows: Math.min(...sizes.map((s) => s.rows)) }
}

function applySize(agentId: string): void {
  const live = [...(ptys.get(agentId)?.values() ?? [])].filter((e) => e.alive && !e.exited)
  const size = smallestSize(live.flatMap((e) => (views.get(e.clientId) === agentId && e.size ? [e.size] : [])))
  const last = applied.get(agentId)
  if (!size || !live.length || (last?.cols === size.cols && last.rows === size.rows)) return
  applied.set(agentId, size)
  live[0].p.resize(size.cols, size.rows)
}

export function resizePty(clientId: string, agentId: string, cols: number, rows: number): void {
  const e = entryOf(clientId, agentId)
  if (!e || !e.alive || e.exited || cols < 2 || rows < 2) return
  e.size = { cols, rows }
  applySize(agentId)
}

export function viewPty(clientId: string, agentId: string | null): void {
  const previous = views.get(clientId)
  views.set(clientId, agentId)
  if (previous && previous !== agentId) applySize(previous)
  if (agentId) applySize(agentId)
}

export async function killPty(agentId: string): Promise<void> {
  const clients = ptys.get(agentId)
  const name = clients?.values().next().value?.sessionName ?? sessionName(agentId)
  await request(litemuxInfo(), { op: 'kill', name }).catch(() => {})
  lastReplies.delete(agentId)
  applied.delete(agentId)
  if (clients) {
    for (const e of clients.values()) detachEntry(e)
    ptys.delete(agentId)
  }
}

export function detachClient(clientId: string): void {
  const viewed = views.get(clientId)
  views.delete(clientId)
  for (const [agentId, clients] of ptys) {
    const e = clients.get(clientId)
    if (!e) continue
    detachEntry(e)
    clients.delete(clientId)
    if (!clients.size) ptys.delete(agentId)
  }
  if (viewed) applySize(viewed)
}

export function detachAll(): void {
  for (const clients of ptys.values()) {
    for (const e of clients.values()) detachEntry(e)
  }
  ptys.clear()
  views.clear()
  applied.clear()
}

function detachEntry(e: Entry): void {
  e.alive = false
  if (!e.exited) e.p.kill()
}

export function liveCount(): number {
  let n = 0
  for (const clients of ptys.values()) if ([...clients.values()].some((e) => !e.exited)) n++
  return n
}

export async function reapOrphanSessions(keepNames: Set<string>): Promise<void> {
  for (const { name } of await litemuxSessions()) {
    if (keepNames.has(name)) continue
    await request(litemuxInfo(), { op: 'kill', name }).catch(() => {})
    console.log('[vide/reap] killed orphan session:', name)
  }
}

let titleTimer: ReturnType<typeof setInterval> | null = null
const lastTitles = new Map<string, string>()
const lastStates = new Map<string, string>()
const lastReplies = new Map<string, Reply>()

export function startTitlePoller(): void {
  if (titleTimer) return
  titleTimer = setInterval(pollTitles, 1000)
}

async function pollTitles(): Promise<void> {
  if (!ptys.size) return
  const sessions = new Map((await litemuxSessions()).map((s) => [s.name, s]))
  for (const [agentId, clients] of ptys) {
    const entry = [...clients.values()].find((e) => !e.exited)
    const session = entry && sessions.get(entry.sessionName)
    if (!session) continue
    const text = session.replyAt > (lastReplies.get(agentId)?.at ?? 0) ? replyText(session.reply) : null
    if (text) {
      const reply = { text, at: session.replyAt }
      lastReplies.set(agentId, reply)
      for (const e of clients.values()) post(e.clientId, 'pty:reply', { agentId, ...reply })
    }
    const state = parseState(session.state)
    if (state && lastStates.get(agentId) !== session.state) {
      lastStates.set(agentId, session.state)
      for (const e of clients.values()) post(e.clientId, 'pty:state', { agentId, ...state })
    }
    const title = session.title.trim()
    if (!title || lastTitles.get(agentId) === title) continue
    lastTitles.set(agentId, title)
    for (const e of clients.values()) post(e.clientId, 'pty:title', { agentId, title })
  }
}
