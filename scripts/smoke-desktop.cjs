// Run against a locally launched Vide with --remote-debugging-port=9337.
// Uses the real preload API and a shell terminal, without invoking an AI service.
const { writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const pages = await (await fetch('http://127.0.0.1:9337/json/list')).json()
  const page = pages.find((p) => p.type === 'page' && p.url.includes('index.html'))
  assert(page, 'Vide renderer is available')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const reply = JSON.parse(data)
    const callback = pending.get(reply.id)
    if (!callback) return
    pending.delete(reply.id)
    reply.error ? callback.reject(new Error(JSON.stringify(reply.error))) : callback.resolve(reply.result)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject })
    ws.send(JSON.stringify({ id: key, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result.value
  }
  try {
    const config = await evaluate('window.vide.configGet()')
    assert.equal(config.terminalBackend, 'litemux')
    assert.match(config.shell, /powershell\.exe$/)
    assert(await evaluate('document.body.innerText.length > 0'))
    const root = resolve(__dirname, '..')
    const workspace = await evaluate(`(async () => {
      const result = await window.vide.projectAdd({path: ${JSON.stringify(root)}});
      return result.workspace;
    })()`)
    const before = await evaluate('window.vide.stateLoad().then(state => state.agents.map(a => a.id))')
    // Load the project into the renderer, then launch through the actual UI.
    await send('Page.reload')
    const readyUntil = Date.now() + 15000
    while (Date.now() < readyUntil) {
      if (await evaluate('Boolean(window.vide && document.body.innerText.includes("Main"))').catch(() => false)) break
      await new Promise((res) => setTimeout(res, 100))
    }
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'T', code: 'KeyT', modifiers: 10, windowsVirtualKeyCode: 84 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'T', code: 'KeyT', modifiers: 0, windowsVirtualKeyCode: 84 })
    await new Promise((res) => setTimeout(res, 200))
    assert(await evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'Ctrl+Shift+T opens the new-agent dialog')
    await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Shell").click()')
    await new Promise((res) => setTimeout(res, 100))
    await evaluate(`window.__videSmokeOutput = {}; window.__videSmokeUnsubscribe = window.vide.onPtyData(({agentId, data}) => {
      window.__videSmokeOutput[agentId] = (window.__videSmokeOutput[agentId] || '') + data;
    }); true`)
    await evaluate('[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Start Agent").click()')
    let agent
    const until = Date.now() + 15000
    while (!agent && Date.now() < until) {
      agent = await evaluate(`window.vide.stateLoad().then(state => state.agents.find(a => !${JSON.stringify(before)}.includes(a.id) && a.kindId === 'shell'))`)
      await new Promise((res) => setTimeout(res, 100))
    }
    assert(agent, 'UI created a new shell terminal')
    await new Promise((res) => setTimeout(res, 1000))
    await evaluate(`window.vide.ptyInput(${JSON.stringify(agent.id)}, "Write-Output ('Vide litemux ' + 'desktop OK')\\r")`)
    const outputUntil = Date.now() + 15000
    const outputExpression = `Boolean(window.__videSmokeOutput[${JSON.stringify(agent.id)}]?.includes("Vide litemux desktop OK"))`
    while (!(await evaluate(outputExpression)) && Date.now() < outputUntil) {
      await new Promise((res) => setTimeout(res, 100))
    }
    assert(await evaluate(outputExpression), 'Shell output reaches the desktop renderer')
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(root, '.vide/desktop-smoke.png'), Buffer.from(shot.data, 'base64'))
    await evaluate('window.__videSmokeUnsubscribe(); delete window.__videSmokeOutput; delete window.__videSmokeUnsubscribe; true')
    console.log(JSON.stringify({ backend: config.terminalBackend, shell: config.shell, workspace: workspace.name, shellOutput: 'Vide litemux desktop OK', agentId: agent.id }))
  } finally {
    ws.close()
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
