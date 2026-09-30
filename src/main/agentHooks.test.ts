import { describe, expect, it } from 'vitest'
import { answersPrompt, hookCommand, mergeHooks, parsePaneStatus } from './agentHooks'

const events = [{ event: 'Stop', state: 'idle' as const }, { event: 'Notification', matcher: 'permission_prompt', state: 'waiting' as const }]

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

  it('reads the pane title and reported state', () => {
    expect(parsePaneStatus('✳ Fix bug\twaiting')).toEqual({ title: '✳ Fix bug', state: 'waiting' })
    expect(parsePaneStatus('zsh\t')).toEqual({ title: 'zsh', state: null })
    expect(parsePaneStatus('zsh\tbogus')).toEqual({ title: 'zsh', state: null })
  })

  it('treats Esc and Enter, but not arrow keys, as answering a prompt', () => {
    expect(answersPrompt('\x1b')).toBe(true)
    expect(answersPrompt('\r')).toBe(true)
    expect(answersPrompt('\x1b[A')).toBe(false)
    expect(answersPrompt('y')).toBe(false)
  })
})
