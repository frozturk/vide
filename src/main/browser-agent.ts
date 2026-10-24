import { existsSync } from 'fs'
import { isAbsolute } from 'path'

export type CdpSend = (method: string, params?: Record<string, unknown>, session?: string) => Promise<any>
export type Frames = Map<string, { session: string; url: string }>
export type Cdp = { send: CdpSend; frames: () => Promise<Frames> }
export type Ref = { node: number; frame?: string }

type AXNode = {
  nodeId: string
  backendDOMNodeId?: number
  ignored?: boolean
  role?: { value: string }
  name?: { value: string }
  properties?: { name: string; value: { value: unknown } }[]
  childIds?: string[]
}

type Entry = { depth: number; role: string; name: string; node?: number; frame?: string; detail?: string }

const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'treeitem'])
const LANDMARKS = new Set(['banner', 'navigation', 'main', 'complementary', 'contentinfo', 'form', 'search', 'dialog'])
const MAX_LINES = 600

const KEYS: Record<string, [code: string, keyCode: number, text?: string]> = {
  Enter: ['Enter', 13, '\r'], Tab: ['Tab', 9], Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
  ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39],
  Home: ['Home', 36], End: ['End', 35], PageUp: ['PageUp', 33], PageDown: ['PageDown', 34], Space: ['Space', 32, ' ']
}
const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 }

function property(node: AXNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value.value
}

function walk(node: AXNode, byId: Map<string, AXNode>, depth: number, out: Entry[]): void {
  const role = node.role?.value ?? ''
  const name = (node.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const children = (d: number): void => { for (const id of node.childIds ?? []) { const child = byId.get(id); if (child) walk(child, byId, d, out) } }
  if (node.ignored || !role || role === 'none' || role === 'generic' || role === 'presentation') return children(depth)
  if (INTERACTIVE.has(role) && node.backendDOMNodeId) {
    const value = property(node, 'value')
    const checked = property(node, 'checked')
    const detail = [typeof value === 'string' && value && role !== 'button' ? `value="${value.slice(0, 60)}"` : '', checked === 'true' || checked === true ? 'checked' : '', property(node, 'expanded') === true ? 'expanded' : '', property(node, 'disabled') === true ? 'disabled' : ''].filter(Boolean).join(' ')
    out.push({ depth, role, name: name || '(unlabeled)', node: node.backendDOMNodeId, detail })
    return
  }
  if (role === 'heading' && name) { out.push({ depth, role: `heading${property(node, 'level') ? ` ${property(node, 'level')}` : ''}`, name }); return }
  if (LANDMARKS.has(role)) { out.push({ depth, role, name }); return children(depth + 1) }
  if ((role === 'StaticText' || role === 'staticText') && name) { out.push({ depth, role: 'text', name }); return }
  children(depth)
}

async function clickables(send: CdpSend, known: Set<number>): Promise<Entry[]> {
  const { result } = await send('Runtime.evaluate', {
    expression: `(() => {
      const skip = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION'])
      const found = []
      for (const el of document.querySelectorAll('[onclick], [tabindex]:not([tabindex="-1"]), div, span, li, td, img, svg, label')) {
        if (found.length >= 50) break
        if (skip.has(el.tagName) || el.closest('a, button')) continue
        const style = getComputedStyle(el)
        if (style.cursor !== 'pointer' && !el.hasAttribute('onclick') && !el.hasAttribute('tabindex')) continue
        if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer' && !el.hasAttribute('onclick')) continue
        const rect = el.getBoundingClientRect()
        if (!rect.width || !rect.height || !(el.getAttribute('aria-label') || el.textContent || '').trim()) continue
        found.push(el)
      }
      return found
    })()`
  })
  if (!result?.objectId) return []
  const { result: items } = await send('Runtime.getProperties', { objectId: result.objectId, ownProperties: true })
  const out: Entry[] = []
  for (const item of items as { name: string; value?: { objectId?: string } }[]) {
    if (!/^\d+$/.test(item.name) || !item.value?.objectId) continue
    const { node } = await send('DOM.describeNode', { objectId: item.value.objectId })
    if (known.has(node.backendNodeId)) continue
    const label = await send('Runtime.callFunctionOn', { objectId: item.value.objectId, functionDeclaration: 'function () { return (this.getAttribute("aria-label") || this.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) }', returnByValue: true })
    out.push({ depth: 0, role: 'clickable', name: label.result.value, node: node.backendNodeId })
  }
  await send('Runtime.releaseObject', { objectId: result.objectId })
  return out
}

async function tree(send: CdpSend, session: string | undefined, depth: number): Promise<Entry[]> {
  await send('Accessibility.enable', {}, session)
  const { nodes } = await send('Accessibility.getFullAXTree', {}, session) as { nodes: AXNode[] }
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const entries: Entry[] = []
  if (nodes[0]) walk(nodes[0], byId, depth, entries)
  return entries
}

export async function snapshot(cdp: Cdp): Promise<{ text: string; refs: Map<string, Ref> }> {
  const entries = await tree(cdp.send, undefined, 0)
  entries.push(...await clickables(cdp.send, new Set(entries.flatMap((e) => e.node ? [e.node] : []))).catch(() => []))
  for (const [frame, { session, url }] of await cdp.frames()) {
    const inner = await tree(cdp.send, session, 1).catch(() => [])
    if (inner.length) entries.push({ depth: 0, role: 'iframe', name: url }, ...inner.map((e) => ({ ...e, frame })))
  }
  const refs = new Map<string, Ref>()
  const lines = entries.slice(0, MAX_LINES).map((e) => {
    const indent = '  '.repeat(e.depth)
    if (!e.node) return `${indent}${e.role}${e.name ? ` "${e.name}"` : ''}`
    const ref = `@e${refs.size + 1}`
    refs.set(ref, { node: e.node, frame: e.frame })
    return `${indent}[${ref}] ${e.role} "${e.name}"${e.detail ? ` ${e.detail}` : ''}`
  })
  if (entries.length > MAX_LINES) lines.push(`… ${entries.length - MAX_LINES} more lines omitted`)
  return { text: lines.join('\n'), refs }
}

export function refOf(refs: Map<string, Ref> | undefined, ref: string): Ref {
  const found = refs?.get(ref.startsWith('@') ? ref : `@${ref}`)
  if (!found) throw new Error(`Unknown ref ${ref}; run snapshot first`)
  return found
}

export function isRef(value: string): boolean {
  return /^@?e\d+$/.test(value)
}

async function stale<T>(run: Promise<T>): Promise<T> {
  try { return await run } catch (error) {
    if (/No node|Could not compute box model|Node is detached|Frame .* not found|No frame/i.test(String(error))) throw new Error('Element is gone or hidden; run snapshot again for fresh refs')
    throw error
  }
}

async function session(cdp: Cdp, ref: Ref): Promise<string | undefined> {
  if (!ref.frame) return undefined
  const frame = (await cdp.frames()).get(ref.frame)
  if (!frame) throw new Error('The iframe for this ref is gone; run snapshot again for fresh refs')
  return frame.session
}

async function center(cdp: Cdp, ref: Ref): Promise<{ x: number; y: number; session?: string }> {
  const target = await session(cdp, ref)
  let dx = 0
  let dy = 0
  if (ref.frame) {
    const { backendNodeId } = await stale(cdp.send('DOM.getFrameOwner', { frameId: ref.frame }))
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId })
    await stale(cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.node }, target))
    const { model } = await stale(cdp.send('DOM.getBoxModel', { backendNodeId }))
    dx = model.content[0]
    dy = model.content[1]
  } else await stale(cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: ref.node }))
  const { model } = await stale(cdp.send('DOM.getBoxModel', { backendNodeId: ref.node }, target))
  const [x1, y1, , , x3, y3] = model.content as number[]
  return { x: dx + (x1 + x3) / 2, y: dy + (y1 + y3) / 2, session: target }
}

export async function click(cdp: Cdp, ref: Ref): Promise<{ x: number; y: number }> {
  const { x, y } = await center(cdp, ref)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  return { x: Math.round(x), y: Math.round(y) }
}

export async function hover(cdp: Cdp, ref: Ref): Promise<{ x: number; y: number }> {
  const { x, y } = await center(cdp, ref)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  return { x: Math.round(x), y: Math.round(y) }
}

export async function scroll(cdp: Cdp, direction: string, amount: number): Promise<{ scrollX: number; scrollY: number }> {
  const delta = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] }[direction]
  if (!delta || !(amount > 0)) throw new Error('Use scroll up|down|left|right [PIXELS] or scroll REF')
  const { cssLayoutViewport: view } = await cdp.send('Page.getLayoutMetrics')
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: view.clientWidth / 2, y: view.clientHeight / 2, deltaX: delta[0], deltaY: delta[1] })
  await new Promise((resolve) => setTimeout(resolve, 150))
  const { result } = await cdp.send('Runtime.evaluate', { expression: '[scrollX, scrollY]', returnByValue: true })
  return { scrollX: Math.round(result.value[0]), scrollY: Math.round(result.value[1]) }
}

export async function scrollTo(cdp: Cdp, ref: Ref): Promise<{ x: number; y: number }> {
  const { x, y } = await center(cdp, ref)
  return { x: Math.round(x), y: Math.round(y) }
}

export async function fill(cdp: Cdp, ref: Ref, value: string): Promise<void> {
  const target = await session(cdp, ref)
  const { object } = await stale(cdp.send('DOM.resolveNode', { backendNodeId: ref.node }, target))
  const { result } = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    returnByValue: true,
    arguments: [{ value }],
    functionDeclaration: `function (value) {
      this.scrollIntoView({ block: 'center' })
      if (this.tagName === 'SELECT') {
        const option = [...this.options].find((o) => o.value === value || o.label.trim() === value)
        if (!option) return 'No option "' + value + '"'
        this.value = option.value
        this.dispatchEvent(new Event('input', { bubbles: true }))
        this.dispatchEvent(new Event('change', { bubbles: true }))
        return 'selected'
      }
      this.focus()
      if (typeof this.select === 'function') this.select()
      else { const range = document.createRange(); range.selectNodeContents(this); getSelection().removeAllRanges(); getSelection().addRange(range) }
      return 'focused'
    }`
  }, target)
  await cdp.send('Runtime.releaseObject', { objectId: object.objectId }, target)
  if (result.value === 'selected') return
  if (result.value !== 'focused') throw new Error(result.value)
  if (value) await cdp.send('Input.insertText', { text: value }, target)
  else await press(cdp.send, 'Backspace', target)
}

export async function upload(cdp: Cdp, ref: Ref, files: string[]): Promise<{ uploaded: number }> {
  if (!files.length) throw new Error('upload requires at least one file')
  for (const file of files) if (!isAbsolute(file) || !existsSync(file)) throw new Error(`File not found: ${file}`)
  await stale(cdp.send('DOM.setFileInputFiles', { files, backendNodeId: ref.node }, await session(cdp, ref)))
  return { uploaded: files.length }
}

export async function press(send: CdpSend, combo: string, session?: string): Promise<void> {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  const modifiers = parts.reduce((sum, part) => {
    const bit = MODIFIERS[part]
    if (!bit) throw new Error(`Unknown modifier ${part}`)
    return sum | bit
  }, 0)
  const named = KEYS[key]
  if (!named && key.length !== 1) throw new Error(`Unknown key ${key}`)
  const [code, keyCode, text] = named ?? [/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : '', key.toUpperCase().charCodeAt(0), key]
  const name = named ? (key === 'Space' ? ' ' : key) : key
  const typed = modifiers & ~8 ? undefined : text
  await send('Input.dispatchKeyEvent', { type: typed ? 'keyDown' : 'rawKeyDown', key: name, code, windowsVirtualKeyCode: keyCode, modifiers, ...(typed ? { text: typed, unmodifiedText: typed } : {}) }, session)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: keyCode, modifiers }, session)
}

export function parseViewport(value: string | undefined): { width: number; height: number } | null {
  if (!value || value === 'off') return null
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(value.trim())
  if (!match) throw new Error('Use viewport WIDTHxHEIGHT (for example 390x844) or viewport off')
  return { width: Number(match[1]), height: Number(match[2]) }
}
