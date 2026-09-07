import { describe, expect, it } from 'vitest'
import { matchChord } from './chords'

describe('keyboard chords', () => {
  it('maps Command-E to next attention terminal', () => {
    expect(matchChord('e', true, false)).toBe('next-attention')
    expect(matchChord('e', false, false)).toBeNull()
    expect(matchChord('e', true, true)).toBeNull()
  })
})
