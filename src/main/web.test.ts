import { describe, expect, it, vi } from 'vitest'
import { authCookie, createLimiter, isAuthorized, isLoopbackHost, parseCookies, sameOrigin, tailscaleUrl, tokenMatches } from './web'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

describe('web access auth', () => {
  it('accepts only the exact token cookie', () => {
    expect(parseCookies('a=1; vide_token=abc%3D; b=2')).toEqual({ a: '1', vide_token: 'abc=', b: '2' })
    expect(isAuthorized('vide_token=secret', 'secret')).toBe(true)
    expect(isAuthorized('vide_token=secreT', 'secret')).toBe(false)
    expect(isAuthorized('vide_token=secret-extra', 'secret')).toBe(false)
    expect(isAuthorized(undefined, 'secret')).toBe(false)
    expect(tokenMatches('', 'secret')).toBe(false)
  })

  it('matches websocket origins against host or forwarded host', () => {
    expect(sameOrigin('http://localhost:7878', ['localhost:7878'])).toBe(true)
    expect(sameOrigin('https://vide.example.com', ['localhost:7878', 'vide.example.com'])).toBe(true)
    expect(sameOrigin('https://evil.example.com', ['localhost:7878', 'vide.example.com'])).toBe(false)
    expect(sameOrigin(undefined, ['localhost:7878'])).toBe(false)
    expect(sameOrigin('not a url', ['localhost:7878'])).toBe(false)
  })

  it('marks the cookie secure only behind https', () => {
    expect(authCookie('t', false)).toBe('vide_token=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000')
    expect(authCookie('t', true)).toContain('; Secure')
  })

  it('locks login after repeated failures and recovers after the window', () => {
    const limiter = createLimiter(3, 1000)
    for (let i = 0; i < 3; i++) limiter.fail(0)
    expect(limiter.blocked(500)).toBe(true)
    expect(limiter.blocked(1001)).toBe(false)
  })

  it('treats only loopback hosts as insecure-capable', () => {
    expect(isLoopbackHost('localhost:7878')).toBe(true)
    expect(isLoopbackHost('127.0.0.1:7878')).toBe(true)
    expect(isLoopbackHost('[::1]:7878')).toBe(true)
    expect(isLoopbackHost('mac.tailnet.ts.net')).toBe(false)
  })

  it('reads the Tailscale address from status output', () => {
    expect(tailscaleUrl(JSON.stringify({ Self: { DNSName: 'mac.tail1234.ts.net.' } }))).toBe('https://mac.tail1234.ts.net')
    expect(tailscaleUrl('{}')).toBeNull()
    expect(tailscaleUrl('not json')).toBeNull()
  })
})
