import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AgentStatus } from '../shared/types'

export const AGENT_ENV = 'VIDE_AGENT'

type HookValue = 'idle' | 'busy' | 'waiting' | 'tool' | 'reply'
type HookEvent = { event: string; matcher?: string; value: HookValue }

const COMMON_EVENTS: HookEvent[] = [
  { event: 'SessionStart', value: 'idle' },
  { event: 'UserPromptSubmit', value: 'busy' },
  { event: 'PreToolUse', value: 'tool' },
  { event: 'PostToolUse', value: 'busy' },
  { event: 'PermissionRequest', value: 'waiting' },
  { event: 'Stop', value: 'reply' }
]

const CODEX_EVENTS: HookEvent[] = [...COMMON_EVENTS, { event: 'Interrupt', value: 'idle' }]

const CLAUDE_EVENTS: HookEvent[] = [
  ...COMMON_EVENTS,
  { event: 'StopFailure', value: 'idle' },
  { event: 'Notification', matcher: 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input', value: 'waiting' }
]

export function stateAfterInput(raw: string | undefined, data: string): string | null {
  if (!raw) return null
  if (raw === 'waiting' && data.includes('\r')) return 'busy'
  if (data === '\x1b' && (raw === 'waiting' || raw.startsWith('busy'))) return 'idle'
  return null
}

export function parseState(raw: string): { state: AgentStatus; activity: string | null } | null {
  if (raw === 'idle' || raw === 'waiting') return { state: raw, activity: null }
  if (raw === 'busy') return { state: 'busy', activity: 'Thinking' }
  if (raw.startsWith('busy:')) return { state: 'busy', activity: raw.slice(5) || 'Thinking' }
  return null
}

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

type Agent = 'claude' | 'codex'
type Hook = { type: 'command'; command: string; args?: string[]; commandWindows?: string }

export function hookEntry(bin: string, value: HookValue, agent: Agent): Hook {
  if (agent === 'claude') return { type: 'command', command: bin, args: ['hook', value] }
  return { type: 'command', command: `${shellQuote(bin)} hook ${value}`, commandWindows: `& '${bin.replace(/'/g, "''")}' hook ${value}` }
}

export type Reply = { text: string; at: number }

export function replyText(message: string): string | null {
  const text = message.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*(#+|>|[-*] )\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 280) : null
}

type HookGroup = { matcher?: string; hooks?: { command?: string; args?: string[] }[] }
type HookConfig = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

function isVideGroup(group: HookGroup): boolean {
  return Boolean(group.hooks?.some((h) => {
    if (h.command?.includes(`$${AGENT_ENV}`) || /litemux(\.exe)?'? hook \w+$/.test(h.command ?? '')) return true
    if (/litemux(\.exe)?$/.test(h.command ?? '') && h.args?.[0] === 'hook') return true
    const encoded = h.command?.match(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1]
    return encoded ? Buffer.from(encoded, 'base64').toString('utf16le').startsWith('# vide-agent-hook\n') : false
  }))
}

export function mergeHooks(config: HookConfig, events: HookEvent[], bin: string, agent: Agent): HookConfig {
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    const kept = (Array.isArray(groups) ? groups : []).filter((g) => !isVideGroup(g))
    if (kept.length) hooks[event] = kept
  }
  for (const { event, matcher, value } of events) {
    const group = { ...(matcher ? { matcher } : {}), hooks: [hookEntry(bin, value, agent)] }
    hooks[event] = [...(hooks[event] ?? []), group]
  }
  return { ...config, hooks }
}

function installInto(file: string, events: HookEvent[], bin: string, agent: Agent): void {
  if (!existsSync(dirname(file))) return
  let config: HookConfig = {}
  let before = ''
  if (existsSync(file)) {
    before = readFileSync(file, 'utf8')
    try {
      config = before.trim() ? JSON.parse(before) : {}
    } catch {
      console.error('[vide/hooks] not valid JSON, leaving untouched:', file)
      return
    }
  }
  const after = JSON.stringify(mergeHooks(config, events, bin, agent), null, 2) + '\n'
  if (after === before) return
  const tmp = `${file}.vide-tmp`
  writeFileSync(tmp, after, 'utf8')
  renameSync(tmp, file)
}

export function installAgentHooks(bin: string): void {
  const home = homedir()
  for (const [file, events, agent] of [
    [join(home, '.claude', 'settings.json'), CLAUDE_EVENTS, 'claude'],
    [join(home, '.codex', 'hooks.json'), CODEX_EVENTS, 'codex']
  ] as const) {
    try {
      installInto(file, events, bin, agent)
    } catch (err) {
      console.error('[vide/hooks] install failed:', file, err)
    }
  }
}
