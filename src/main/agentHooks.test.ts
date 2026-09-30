import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { hookCommand, mergeHooks, parsePaneStatus, parseState, stateAfterInput } from './agentHooks'

const events = [{ event: 'Stop', value: 'idle' as const }, { event: 'Notification', matcher: 'permission_prompt', value: 'waiting' as const }]

describe('agent hooks', () => {
  it('adds vide hooks next to user hooks and keeps other settings', () => {
    const user = { type: 'command', command: 'say done' }
    const merged = mergeHooks({ model: 'opus', hooks: { Stop: [{ hooks: [user] }] } }, events, '/bin/tmux')
    expect(merged.model).toBe('opus')
    expect(merged.hooks!.Stop).toEqual([{ hooks: [user] }, { hooks: [{ type: 'command', command: hookCommand('/bin/tmux', 'idle') }] }])
    expect(merged.hooks!.Notification[0].matcher).toBe('permission_prompt')
  })

  it('replaces its own previous entries instead of duplicating them', () => {
    const once = mergeHooks({}, events, '/old/tmux')
    const twice = mergeHooks(once, events, '/new/tmux')
    expect(twice.hooks!.Stop).toHaveLength(1)
    expect(JSON.stringify(twice)).not.toContain('/old/tmux')
    expect(mergeHooks(twice, events, '/new/tmux')).toEqual(twice)
  })

  it('only acts inside vide sessions and never fails the agent', () => {
    const command = hookCommand('/opt/homebrew/bin/tmux', 'waiting')
    expect(command).toMatch(/^\[ -n "\$VIDE_AGENT" \] && \[ -n "\$TMUX_PANE" \] && /)
    expect(command).toContain("'/opt/homebrew/bin/tmux' set-option -p -t \"$TMUX_PANE\" @vide_state waiting")
    expect(command.endsWith('; true')).toBe(true)
  })

  it('reports the tool name from the hook payload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vide-hook-'))
    const fake = join(dir, 'tmux')
    writeFileSync(fake, `#!/bin/sh\necho "$@" > ${join(dir, 'args')}\n`, { mode: 0o755 })
    execFileSync('/bin/sh', ['-c', hookCommand(fake, 'tool')], {
      input: '{"session_id":"s","tool_name":"Bash","tool_input":{"command":"ls"}}',
      env: { VIDE_AGENT: 'a', TMUX_PANE: '%1', PATH: process.env.PATH ?? '' }
    })
    expect(readFileSync(join(dir, 'args'), 'utf8').trim()).toBe('set-option -p -t %1 @vide_state busy:Bash')
    rmSync(dir, { recursive: true, force: true })
  })

  it('updates the state from what the user types', () => {
    expect(stateAfterInput('waiting', '\r')).toBe('busy')
    expect(stateAfterInput('waiting', '\x1b')).toBe('idle')
    expect(stateAfterInput('busy:Bash', '\x1b')).toBe('idle')
    expect(stateAfterInput('waiting', '\x1b[A')).toBeNull()
    expect(stateAfterInput('idle', '\x1b')).toBeNull()
    expect(stateAfterInput('busy', 'x')).toBeNull()
  })

  it('reads the pane title, state and activity', () => {
    expect(parsePaneStatus('✳ Fix bug\tbusy:Edit')).toEqual({ title: '✳ Fix bug', raw: 'busy:Edit' })
    expect(parseState('busy:Edit')).toEqual({ state: 'busy', activity: 'Edit' })
    expect(parseState('busy')).toEqual({ state: 'busy', activity: 'Thinking' })
    expect(parseState('waiting')).toEqual({ state: 'waiting', activity: null })
    expect(parseState('')).toBeNull()
    expect(parseState('bogus')).toBeNull()
  })
})
