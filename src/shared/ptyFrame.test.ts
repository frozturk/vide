import { describe, expect, it } from 'vitest'
import { decodePtyFrame, encodePtyFrame } from './ptyFrame'

describe('pty frames', () => {
  it('round-trips agent id and output bytes', () => {
    const frame = encodePtyFrame('0657575f-6f88-488b-9365-f0d52292a855', '\x1b[31mhé ✓\x1b[0m')
    const { agentId, data } = decodePtyFrame(frame)
    expect(agentId).toBe('0657575f-6f88-488b-9365-f0d52292a855')
    expect(new TextDecoder().decode(data)).toBe('\x1b[31mhé ✓\x1b[0m')
  })
})
