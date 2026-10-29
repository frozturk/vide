import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { hookEntry, mergeHooks, parseState, replyText, stateAfterInput } from './agentHooks'

const events = [{ event: 'Stop', value: 'idle' as const }, { event: 'Notification', matcher: 'permission_prompt', value: 'waiting' as const }]

describe('agent hooks', () => {
  it('adds vide hooks next to user hooks and keeps other settings', () => {
    const user = { type: 'command', command: 'say done' }
    const merged = mergeHooks({ model: 'opus', hooks: { Stop: [{ hooks: [user] }] } }, events, '/bin/litemux', 'claude')
    expect(merged.model).toBe('opus')
    expect(merged.hooks!.Stop).toEqual([{ hooks: [user] }, { hooks: [hookEntry('/bin/litemux', 'idle', 'claude')] }])
    expect(merged.hooks!.Notification[0].matcher).toBe('permission_prompt')
  })

  it('replaces its own previous entries instead of duplicating them', () => {
    const once = mergeHooks({}, events, '/old/litemux', 'codex')
    const twice = mergeHooks(once, events, '/new/litemux', 'codex')
    expect(twice.hooks!.Stop).toHaveLength(1)
    expect(JSON.stringify(twice)).not.toContain('/old/litemux')
    expect(mergeHooks(twice, events, '/new/litemux', 'codex')).toEqual(twice)
    expect(mergeHooks(mergeHooks({}, events, '/old/litemux', 'claude'), events, '/new/litemux', 'claude').hooks!.Stop).toHaveLength(1)
  })

  it('runs litemux without a shell for Claude and through PowerShell on Windows for Codex', () => {
    expect(hookEntry('C:\\Program Files\\Vide\\litemux.exe', 'tool', 'claude')).toEqual({ type: 'command', command: 'C:\\Program Files\\Vide\\litemux.exe', args: ['hook', 'tool'] })
    expect(hookEntry("/Apps/Fr's Vide/litemux", 'reply', 'codex')).toEqual({
      type: 'command',
      command: "'/Apps/Fr'\\''s Vide/litemux' hook reply",
      commandWindows: "& '/Apps/Fr''s Vide/litemux' hook reply"
    })
  })

  it.skipIf(process.platform === 'win32')('passes the event payload to litemux on stdin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vide hook-'))
    const fake = join(dir, 'litemux')
    writeFileSync(fake, `#!/bin/sh\n{ echo "$@"; cat; } > '${join(dir, 'args')}'\n`, { mode: 0o755 })
    execFileSync('/bin/sh', ['-c', hookEntry(fake, 'tool', 'codex').command], { input: '{"tool_name":"Edit"}' })
    expect(readFileSync(join(dir, 'args'), 'utf8')).toBe('hook tool\n{"tool_name":"Edit"}')
    rmSync(dir, { recursive: true, force: true })
  })

  it('flattens the last reply into one line of plain text', () => {
    expect(replyText('## Summary\n\n- Fixed **login** in `auth_flow.ts`\n```ts\ncode()\n```\nDone.')).toBe('Summary Fixed login in auth_flow.ts Done.')
    expect(replyText('  ')).toBeNull()
  })

  it('updates the state from what the user types', () => {
    expect(stateAfterInput('waiting', '\r')).toBe('busy')
    expect(stateAfterInput('waiting', '\x1b')).toBe('idle')
    expect(stateAfterInput('busy:Bash', '\x1b')).toBe('idle')
    expect(stateAfterInput('waiting', '\x1b[A')).toBeNull()
    expect(stateAfterInput('idle', '\x1b')).toBeNull()
    expect(stateAfterInput('busy', 'x')).toBeNull()
  })

  it('reads the state and activity', () => {
    expect(parseState('busy:Edit')).toEqual({ state: 'busy', activity: 'Edit' })
    expect(parseState('busy')).toEqual({ state: 'busy', activity: 'Thinking' })
    expect(parseState('waiting')).toEqual({ state: 'waiting', activity: null })
    expect(parseState('')).toBeNull()
    expect(parseState('bogus')).toBeNull()
  })
})
