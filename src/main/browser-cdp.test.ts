import { describe, it, expect } from 'vitest'
import { PaneCdp } from './browser-cdp'
import { browserPartition, browserUrl } from './browser-policy'

 describe('embedded browser boundaries', () => {
  it('keeps projects and development profiles separate while reusing project storage', () => {
    expect(browserPartition('project-a')).toBe(browserPartition('project-a'))
    expect(browserPartition('project-a')).not.toBe(browserPartition('project-b'))
    expect(browserPartition('project-a')).not.toBe(browserPartition('project-a', true))
    expect(browserPartition('../../secret')).not.toContain('../')
  })
  it('normalizes localhost and rejects privileged schemes at navigation entry points', () => {
    expect(browserUrl('localhost:3000/foo')).toBe('http://localhost:3000/foo')
    expect(browserUrl('https://example.com')).toBe('https://example.com/')
    expect(browserUrl('about:blank')).toBe('about:blank')
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,test', 'chrome://settings', 'devtools://devtools']) expect(() => browserUrl(url)).toThrow()
  })
  it('exposes only the root and registered popup descendants', () => {
    const events: any[] = []
    const shim = new PaneCdp('root', (event) => events.push(event))
    const root = shim.add('root', 'frame-root', () => ({ url: 'https://app.test', title: 'App' }))
    const command = (method: string, params = {}, sessionId?: string) => shim.command(method, params, sessionId, () => {}, () => {})
    command('Target.setAutoAttach', { autoAttach: true })
    command('Target.setAutoAttach', { autoAttach: true }, root.sessionId)
    const child = shim.add('child', 'frame-child', () => ({ url: 'https://login.test', title: 'Sign in' }), 'root')
    expect(shim.target(child)).toMatchObject({ openerId: 'frame-root', browserContextId: 'context-root' })
    expect(events.filter((e) => e.method === 'Target.attachedToTarget')).toHaveLength(2)
    expect((command('Target.getTargets')!.result as any).targetInfos).toHaveLength(2)
    expect(() => shim.add('foreign', 'frame-foreign', root.info, 'other-workspace')).toThrow('outside')
    expect(() => command('Target.attachToTarget', { targetId: 'host-shell' })).toThrow('outside')
    expect(() => shim.pageForSession('unregistered')).toThrow('outside')
    expect(() => command('Browser.close')).toThrow('Unsupported')
    expect(() => command('Target.createTarget')).toThrow('Vide browser API')
  })
  it('routes each page session and emits popup closure without losing its opener', () => {
    const events: any[] = []
    const shim = new PaneCdp('root', (event) => events.push(event))
    const info = () => ({ url: 'about:blank', title: '' })
    const root = shim.add('root', 'root-frame', info)
    shim.command('Target.setAutoAttach', { autoAttach: true }, undefined, () => {}, () => {})
    const child = shim.add('child', 'child-frame', info, 'root')
    const grandchild = shim.add('grandchild', 'nested-frame', info, 'child')
    expect(shim.pageForSession(child.sessionId).tabId).toBe('child')
    expect(shim.target(grandchild).openerId).toBe('child-frame')
    shim.event(child, 'Page.lifecycleEvent', { name: 'load' })
    expect(events.at(-1)).toMatchObject({ sessionId: child.sessionId, method: 'Page.lifecycleEvent' })
    shim.command('Target.closeTarget', { targetId: child.targetId }, undefined, (id) => shim.remove(id), () => {})
    expect(events.at(-1)).toMatchObject({ method: 'Target.targetDestroyed', params: { targetId: 'child-frame' } })
    expect(() => shim.pageForSession(child.sessionId)).toThrow()
    expect(shim.pageForSession(root.sessionId)).toBe(root)
  })
})
