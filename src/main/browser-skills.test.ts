import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { installBrowserSkills } from './browser-skills'

const homes: string[] = []
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vide-skills-'))
  homes.push(dir)
  return dir
}
afterEach(() => homes.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

it('installs a standalone CLI for both agent skill locations and updates managed files', () => {
  const dir = home()
  installBrowserSkills(resolve('.'), dir)
  for (const root of ['.agents', '.claude']) {
    const skill = join(dir, root, 'skills/vide-browser')
    expect(readFileSync(join(skill, 'SKILL.md'), 'utf8')).toContain('name: vide-browser')
    const cli = join(skill, 'scripts/browser.mjs')
    expect(execFileSync(process.execPath, [cli, 'instructions'], { cwd: dir, encoding: 'utf8' })).toContain('connectOverCDP')
    writeFileSync(cli, 'old version')
  }
  installBrowserSkills(resolve('.'), dir)
  installBrowserSkills(resolve('.'), dir)
  expect(readFileSync(join(dir, '.agents/skills/vide-browser/scripts/browser.mjs'), 'utf8')).toBe(readFileSync('scripts/browser.mjs', 'utf8'))
})

it('preserves user-owned skill directories and linked skills', () => {
  const dir = home()
  const personal = join(dir, '.agents/skills/vide-browser')
  mkdirSync(personal, { recursive: true })
  writeFileSync(join(personal, 'SKILL.md'), 'user instructions')
  mkdirSync(join(dir, '.claude/skills'), { recursive: true })
  symlinkSync(personal, join(dir, '.claude/skills/vide-browser'))
  installBrowserSkills(resolve('.'), dir)
  expect(readFileSync(join(personal, 'SKILL.md'), 'utf8')).toBe('user instructions')
})
