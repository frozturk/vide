import { beforeEach, describe, expect, it, vi } from 'vitest'

const resizes: [number, number][] = []

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getAppPath: () => '/tmp', isPackaged: false } }))
vi.mock('./litemux', () => ({
  ensureServer: vi.fn(async () => {}),
  request: vi.fn(async () => ({})),
  listSessions: vi.fn(async () => []),
  attach: vi.fn(async () => ({
    write: () => {},
    resize: (cols: number, rows: number) => resizes.push([cols, rows]),
    kill: () => {},
    onData: () => {},
    onExit: () => {}
  }))
}))

const { detachAll, detachClient, resizePty, smallestSize, spawnPty, viewPty } = await import('./pty')

describe('pty sizing', () => {
  beforeEach(() => {
    detachAll()
    resizes.length = 0
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
})
