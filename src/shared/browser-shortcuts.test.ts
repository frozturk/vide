import { describe, expect, it } from 'vitest'
import { matchBrowserShortcut, browserLoadError } from './browser-shortcuts'
import { matchChord } from './chords'

describe('browser shortcuts', () => {
  it('routes close and new-tab shortcuts separately from agent actions', () => {
    expect(matchBrowserShortcut('w', true, false)).toBe('browser-close-tab')
    expect(matchBrowserShortcut('t', true, false)).toBe('browser-new-tab')
    expect(matchChord('w', true, false)).toBe('close')
    expect(matchChord('t', true, false)).toBe('spawn')
  })
  it('supports address and reload without stealing modified app shortcuts', () => {
    expect(matchBrowserShortcut('L', true, false)).toBe('browser-address')
    expect(matchBrowserShortcut('r', true, false)).toBe('browser-reload')
    expect(matchBrowserShortcut('r', true, true)).toBeNull()
    expect(matchBrowserShortcut('w', false, false)).toBeNull()
  })
  it('explains common load failures without Electron IPC details', () => {
    expect(browserLoadError('ERR_CONNECTION_REFUSED')).toContain('server is running')
    expect(browserLoadError('ERR_UNSAFE_PORT')).toContain('different port')
    expect(browserLoadError('ERR_CERT_AUTHORITY_INVALID')).toContain('certificate')
  })
})
