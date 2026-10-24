import { describe, expect, it } from 'vitest'
import { parseViewport, press, refOf, scroll, snapshot, upload, type Cdp, type CdpSend } from './browser-agent'

const tree = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'App' }, childIds: ['2', '3'] },
  { nodeId: '2', role: { value: 'main' }, name: { value: '' }, childIds: ['4', '5', '6', '7'] },
  { nodeId: '3', role: { value: 'generic' }, childIds: ['8'] },
  { nodeId: '4', role: { value: 'heading' }, name: { value: 'Sign in' }, properties: [{ name: 'level', value: { value: 1 } }] },
  { nodeId: '5', role: { value: 'textbox' }, name: { value: 'Email' }, backendDOMNodeId: 50, properties: [{ name: 'value', value: { value: 'me@example.com' } }] },
  { nodeId: '6', role: { value: 'button' }, name: { value: 'Continue' }, backendDOMNodeId: 60, properties: [{ name: 'disabled', value: { value: true } }] },
  { nodeId: '7', role: { value: 'StaticText' }, name: { value: '  Forgot   password? ' } },
  { nodeId: '8', role: { value: 'link' }, name: { value: 'Help' }, backendDOMNodeId: 80, ignored: false }
]

const frameTree = [
  { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Pay' }, childIds: ['2'] },
  { nodeId: '2', role: { value: 'textbox' }, name: { value: 'Card number' }, backendDOMNodeId: 7 }
]

function fake(): { send: CdpSend; cdp: Cdp; calls: [string, any][] } {
  const calls: [string, any][] = []
  const send: CdpSend = async (method, params, session) => {
    calls.push([method, params])
    if (method === 'Accessibility.getFullAXTree') return { nodes: session ? frameTree : tree }
    if (method === 'Runtime.evaluate') return { result: {} }
    return {}
  }
  return { send, calls, cdp: { send, frames: async () => new Map([['frame-1', { session: 's1', url: 'https://pay.test/' }]]) } }
}

describe('browser agent commands', () => {
  it('outlines the page with refs for interactive elements only', async () => {
    const { text, refs } = await snapshot(fake().cdp)
    expect(text).toBe([
      'main',
      '  heading 1 "Sign in"',
      '  [@e1] textbox "Email" value="me@example.com"',
      '  [@e2] button "Continue" disabled',
      '  text "Forgot password?"',
      '[@e3] link "Help"',
      'iframe "https://pay.test/"',
      '  [@e4] textbox "Card number"'
    ].join('\n'))
    expect(refOf(refs, '@e2')).toEqual({ node: 60, frame: undefined })
    expect(refOf(refs, 'e3')).toEqual({ node: 80, frame: undefined })
    expect(refOf(refs, '@e4')).toEqual({ node: 7, frame: 'frame-1' })
    expect(() => refOf(refs, '@e9')).toThrow('run snapshot')
  })

  it('sends named keys, characters and modifier chords', async () => {
    const { send, calls } = fake()
    await press(send, 'Enter')
    await press(send, 'Shift+Tab')
    await press(send, 'Meta+a')
    expect(calls[0][1]).toMatchObject({ type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    expect(calls[2][1]).toMatchObject({ type: 'rawKeyDown', key: 'Tab', modifiers: 8 })
    expect(calls[4][1]).toMatchObject({ type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 4 })
    expect(calls[4][1].text).toBeUndefined()
    await expect(press(send, 'Hyper+x')).rejects.toThrow('modifier')
    await expect(press(send, 'F13')).rejects.toThrow('Unknown key')
  })

  it('rejects unknown scroll directions and missing upload files', async () => {
    const { cdp } = fake()
    await expect(scroll(cdp, 'sideways', 600)).rejects.toThrow('scroll up|down')
    await expect(upload(cdp, { node: 1 }, ['/no/such/file.png'])).rejects.toThrow('File not found')
    await expect(upload(cdp, { node: 1 }, ['relative.png'])).rejects.toThrow('File not found')
  })

  it('parses phone viewports and turns them off', () => {
    expect(parseViewport('390x844')).toEqual({ width: 390, height: 844 })
    expect(parseViewport('off')).toBeNull()
    expect(() => parseViewport('big')).toThrow('WIDTHxHEIGHT')
  })
})
