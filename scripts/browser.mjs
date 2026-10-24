#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
function option(name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value) throw new Error(`${name} requires a value`)
  args.splice(index, 2)
  return value
}
try {
  const infoPath = option('--info') ?? process.env.VIDE_BROWSER_INFO
  const workspace = option('--workspace')
  const tabId = option('--tab')
  const out = option('--out')
  const dev = args.includes('--dev')
  if (dev) args.splice(args.indexOf('--dev'), 1)
  const action = args.shift() ?? 'help'
  if (['help', '--help', 'instructions', '--instructions'].includes(action)) {
    console.log(`Vide browser control (desktop app must be running)
node scripts/browser.mjs [--info PATH | --dev] [--workspace ID_OR_PATH] ACTION [VALUE] [--tab ID]

Actions: workspaces, list, open URL, navigate URL, back, forward, reload, recover,
         close, select, snapshot, click REF, hover REF, fill REF TEXT, type TEXT,
         press KEY, scroll up|down|left|right [PIXELS], scroll REF,
         upload REF FILE..., wait TEXT, viewport WIDTHxHEIGHT|off,
         eval JAVASCRIPT, screenshot --out FILE, console, network [URL_PART], cdp
Workspace defaults to the closest workspace containing the current directory.
Tab defaults to the last listed tab. cdp prints endpoint and authentication headers.
VIDE_BROWSER_INFO is provided to new Vide terminals; --info overrides it.
Help and instructions work even when Vide is not running.

AGENT WORKFLOW
Use Vide's in-app browser to preview and test web pages. Reuse its embedded page
instead of launching a separate browser. Run this script by absolute path when
working in another project, keeping your current directory in that workspace.

1. Run list to discover the current workspace's tabs.
   If the workspace cannot be resolved, run workspaces and pass --workspace ID.
2. Reuse a suitable tab, or run open http://localhost:PORT to create one.
3. Pass --tab TAB_ID explicitly on subsequent commands. The default is the last
   listed tab, which may differ from the tab the user currently has selected.
4. Interact with a snapshot -> act -> snapshot loop:
     snapshot --tab TAB_ID              page outline with refs like [@e3]
     click @e3 --tab TAB_ID             real mouse click at the element
     fill @e1 me@example.com --tab TAB_ID
                                        replace a field's text or pick a select option
     type some text --tab TAB_ID        insert text into the focused element
     press Enter --tab TAB_ID           Enter, Tab, Escape, Backspace, ArrowDown,
                                        Shift+Tab, Meta+Enter, single characters
     wait Welcome --tab TAB_ID          wait up to 15s for text on the page
     hover @e4 --tab TAB_ID             move the mouse over an element
     scroll down 800 --tab TAB_ID       wheel-scroll the page (default 600px)
     scroll @e9 --tab TAB_ID            scroll an element into view
     upload @e5 ./a.png --tab TAB_ID    set files on a file input
   Refs come from the latest snapshot of that tab. Navigation clears them; take
   a new snapshot after navigation and after clicks that change the page. Use
   wait instead of sleeping after asynchronous changes. Elements inside
   iframes, including cross-origin ones, get refs like any other element.
5. Inspect with eval, console, network, or screenshot --out /tmp/vide-page.png.
   network [URL_PART] lists the tab's recent requests with status codes.
   viewport 390x844 renders the tab at phone size; viewport off restores it.
6. For anything the commands above cannot do, run --tab TAB_ID cdp and parse
   the returned JSON directly in a Playwright script. It contains a private
   access token; do not echo it into chat, logs, or committed files.

PLAYWRIGHT
Use an available playwright-core installation. Given the parsed cdp result:

  const browser = await chromium.connectOverCDP(connection.endpoint, {
    headers: connection.headers
  })
  try {
    const page = browser.contexts()[0].pages()[0]
    await page.getByRole('textbox', { name: 'Email' }).fill('me@example.com')
    await page.screenshot({ path: '/tmp/vide-page.png' })
  } finally {
    await browser.close() // Disconnects without closing the user's tab.
  }

Each endpoint exposes the requested tab and its popup descendants. Use
page.waitForEvent('popup') to receive new popup pages, then interact with them
normally. page.close() closes the corresponding tab; browser.close() only
disconnects. Open unrelated tabs through this CLI, not browser.newContext()
or context.newPage(). Keep the tab alive while using it;
it can remain in the background. Only one debugger can attach per tab, so close
that tab's DevTools or disconnect the other client if it is busy. Leave tabs open
when finished unless the user asks you to close them. The page uses the project's
real signed-in session: stay within the user's requested task.

TROUBLESHOOTING
- Vide's desktop app must be running for commands other than help/instructions.
- Use --info PATH if VIDE_BROWSER_INFO is missing or points to another instance.
- After Vide restarts, rerun cdp to obtain fresh connection details.
- Unknown ref or element gone: run snapshot again and use the new refs.
- If a page crashes, try reload --tab TAB_ID. If native-object errors persist,
  run list, then recover --tab TAB_ID once to rebuild that tab at its saved URL.
  Recovery preserves the tab ID and project session but resets page state and
  disconnects CDP clients; rerun cdp and reconnect with fresh page handles.
  If the tab has disappeared, open its URL again. Do not retry interactions
  that may already have submitted a form or changed data without checking.
- A sandbox may block loopback access. Request the tool's network permission
  rather than disabling authentication or changing the server's bind address.`)
    process.exit(0)
  }
  const base = process.platform === 'darwin' ? join(homedir(), 'Library/Application Support') : process.platform === 'win32' ? process.env.APPDATA : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  const info = JSON.parse(readFileSync(infoPath ?? join(base, 'vide', `browser-control${dev ? '.dev' : ''}.json`), 'utf8'))
  const headers = { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' }
  const response = await fetch(`${info.endpoint}/workspaces`, { headers })
  if (!response.ok) throw new Error(`Browser connection failed (${response.status}); is Vide running?`)
  const workspaces = await response.json()
  if (action === 'workspaces') { console.log(JSON.stringify(workspaces, null, 2)); process.exit(0) }
  const cwd = resolve(workspace ?? process.cwd())
  const target = workspaces.find((w) => w.id === workspace) ?? workspaces.filter((w) => cwd === w.path || (!workspace && cwd.startsWith(`${w.path}/`))).sort((a, b) => b.path.length - a.path.length)[0]
  if (!target) throw new Error('No matching workspace. Use workspaces, then --workspace ID.')
  async function command(action, tabId, value) {
    const response = await fetch(`${info.endpoint}/command`, { method: 'POST', headers, body: JSON.stringify({ workspaceId: target.id, action, tabId, value }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? 'Browser command failed')
    return data.result
  }
  const selected = ['open', 'list'].includes(action) ? undefined : tabId ?? (await command('list')).at(-1)?.id
  if (!['open', 'list'].includes(action) && !selected) throw new Error('Open a tab first')
  const value = action === 'upload' ? [args[0], ...args.slice(1).map((file) => resolve(file))].join('\n') : args.join(' ')
  const result = await command(action, selected, value || undefined)
  if (action === 'screenshot') {
    if (!out) throw new Error('screenshot requires --out FILE')
    writeFileSync(out, Buffer.from(result.base64, 'base64'))
    console.log(out)
  } else if (action === 'cdp') console.log(JSON.stringify({ ...result, headers: { Authorization: headers.Authorization } }, null, 2))
  else if (action === 'snapshot') console.log(result)
  else console.log(JSON.stringify(result, null, 2))
} catch (error) { console.error(error.message); process.exitCode = 1 }
