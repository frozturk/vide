import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { delimiter, join, resolve } from 'path'

function windowsCode(): string {
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft VS Code'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)']!, 'Microsoft VS Code'),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap((entry) => {
      const directory = entry.replace(/^"|"$/g, '')
      return [directory, resolve(directory, '..')]
    })
  ]
  for (const root of roots) {
    if (root && existsSync(join(root, 'Code.exe'))) return join(root, 'Code.exe')
  }
  throw new Error('VS Code was not found. Install VS Code or add its bin folder to PATH, then restart Vide.')
}

export function openInIde(path: string): Promise<void> {
  const folder = resolve(path)
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('/usr/bin/open', ['-b', 'com.microsoft.VSCode', folder], (error) => (error ? reject(error) : resolve()))
    })
  }
  const command = process.platform === 'win32' ? windowsCode() : 'code'
  const args = ['--new-window', folder]
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, detached: true, stdio: 'ignore' })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}
