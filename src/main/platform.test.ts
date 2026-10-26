import { describe, expect, it } from 'vitest'
import { defaultShell, shellArgv } from './platform'

describe('terminal shell launch', () => {
  it('starts an interactive Windows shell and ends it when the agent exits', () => {
    const shell = defaultShell('win32')
    expect(shell).toMatch(/powershell\.exe$/)
    expect(shellArgv(shell, '')).toEqual([shell, '-NoLogo'])
    expect(shellArgv(shell, 'claude')).toEqual([shell, '-NoLogo', '-Command', 'claude'])
  })

  it('supports PowerShell 7, cmd and POSIX shells', () => {
    expect(shellArgv('pwsh.exe', 'echo hi')).toEqual(['pwsh.exe', '-NoLogo', '-Command', 'echo hi'])
    expect(shellArgv('cmd.exe', 'echo hi')).toEqual(['cmd.exe', '/d', '/c', 'echo hi'])
    expect(shellArgv('/bin/zsh', 'echo hi')).toEqual(['/bin/zsh', '-ilc', 'echo hi'])
    expect(shellArgv('/bin/bash', '')).toEqual(['/bin/bash', '-il'])
  })
})
