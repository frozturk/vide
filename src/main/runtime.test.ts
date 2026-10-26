import { describe, expect, it } from 'vitest'
import { runtimeStateFile, sessionPrefix } from './runtime'

describe('runtime isolation', () => {
  it('uses different terminal and state namespaces in development', () => {
    expect(sessionPrefix(false)).toBe('vide-')
    expect(sessionPrefix(true)).toBe('vide-dev-')
    expect(runtimeStateFile('state', false)).toBe('state.json')
    expect(runtimeStateFile('state', true)).toBe('state.dev.json')
  })
})
