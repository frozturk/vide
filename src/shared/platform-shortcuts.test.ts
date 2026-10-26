import { expect, it } from 'vitest'
import { matchAppBrowserShortcut, matchAppChord, shortcutKey, shortcutLabel, type KeyInput } from './platform-shortcuts'

const key = (k: string, code: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, code, meta: false, ctrl: false, shift: false, alt: false, ...mods })

it('keeps Windows terminal control keys available and uses Ctrl+Shift for app actions', () => {
  expect(shortcutKey(key('c', 'KeyC', { ctrl: true }), false)).toBeNull()
  expect(shortcutKey(key('d', 'KeyD', { ctrl: true }), false)).toBeNull()
  expect(matchAppChord(key('T', 'KeyT', { ctrl: true, shift: true }), false)).toBe('spawn')
  expect(matchAppChord(key('t', 'KeyT', { meta: true }), true)).toBe('spawn')
})

it('reads digits and comma by key position while Shift is held', () => {
  expect(matchAppChord(key('!', 'Digit1', { ctrl: true, shift: true }), false)).toBe('jump-1')
  expect(matchAppChord(key('<', 'Comma', { ctrl: true, shift: true }), false)).toBe('open-config')
})

it('falls back to the shifted macOS chord when no plain chord uses the key', () => {
  expect(matchAppChord(key('R', 'KeyR', { ctrl: true, shift: true }), false)).toBe('reload-config')
  expect(matchAppChord(key('r', 'KeyR', { meta: true, shift: true }), true)).toBe('reload-config')
  expect(matchAppChord(key('r', 'KeyR', { meta: true }), true)).toBeNull()
  expect(matchAppBrowserShortcut(key('R', 'KeyR', { ctrl: true, shift: true }), false)).toBe('browser-reload')
})

it('labels shortcuts for the platform', () => {
  expect(shortcutLabel('T', false, 'MacIntel')).toBe('⌘T')
  expect(shortcutLabel('R', true, 'MacIntel')).toBe('⌘⇧R')
  expect(shortcutLabel('R', true, 'Win32')).toBe('Ctrl+Shift+R')
  expect(shortcutLabel('1', false, 'Linux x86_64')).toBe('Ctrl+Shift+1')
})
