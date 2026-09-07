import { describe, expect, it } from 'vitest'
import { ownsTmuxSession, runtimeStateFile, tmuxSessionPrefix } from './runtime'

describe('runtime isolation', () => {
  it('uses different terminal and state namespaces in development', () => {
    expect(tmuxSessionPrefix(false)).toBe('vide-')
    expect(tmuxSessionPrefix(true)).toBe('vide-dev-')
    expect(runtimeStateFile('state', false)).toBe('state.json')
    expect(runtimeStateFile('state', true)).toBe('state.dev.json')
  })

  it('never claims sessions from the other runtime', () => {
    expect(ownsTmuxSession('vide-codex-app-123456', false)).toBe(true)
    expect(ownsTmuxSession('vide-dev-codex-app-123456', false)).toBe(false)
    expect(ownsTmuxSession('vide-dev-codex-app-123456', true)).toBe(true)
    expect(ownsTmuxSession('vide-codex-app-123456', true)).toBe(false)
  })
})
