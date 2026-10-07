import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configPath, reloadConfig } from './config'

const mock = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({ app: { getPath: () => mock.userData } }))

beforeEach(() => { mock.userData = mkdtempSync(join(tmpdir(), 'vide-config-')) })
afterEach(() => rmSync(mock.userData, { recursive: true, force: true }))

describe('Codex terminal isolation', () => {
  it('persists an isolated launch command for new installations', () => {
    const config = reloadConfig()
    expect(config.agentKinds.find((kind) => kind.id === 'codex')?.command).toBe('codex --no-daemon {prompt}')
    expect(JSON.parse(readFileSync(configPath(), 'utf8'))).toEqual(config)
  })

  it('migrates the old default while preserving saved settings', () => {
    writeFileSync(configPath(), JSON.stringify({
      shell: '/bin/bash',
      agentKinds: [{ id: 'codex', name: 'My Codex', command: 'codex {prompt}', color: '#ffffff' }]
    }))
    const config = reloadConfig()
    expect(config.shell).toBe('/bin/bash')
    expect(config.agentKinds[0]).toEqual({
      id: 'codex', name: 'My Codex', command: 'codex --no-daemon {prompt}', color: '#ffffff'
    })
  })

  it('preserves custom commands and other agent kinds', () => {
    const kinds = [
      { id: 'codex', name: 'Custom', command: 'my-codex --profile work {prompt}', color: '#ffffff' },
      { id: 'custom', name: 'Other', command: 'codex {prompt}', color: '#ffffff' }
    ]
    writeFileSync(configPath(), JSON.stringify({ agentKinds: kinds }))
    expect(reloadConfig().agentKinds.slice(0, 2)).toEqual(kinds)
  })
})
