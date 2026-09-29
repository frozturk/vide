import { describe, expect, it } from 'vitest'
import { parseCwds, parseElapsed, parseListeners, parseProcesses } from './ports'

describe('local servers', () => {
  it('groups listening addresses by process', () => {
    const listeners = parseListeners('p423\ncrapportd\nf7\nn*:55000\nf16\nn*:55000\np98391\ncnode\nf46\nn127.0.0.1:5173\nf47\nn[::1]:5173\n')
    expect(listeners.get(423)).toEqual({ command: 'rapportd', addresses: ['*:55000'] })
    expect(listeners.get(98391)).toEqual({ command: 'node', addresses: ['127.0.0.1:5173', '[::1]:5173'] })
  })

  it('reads process working directories, arguments and start times', () => {
    expect(parseCwds('p55601\nfcwd\nn/repo/api\np98391\nfcwd\nn/repo/web\n')).toEqual(new Map([[55601, '/repo/api'], [98391, '/repo/web']]))
    expect(parseProcesses(' 98391       05:30 node vite.js --port 5173\n55601 2-03:00:10 node src/index.ts\n', 1_000_000_000)).toEqual(new Map([
      [98391, { args: 'node vite.js --port 5173', startedAt: 1_000_000_000 - 330_000 }],
      [55601, { args: 'node src/index.ts', startedAt: 1_000_000_000 - (2 * 86400 + 3 * 3600 + 10) * 1000 }]
    ]))
    expect(parseElapsed('01:02:03')).toBe(3723_000)
  })
})
