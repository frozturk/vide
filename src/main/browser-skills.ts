import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const MARKER = '<!-- vide-managed-browser-skill v1 -->'

// Own only the files we ship; never replace a user-created skill or symlink.
export function installBrowserSkills(appPath: string, home = homedir()): void {
  const skill = readFileSync(join(appPath, 'skills/vide-browser/SKILL.md'), 'utf8') + `\n${MARKER}\n`
  const cli = readFileSync(join(appPath, 'scripts/browser.mjs'), 'utf8')
  for (const root of ['.agents', '.claude']) {
    const target = join(home, root, 'skills', 'vide-browser')
    try {
      if (existsSync(target)) {
        if (lstatSync(target).isSymbolicLink()) continue
        const entry = join(target, 'SKILL.md')
        if (!existsSync(entry) || lstatSync(entry).isSymbolicLink() || !readFileSync(entry, 'utf8').includes(MARKER)) continue
      }
      const scripts = join(target, 'scripts')
      if (existsSync(scripts) && lstatSync(scripts).isSymbolicLink()) continue
      mkdirSync(scripts, { recursive: true })
      for (const [file, content] of [[join(scripts, 'browser.mjs'), cli], [join(target, 'SKILL.md'), skill]]) {
        if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error(`Refusing skill symlink: ${file}`)
        if (existsSync(file) && readFileSync(file, 'utf8') === content) continue
        const temporary = `${file}.vide-tmp`
        writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' })
        renameSync(temporary, file)
      }
    } catch (error) {
      console.error('[vide/browser] Skill installation failed:', target, error)
    }
  }
}
