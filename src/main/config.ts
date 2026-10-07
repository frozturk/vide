import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentKind, Config } from '../shared/types'

const defaults: Config = {
  agentKinds: [
    {
      id: 'claude',
      name: 'Claude Code',
      command: 'claude {prompt}',
      color: '#d97757'
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      command: 'codex --no-daemon {prompt}',
      color: '#4a9eff'
    },
    {
      id: 'opencode',
      name: 'OpenCode',
      command: 'opencode {prompt}',
      color: '#f97316'
    },
    {
      id: 'shell',
      name: 'Shell',
      command: '',
      color: '#8b8b8b'
    }
  ],
  worktreeBase: join('.vide', 'worktrees')
}

let current: Config | null = null

export function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function getConfig(): Config {
  if (!current) current = load()
  return current
}

export function reloadConfig(): Config {
  current = load()
  return current
}

export function saveConfig(config: Config): void {
  try {
    writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf8')
    current = config
  } catch (err) {
    console.error('config save failed', err)
  }
}

function mergeKinds(defaults: AgentKind[], saved: AgentKind[]): AgentKind[] {
  // A shared Codex daemon retains the environment of its first terminal,
  // causing hooks to report status to that terminal's TMUX_PANE instead.
  // Migrate only our old default; custom launch commands remain user-owned.
  const result: AgentKind[] = saved.map((kind) =>
    kind.id === 'codex' && kind.command === 'codex {prompt}'
      ? { ...kind, command: 'codex --no-daemon {prompt}' }
      : kind
  )
  for (const d of defaults) {
    if (!result.some((k) => k.id === d.id)) {
      result.push(d)
    }
  }
  return result
}

function load(): Config {
  const file = configPath()
  if (!existsSync(file)) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify(defaults, null, 2), 'utf8')
    return defaults
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const merged: Config = {
      ...defaults,
      ...parsed,
      agentKinds: mergeKinds(defaults.agentKinds, parsed.agentKinds ?? [])
    }
    return merged
  } catch (err) {
    console.error('config parse failed, using defaults', err)
    return defaults
  }
}
