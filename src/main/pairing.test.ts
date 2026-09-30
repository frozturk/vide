import { describe, expect, it } from 'vitest'
import { CODE_TTL_MS, PairingStore, deviceName, formatCode, normalizeCode, type StoredDevice } from './pairing'

function setup() {
  let now = 1_000
  const saved: StoredDevice[][] = []
  const store = new PairingStore([], (d) => saved.push(d), () => now)
  return { store, saved, tick: (ms: number) => { now += ms } }
}

describe('device pairing', () => {
  it('pairs once with the current code and authenticates the device', () => {
    const { store, saved } = setup()
    const { code } = store.currentCode()
    const credential = store.pair(formatCode(code).toLowerCase(), 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit Safari/604.1')
    expect(credential).toBeTruthy()
    expect(store.pair(code, undefined)).toBeNull()
    expect(store.authenticate(credential!)).toBe(store.list()[0].id)
    expect(store.list()[0].name).toBe('Safari on iPhone')
    expect(JSON.stringify(saved.at(-1))).not.toContain(credential!.split('.')[1])
  })

  it('rejects expired codes and rotates to a new one', () => {
    const { store, tick } = setup()
    const first = store.currentCode().code
    tick(CODE_TTL_MS + 1)
    expect(store.pair(first, undefined)).toBeNull()
    expect(store.currentCode().code).not.toBe(first)
  })

  it('rejects wrong secrets and revoked devices', () => {
    const { store } = setup()
    const credential = store.pair(store.currentCode().code, undefined)!
    const [id] = credential.split('.')
    expect(store.authenticate(`${id}.wrong`)).toBeNull()
    expect(store.authenticate('garbage')).toBeNull()
    store.revoke(id)
    expect(store.authenticate(credential)).toBeNull()
  })

  it('normalizes typed codes and names browsers', () => {
    expect(normalizeCode(' abcde-fghjk ')).toBe('ABCDEFGHJK')
    expect(deviceName('Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari/537.36')).toBe('Chrome on Android')
    expect(deviceName(undefined)).toBe('Browser on Device')
  })
})
