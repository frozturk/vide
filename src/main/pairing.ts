import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto'
import type { PairedDevice } from '../shared/types'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const CODE_LENGTH = 10
export const CODE_TTL_MS = 5 * 60 * 1000

export interface StoredDevice extends PairedDevice {
  secretHash: string
}

export interface PairingCode {
  code: string
  expiresAt: number
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? ''
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

export class PairingStore {
  private code: PairingCode | null = null

  constructor(
    private devices: StoredDevice[],
    private persist: (devices: StoredDevice[]) => void,
    private now: () => number = Date.now
  ) {}

  currentCode(): PairingCode {
    if (!this.code || this.code.expiresAt <= this.now()) {
      let code = ''
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
      this.code = { code, expiresAt: this.now() + CODE_TTL_MS }
    }
    return this.code
  }

  pair(input: string, userAgent: string | undefined): string | null {
    const active = this.code
    const candidate = Buffer.from(normalizeCode(input))
    if (!active || active.expiresAt <= this.now()) return null
    const expected = Buffer.from(active.code)
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return null
    this.code = null
    const id = randomUUID()
    const secret = randomBytes(32).toString('base64url')
    const now = this.now()
    this.devices = [...this.devices, { id, name: deviceName(userAgent), createdAt: now, lastSeenAt: now, secretHash: hash(secret) }]
    this.persist(this.devices)
    return `${id}.${secret}`
  }

  authenticate(credential: string | undefined): string | null {
    if (!credential) return null
    const dot = credential.indexOf('.')
    if (dot < 0) return null
    const id = credential.slice(0, dot)
    const device = this.devices.find((d) => d.id === id)
    if (!device) return null
    const a = Buffer.from(hash(credential.slice(dot + 1)))
    const b = Buffer.from(device.secretHash)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
    const now = this.now()
    if (now - device.lastSeenAt > 60000) {
      device.lastSeenAt = now
      this.persist(this.devices)
    }
    return device.id
  }

  touch(id: string): void {
    const device = this.devices.find((d) => d.id === id)
    if (!device) return
    device.lastSeenAt = this.now()
    this.persist(this.devices)
  }

  list(): PairedDevice[] {
    return this.devices.map(({ id, name, createdAt, lastSeenAt }) => ({ id, name, createdAt, lastSeenAt }))
  }

  revoke(id?: string): void {
    this.devices = id ? this.devices.filter((d) => d.id !== id) : []
    this.persist(this.devices)
  }
}
