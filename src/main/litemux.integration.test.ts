import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { expect, it } from 'vitest'
import { attach, ensureServer, listSessions, request, type Attached } from './litemux'
import { defaultShell } from './platform'

const binary = resolve('litemux/target/release/litemux.exe')

it.runIf(process.platform === 'win32' && existsSync(binary))('runs a real ConPTY session, resizes, detaches and restores its shell state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vide-conpty-'))
  const info = join(dir, 'server.json')
  let terminal: Attached | undefined
  let output = ''
  const receive = (data: string) => {
    output += data
    // ConPTY asks the attached terminal for its cursor position at startup.
    if (data.includes('\x1b[6n')) terminal?.write('\x1b[1;1R')
  }
  const waitFor = async (text: string) => {
    const until = Date.now() + 15000
    while (!output.includes(text) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    expect(output).toContain(text)
  }
  try {
    await ensureServer(binary, info)
    await request(info, { op: 'spawn', name: 'smoke', cwd: dir, argv: [defaultShell(), '-NoLogo', '-NoProfile'], env: process.env, cols: 80, rows: 24 })
    terminal = await attach(info, 'smoke')
    terminal.onData(receive)
    await waitFor('PS ')
    terminal.write("$videSmoke = 42; Write-Output ('vide-' + 'ready')\r")
    await waitFor('vide-ready')
    terminal.resize(100, 30)
    terminal.write("Write-Output ('width-' + $Host.UI.RawUI.WindowSize.Width)\r")
    await waitFor('width-100')
    terminal.kill()
    expect((await listSessions(info)).map((session) => session.name)).toContain('smoke')
    output = ''
    terminal = await attach(info, 'smoke')
    terminal.onData(receive)
    await waitFor('vide-ready')
    terminal.write("Write-Output ('saved-' + $videSmoke)\r")
    await waitFor('saved-42')
    terminal.write("& $env:LITEMUX_BIN state 'busy:smoke'\r")
    const until = Date.now() + 5000
    while ((await listSessions(info))[0]?.state !== 'busy:smoke' && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    expect((await listSessions(info))[0]?.state).toBe('busy:smoke')
  } finally {
    terminal?.kill()
    await request(info, { op: 'kill', name: 'smoke' }).catch(() => {})
    // The server exits and removes its info file after its last shell exits.
    const until = Date.now() + 5000
    while (existsSync(info) && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    rmSync(dir, { recursive: true, force: true })
  }
}, 60000)
