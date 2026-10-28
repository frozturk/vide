import { beforeEach, describe, expect, it, vi } from 'vitest'

const resizes: [number, number][] = []
const attached: { emit: (data: string) => void; killed: boolean }[] = []

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => '/tmp', isPackaged: false } }))
vi.mock('./litemux', () => ({
  ensureServer: vi.fn(async () => {}),
  request: vi.fn(async () => ({})),
  listSessions: vi.fn(async () => []),
  attach: vi.fn(async () => {
    const conn = { emit: (_: string) => {}, killed: false }
    attached.push(conn)
    return {
      write: () => {},
      resize: (cols: number, rows: number) => resizes.push([cols, rows]),
      kill: () => {
        conn.killed = true
      },
      onData: (listener: (data: string) => void) => {
        conn.emit = listener
      },
      onExit: () => {}
    }
  })
}))

const { detachAll, detachClient, resizePty, smallestSize, spawnPty, viewPty } = await import('./pty')
const { registerClient } = await import('./clients')

describe('pty sizing', () => {
  beforeEach(() => {
    detachAll()
    resizes.length = 0
    attached.length = 0
  })

  it('takes the smallest box across sizes', () => {
    expect(smallestSize([{ cols: 120, rows: 30 }, { cols: 45, rows: 40 }])).toEqual({ cols: 45, rows: 30 })
    expect(smallestSize([])).toBeNull()
  })

  it('sizes each terminal to the clients viewing it', async () => {
    await spawnPty('desktop', 'a', '/bin/sh', '', '/tmp')
    await spawnPty('phone', 'a', '/bin/sh', '', '/tmp')
    viewPty('desktop', 'a')
    resizePty('desktop', 'a', 120, 40)
    resizePty('phone', 'a', 45, 30)
    expect(resizes.at(-1)).toEqual([120, 40])
    viewPty('phone', 'a')
    expect(resizes.at(-1)).toEqual([45, 30])
    viewPty('phone', null)
    expect(resizes.at(-1)).toEqual([120, 40])
    viewPty('phone', 'a')
    detachClient('phone')
    expect(resizes.at(-1)).toEqual([120, 40])
  })

  it('leaves the size alone when nobody is viewing', async () => {
    await spawnPty('phone', 'a', '/bin/sh', '', '/tmp')
    resizePty('phone', 'a', 45, 30)
    expect(resizes).toEqual([])
  })

  it('withholds output from web clients until they view the terminal, then redraws', async () => {
    const received: string[] = []
    registerClient('web-1', (ch, payload) => ch === 'pty:data' && received.push((payload as { data: string }).data))
    await spawnPty('web-1', 'a', '/bin/sh', '', '/tmp')
    attached[0].emit('hidden output')
    expect(received).toEqual([])
    viewPty('web-1', 'a')
    await vi.waitFor(() => expect(attached[0]?.killed).toBe(true))
    expect(attached).toHaveLength(2)
    attached[1].emit('\x1bc snapshot')
    expect(received).toEqual(['\x1bc snapshot'])
  })

  it('always streams to the desktop', async () => {
    const received: string[] = []
    registerClient('desktop', (ch, payload) => ch === 'pty:data' && received.push((payload as { data: string }).data))
    await spawnPty('desktop', 'a', '/bin/sh', '', '/tmp')
    attached[0].emit('live')
    expect(received).toEqual(['live'])
  })
})
