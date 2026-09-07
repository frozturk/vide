import { describe, expect, it } from 'vitest'
import { matchChord } from './chords'

describe('keyboard chords', () => {
  it('maps Command-E to next non-idle terminal', () => {
    expect(matchChord('e', true, false)).toBe('next-non-idle')
    expect(matchChord('e', false, false)).toBeNull()
    expect(matchChord('e', true, true)).toBeNull()
  })
})
