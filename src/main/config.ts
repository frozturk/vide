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
      color: '#d97757',
      busyRegex: 'esc to interrupt',
      waitingRegex: 'Do you want|\\(y/n\\)'
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      command: 'codex {prompt}',
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
  worktreeBase: join('.vide', 'worktrees'),
  defaultBrowserUrl: 'http://localhost:3000'
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
    writeFileSync(configPath(), JSON.stringify(config, null, 2))
    current = config
  } catch (err) {
    console.error('config save failed', err)
  }
}

function mergeKinds(defaults: AgentKind[], saved: AgentKind[]): AgentKind[] {
  const result: AgentKind[] = [...saved]
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
    writeFileSync(file, JSON.stringify(defaults, null, 2))
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
