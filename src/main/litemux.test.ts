import { describe, expect, it } from 'vitest'
import { decodeFrames, encodeFrame } from './litemux'

describe('litemux frames', () => {
  it('encodes kind, big-endian length and payload', () => {
    expect([...encodeFrame('I', Buffer.from('ls\r'))]).toEqual([73, 0, 0, 0, 3, 108, 115, 13])
  })

  it('decodes whole frames and keeps a partial tail for the next chunk', () => {
    const data = Buffer.concat([Buffer.from([68, 0, 0, 0, 2]), Buffer.from('hi'), Buffer.from([88, 0, 0, 0, 1]), Buffer.from('3'), Buffer.from([68, 0, 0])])
    const { frames, rest } = decodeFrames(data)
    expect(frames.map((f) => [f.kind, f.payload.toString()])).toEqual([['D', 'hi'], ['X', '3']])
    expect([...rest]).toEqual([68, 0, 0])
  })
})
