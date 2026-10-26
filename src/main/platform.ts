import { basename, join } from 'path'

export function defaultShell(platform = process.platform): string {
  return platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : process.env.SHELL ?? '/bin/zsh'
}

export function shellArgv(shell: string, command: string): string[] {
  const name = basename(shell).toLowerCase().replace(/\.exe$/, '')
  if (name === 'powershell' || name === 'pwsh') {
    return [shell, '-NoLogo', ...(command ? ['-NoExit', '-Command', command] : [])]
  }
  if (name === 'cmd') return [shell, '/d', ...(command ? ['/k', command] : [])]
  return [shell, ...(command ? ['-ilc', command] : ['-il'])]
}
