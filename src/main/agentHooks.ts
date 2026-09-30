import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AgentStatus } from '../shared/types'

export const STATE_OPTION = '@vide_state'
export const AGENT_ENV = 'VIDE_AGENT'

type HookValue = 'idle' | 'busy' | 'waiting' | 'tool'
type HookEvent = { event: string; matcher?: string; value: HookValue }

const COMMON_EVENTS: HookEvent[] = [
  { event: 'SessionStart', value: 'idle' },
  { event: 'UserPromptSubmit', value: 'busy' },
  { event: 'PreToolUse', value: 'tool' },
  { event: 'PostToolUse', value: 'busy' },
  { event: 'PermissionRequest', value: 'waiting' },
  { event: 'Stop', value: 'idle' }
]

const CODEX_EVENTS: HookEvent[] = [...COMMON_EVENTS, { event: 'Interrupt', value: 'idle' }]

const CLAUDE_EVENTS: HookEvent[] = [
  ...COMMON_EVENTS,
  { event: 'StopFailure', value: 'idle' },
  { event: 'Notification', matcher: 'permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input', value: 'waiting' }
]

const TOOL_NAME = `"busy:$(sed -n 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -n1)"`

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

export function hookCommand(tmux: string, value: HookValue): string {
  const state = value === 'tool' ? TOOL_NAME : value
  return `[ -n "$${AGENT_ENV}" ] && [ -n "$TMUX_PANE" ] && ${shellQuote(tmux)} set-option -p -t "$TMUX_PANE" ${STATE_OPTION} ${state} >/dev/null 2>&1; true`
}

type HookGroup = { matcher?: string; hooks?: { command?: string }[] }
type HookConfig = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

function isVideGroup(group: HookGroup): boolean {
  return Boolean(group.hooks?.some((h) => h.command?.includes(`$${AGENT_ENV}`)))
}

export function mergeHooks(config: HookConfig, events: HookEvent[], tmux: string): HookConfig {
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    const kept = (Array.isArray(groups) ? groups : []).filter((g) => !isVideGroup(g))
    if (kept.length) hooks[event] = kept
  }
  for (const { event, matcher, value } of events) {
    const group = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCommand(tmux, value) }] }
    hooks[event] = [...(hooks[event] ?? []), group]
  }
  return { ...config, hooks }
}

function installInto(file: string, events: HookEvent[], tmux: string): void {
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
  const after = JSON.stringify(mergeHooks(config, events, tmux), null, 2) + '\n'
  if (after === before) return
  const tmp = `${file}.vide-tmp`
  writeFileSync(tmp, after, 'utf8')
  renameSync(tmp, file)
}

export function installAgentHooks(tmux: string): void {
  const home = homedir()
  for (const [file, events] of [
    [join(home, '.claude', 'settings.json'), CLAUDE_EVENTS],
    [join(home, '.codex', 'hooks.json'), CODEX_EVENTS]
  ] as const) {
    try {
      installInto(file, events, tmux)
    } catch (err) {
      console.error('[vide/hooks] install failed:', file, err)
    }
  }
}

export function parsePaneStatus(line: string): { title: string; raw: string } {
  const tab = line.lastIndexOf('\t')
  return { title: (tab < 0 ? line : line.slice(0, tab)).trim(), raw: tab < 0 ? '' : line.slice(tab + 1).trim() }
}
