import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import type { AgentStatus } from '../shared/types'

export const STATE_OPTION = '@vide_state'
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

export function hookCommand(tmux: string, value: HookValue, replyDir = '', platform = process.platform): string {
  if (platform === 'win32') {
    const dir = `'${replyDir.replace(/'/g, "''")}'`
    const script = `# vide-agent-hook
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
  if (!$env:VIDE_AGENT -or !$env:LITEMUX_SESSION -or !$env:LITEMUX_BIN) { exit 0 }
  $state = '${value === 'reply' ? 'idle' : value === 'tool' ? 'busy' : value}'
  ${value === 'tool' || value === 'reply' ? '$payload = [Console]::In.ReadToEnd()' : ''}
  ${value === 'tool' ? 'try { $tool = ($payload | ConvertFrom-Json).tool_name; if ($tool) { $state = "busy:$tool" } } catch {}' : ''}
  ${value === 'reply' && replyDir ? `if ($env:VIDE_AGENT -match '^[a-zA-Z0-9_-]+$') { [IO.File]::WriteAllText((Join-Path ${dir} ($env:VIDE_AGENT + '.json')), $payload, (New-Object Text.UTF8Encoding($false))) }` : ''}
  & $env:LITEMUX_BIN state $state *> $null
} catch {}
exit 0`
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`
  }
  const state = value === 'tool' ? TOOL_NAME : value === 'reply' ? 'idle' : value
  const setState = `if [ -n "$LITEMUX_SESSION" ]; then "$LITEMUX_BIN" state ${state}; else ${shellQuote(tmux)} set-option -p -t "$TMUX_PANE" ${STATE_OPTION} ${state}; fi`
  const action = value === 'reply' && replyDir ? `{ cat > ${shellQuote(replyDir)}/"$${AGENT_ENV}".json; ${setState}; }` : setState
  return `[ -n "$${AGENT_ENV}" ] && [ -n "$TMUX_PANE$LITEMUX_SESSION" ] && ${action} >/dev/null 2>&1; true`
}

export type Reply = { text: string; at: number }

export function replyText(raw: string): string | null {
  let message: unknown
  try {
    message = JSON.parse(raw).last_assistant_message
  } catch {
    return null
  }
  if (typeof message !== 'string') return null
  const text = message.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*(#+|>|[-*] )\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 280) : null
}

export function readReply(replyDir: string, agentId: string, since = 0): Reply | null {
  const file = join(replyDir, `${agentId}.json`)
  try {
    const at = statSync(file).mtimeMs
    if (at <= since) return null
    const text = replyText(readFileSync(file, 'utf8'))
    return text ? { text, at } : null
  } catch {
    return null
  }
}

type HookGroup = { matcher?: string; hooks?: { command?: string }[] }
type HookConfig = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

function isVideGroup(group: HookGroup): boolean {
  return Boolean(group.hooks?.some((h) => {
    if (h.command?.includes(`$${AGENT_ENV}`)) return true
    const encoded = h.command?.match(/^powershell\.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ([A-Za-z0-9+/=]+)$/)?.[1]
    return encoded ? Buffer.from(encoded, 'base64').toString('utf16le').startsWith('# vide-agent-hook\n') : false
  }))
}

export function mergeHooks(config: HookConfig, events: HookEvent[], tmux: string, replyDir = ''): HookConfig {
  const hooks: Record<string, HookGroup[]> = {}
  for (const [event, groups] of Object.entries(config.hooks ?? {})) {
    const kept = (Array.isArray(groups) ? groups : []).filter((g) => !isVideGroup(g))
    if (kept.length) hooks[event] = kept
  }
  for (const { event, matcher, value } of events) {
    const group = { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: hookCommand(tmux, value, replyDir) }] }
    hooks[event] = [...(hooks[event] ?? []), group]
  }
  return { ...config, hooks }
}

function installInto(file: string, events: HookEvent[], tmux: string, replyDir: string): void {
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
  const after = JSON.stringify(mergeHooks(config, events, tmux, replyDir), null, 2) + '\n'
  if (after === before) return
  const tmp = `${file}.vide-tmp`
  writeFileSync(tmp, after, 'utf8')
  renameSync(tmp, file)
}

export function installAgentHooks(tmux: string, replyDir: string): void {
  const home = homedir()
  mkdirSync(replyDir, { recursive: true })
  for (const [file, events] of [
    [join(home, '.claude', 'settings.json'), CLAUDE_EVENTS],
    [join(home, '.codex', 'hooks.json'), CODEX_EVENTS]
  ] as const) {
    try {
      installInto(file, events, tmux, replyDir)
    } catch (err) {
      console.error('[vide/hooks] install failed:', file, err)
    }
  }
}

export function parsePaneStatus(line: string): { title: string; raw: string } {
  const tab = line.lastIndexOf('\t')
  return { title: (tab < 0 ? line : line.slice(0, tab)).trim(), raw: tab < 0 ? '' : line.slice(tab + 1).trim() }
}
