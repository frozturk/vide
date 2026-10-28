import { describe, expect, it, vi } from 'vitest'
import { fromHeaders, toHeaders } from './relay'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

describe('relay headers', () => {
  it('joins repeated request headers', () => {
    expect(toHeaders([['host', 'vide.example.com'], ['accept', 'a'], ['accept', 'b']])).toEqual({ host: 'vide.example.com', accept: 'a, b' })
  })

  it('keeps every cookie and drops hop-by-hop response headers', () => {
    expect(fromHeaders({ 'set-cookie': ['a=1', 'b=2'], 'content-type': 'text/html', 'content-length': '10', connection: 'close' })).toEqual([
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
      ['content-type', 'text/html']
    ])
  })
})
