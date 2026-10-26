import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { hookCommand, mergeHooks, readReply } from './agentHooks'

describe.runIf(process.platform === 'win32')('Windows agent hooks', () => {
  it('reports tool status, saves UTF-8 replies and ignores sessions outside Vide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vide-windows-hook-'))
    try {
      const fake = join(dir, 'litemux.ps1')
      const argsFile = join(dir, 'args.txt')
      writeFileSync(fake, `[IO.File]::WriteAllText('${argsFile.replace(/'/g, "''")}', ($args -join ' '))`)
      const env = { ...process.env, VIDE_AGENT: 'test-agent', LITEMUX_SESSION: 'vide-test', LITEMUX_BIN: fake }
      const run = (value: 'tool' | 'reply' | 'waiting', input: string, vars = env) => {
        const command = hookCommand('', value, dir, 'win32')
        execFileSync('powershell.exe', command.split(' ').slice(1), { input, env: vars, windowsHide: true })
      }
      run('tool', '{"tool_name":"Edit"}')
      expect(readFileSync(argsFile, 'utf8')).toBe('state busy:Edit')
      run('reply', '{"last_assistant_message":"Finished"}')
      expect(readFileSync(argsFile, 'utf8')).toBe('state idle')
      expect(readReply(dir, 'test-agent')?.text).toBe('Finished')
      run('waiting', '', { ...env, VIDE_AGENT: '' })
      expect(readFileSync(argsFile, 'utf8')).toBe('state idle')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('updates its encoded hooks without accumulating duplicates', () => {
    const events = [{ event: 'Stop', value: 'reply' as const }]
    const once = mergeHooks({}, events, 'tmux', 'C:\\replies')
    expect(mergeHooks(once, events, 'tmux', 'C:\\replies')).toEqual(once)
    expect(once.hooks!.Stop).toHaveLength(1)
  })
})
