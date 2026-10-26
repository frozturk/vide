import { matchBrowserShortcut, type BrowserShortcut } from './browser-shortcuts'
import { matchChord, type ChordId } from './chords'

export type KeyInput = { key: string; code: string; meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }

export function isMacPlatform(platform: string): boolean {
  return /mac|darwin/i.test(platform)
}

export function shortcutLabel(key: string, shift = false, platform = globalThis.navigator?.platform ?? ''): string {
  return isMacPlatform(platform) ? `⌘${shift ? '⇧' : ''}${key}` : `Ctrl+Shift+${key}`
}

export function keyInput(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): KeyInput {
  return { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey }
}

export function shortcutKey(input: KeyInput, isMac: boolean): { key: string; shift: boolean } | null {
  if (isMac) return input.meta && !input.ctrl && !input.alt ? { key: input.key, shift: input.shift } : null
  if (!input.ctrl || !input.shift || input.meta || input.alt) return null
  if (/^Digit\d$/.test(input.code)) return { key: input.code.slice(5), shift: false }
  return { key: input.code === 'Comma' ? ',' : input.key, shift: false }
}

export function matchAppChord(input: KeyInput, isMac: boolean): ChordId | null {
  const shortcut = shortcutKey(input, isMac)
  if (!shortcut) return null
  return matchChord(shortcut.key, true, shortcut.shift) ?? (isMac ? null : matchChord(shortcut.key, true, true))
}

export function matchAppBrowserShortcut(input: KeyInput, isMac: boolean): BrowserShortcut | null {
  const shortcut = shortcutKey(input, isMac)
  return shortcut ? matchBrowserShortcut(shortcut.key, true, shortcut.shift) : null
}
