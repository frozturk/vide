# vide

A keyboard-driven desktop shell for running multiple AI coding agents in
parallel.

Vide organizes folders into projects, gives each project a permanent Main
workspace, offers isolated git-worktree workspaces for Git repositories, and runs one or more
agent terminals in each workspace.

## Download

Get the Windows installer or the macOS (Apple Silicon) `.dmg` from the
[latest release](https://github.com/frozturk/vide/releases/latest). The builds
are not code-signed yet: on Windows choose **More info → Run anyway**. On
macOS, after the first blocked launch choose **Open Anyway** in System Settings →
Privacy & Security, or run `xattr -dr com.apple.quarantine /Applications/Vide.app`.

## Features

**Multi-agent terminals** — One window, many agents. Each agent runs in a real
terminal held by [litemux](https://github.com/frozturk/litemux), a small
background server, so it survives app restarts. Reopen vide and your agents
are right where you left them.

**Projects and workspaces** — Open any folder and work directly in
its permanent Main workspace. Git repositories also support isolated workspaces for parallel work.
Each workspace can contain multiple agent and shell terminals.

**Git worktree isolation** — New workspaces get a unique `vide/<slug>` branch
off a selected local or origin branch (defaulting to Main's current HEAD). The base branch
picker lists local and fetched origin branches together by latest commit date, newest first. Orphaned Vide worktrees can be adopted. Closing a
terminal never removes its workspace.

**Live status detection**: Claude Code and Codex report `busy`, `waiting`,
and `idle` through their own hooks, the same way on every screen. At startup
vide merges entries into `~/.claude/settings.json` and
`~/.codex/hooks.json` that run `litemux hook <event>`. They do nothing outside
vide terminals and leave your own hooks untouched. Agents without hooks (shells,
OpenCode, Antigravity) show as idle. Pulsing dots and unread indicators in the agent strip
show which terminal needs you.

Vide launches Codex with `--no-daemon` so each terminal's hooks inherit its
own terminal session instead of the shared Codex server's environment. Existing
sessions must be restarted or resumed with `codex --no-daemon resume` to
pick up this change. If you customize the Codex launch command, keep
`--no-daemon`. Review and trust Vide's entries in Codex's `/hooks` menu when
prompted; installing hooks does not automatically grant trust.

**Diff viewer** — A full git diff overlay (`⌘D`) with syntax-highlighted hunks,
file status letters, Seti file icons, untracked-file support, and a commit
history list for per-commit diffs. Built on `@git-diff-view/react`.

**Git in the top bar** — Current branch with ahead/behind and change counts.
Main workspaces get a branch switcher; `IDE` opens the workspace in VS Code.

**Localhost servers** — A top bar button lists every process listening on a
local port: ports (click to open in the browser), process, pid, uptime, and
where it runs (shown as `repo / worktree` for Vide worktrees). `Kill` sends
SIGTERM, then `Force kill` sends SIGKILL. Ports 49152 and up are hidden.

**Command palette and search** — `⌘K` for commands, workspaces, terminals, and
Settings; `⌘F` searches the current terminal.

**Keyboard-first** — `⌘N` workspace, `⌘T` new agent with optional worktree, `⌘W` close terminal,
`⌘↑/↓` switch workspaces, `⌘S` switch terminal tabs, `⌘E` jump to the next terminal needing attention,
`⌘K` palette, `⌘F` find, and `⌘D` diff.

**macOS-native chrome** — Hidden inset title bar, traffic lights, dark zinc
palette.

## Web access

While vide runs, it also serves itself at `http://localhost:7878` (`7879`
during `npm run dev`), so you can use it from a browser or your phone. Browser
tabs and the desktop window share the same agents: typing, spawning, and
closing terminals stay in sync.

- **Device pairing**: Settings → Web access shows a QR code and a one-time
  code (`XXXXX-XXXXX`). Scan it, or open the site and type the code. Codes work
  once and expire after 5 minutes; they travel after `#`, so no server or
  tunnel sees them. Each paired device gets its own secret in an HttpOnly
  cookie. Settings lists paired devices with their connection status, and you
  can revoke one or all. Ten wrong codes lock pairing for a minute.
- **Remote access**: the server only accepts connections from this Mac, so
  expose it with a tunnel. `tailscale funnel --bg 7878` gives a public HTTPS
  URL that terminates TLS on your Mac, so Tailscale can't read the traffic and
  your phone needs no app. vide detects the Tailscale address for the QR code;
  for any other tunnel, set Public URL in Settings.
- **Relay**: `relay/` is a Cloudflare Worker that reaches vide without a
  tunnel. Put `RELAY_DOMAIN=vide.example.com` in `relay/.env` (gitignored),
  deploy with `cd relay && npm install && npm run deploy`, which bundles this
  checkout's web UI, then set Relay URL in Settings. To let only
  your Macs register, run `npx wrangler secret put RELAY_TOKEN` and enter the
  same value as Relay Token. vide connects
  out to it, and each instance lives at `/i/<id>/`; the relay's home page lists
  every instance you paired on that device. The relay serves the UI itself and
  passes only `/ws`, `/ping` and pairing to an instance, so instances can't run
  code in the browser. The relay only checks `PROTOCOL` in
  `src/shared/protocol.ts`; bump it whenever the web UI and the Mac stop being
  compatible (a changed IPC channel, message shape or terminal frame), then
  release vide and redeploy the relay. The first vide
  to claim an id owns it, and Cloudflare sees the traffic.
- **Mobile**: a responsive layout with a workspace drawer, bottom-sheet dialogs,
  touch scrolling, and a key bar (`esc`, `tab`, sticky `ctrl`, arrows, `^C`,
  paste). Add it to your home screen for a full-screen app.
- **Not indexed**: every response sends `X-Robots-Tag: noindex`, and
  `robots.txt` disallows all crawlers.
- The port is configurable in Settings (`webPort`). A browser tab can't capture
  `⌘T`/`⌘W`/`⌘N`, so use the command palette or the on-screen buttons there.

## Requirements

- macOS or Windows 10/11
- [Node.js](https://nodejs.org) and a [Rust](https://rustup.rs) toolchain to
  build litemux
- At least one agent CLI installed — e.g. `claude`, `codex`, `opencode`, or `agy`

The shell is `$SHELL` (zsh by default) on macOS and Windows PowerShell on
Windows; set another one in Settings (`pwsh.exe`, `cmd.exe` or Git Bash work).

On Windows, app shortcuts use **Ctrl+Shift** in place of `⌘` (Ctrl+Shift+T adds
a terminal, Ctrl+Shift+C/V copy and paste), so Ctrl+C and Ctrl+D still reach
terminal programs. Some labels in the UI still show `⌘`, and the local servers
panel is macOS only.

## Install

```bash
git clone --recurse-submodules <repo> vide
cd vide
npm install
```

If the Electron binary fails to download during install, run it explicitly:

```bash
node node_modules/electron/install.js
```

## Run

Development (hot reload of renderer + main):

```bash
npm run dev
```

Production preview (compiled, no dev tools):

```bash
npm run build
npm start
```

Package a distributable macOS `.app` / `.dmg`:

```bash
npm run package
```

Output lands in `dist/`. The app is unsigned — on first launch right-click →
**Open** to bypass Gatekeeper.

## Configuration

The config file is created at `~/Library/Application Support/vide/config.json`
on first launch. Edit agent kinds in Settings (sidebar or `⌘K`), open the file
with `⌘,`, or edit it directly — `⌘⇧R` reloads it without restarting.

```jsonc
{
  "agentKinds": [
    {
      "id": "claude",
      "name": "Claude Code",
      "command": "claude {prompt}",
      "color": "#d97757"
    },
    {
      "id": "codex",
      "name": "Codex CLI",
      "command": "codex --no-daemon {prompt}",
      "color": "#4a9eff"
    }
  ],
  "worktreeBase": ".vide/worktrees",
  "shell": "/bin/zsh"
}
```

Set `"hideClaudeInputBox": true` to hide Claude Code's input box behind the
mobile web composer (experimental, off by default).

### Agent kinds

Each kind defines how an agent is launched.

| field          | purpose                                                                |
| -------------- | --------------------------------------------------------------------- |
| `id`           | Stable identifier used in session names and the store.                |
| `name`         | Display label in buttons and the agent strip.                         |
| `command`      | Shell command. A `{prompt}` placeholder is removed.                    |
| `color`        | Accent color for the agent's icon and active states.                  |

Leave `command` empty for a plain shell. The `shell` kind is included by
default for ad hoc terminals.

## How sessions work

Each terminal is a litemux session named `vide-<kind>-<dir>-<shortid>`
(`vide-dev-*` during `npm run dev`). vide starts the litemux server on demand
and connects to it over `127.0.0.1` with a token from `litemux.json` in its
data folder; development uses `litemux.dev.json` and `state.dev.json`, so it
cannot attach to or overwrite production terminals. When you quit vide with
agents still running, the sessions keep running in the background; on next
launch, vide reattaches and restores each screen with its scrollback.
Orphaned sessions are reaped on startup.

## How projects and workspaces work

Adding a project creates a permanent Main workspace for the repository root.
Creating an isolated workspace runs `git worktree add -b vide/<slug> <path>
<base-commit>`, using the selected branch's tip or Main's current HEAD by default,
then launches the selected agent there. Additional terminals share the
same workspace. Deleting a dirty workspace requires typed confirmation;
branches containing commits are preserved unless explicitly selected for
deletion.

## Shortcuts

| chord   | action                         |
| ------- | ----------------------------- |
| `⌘N`    | Create workspace and launch agent |
| `⌘T`    | New agent (optional worktree) |
| `⌘W`    | Close current terminal        |
| `⌘↑/↓`  | Previous / next workspace     |
| `⌘1`–`9` | Jump to workspace N          |
| `⌘S`    | Next terminal in workspace     |
| `⌘E`    | Next non-idle or unread terminal |
| `⌘D`    | Toggle diff overlay           |
| `⌘K`    | Command palette               |
| `⌘F`    | Search terminal               |
| `⌘,`    | Open config file              |
| `⌘⇧R`   | Reload config                 |
| `Esc`   | Close overlay / dialog        |

On Windows, use Ctrl+Shift in place of `⌘`.

## Releasing

Set `version` in `package.json`, commit, then push a matching tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

CI builds both installers and publishes them as a GitHub release.

## Tech

Electron · electron-vite · React 19 · TypeScript · Tailwind v4 · zustand ·
xterm.js · `@git-diff-view/react` · [litemux](https://github.com/frozturk/litemux) (Rust).

## In-app browser

On desktop, click **Browser** (⌘B) to show the workspace's browser floating over the
terminal. Opening or resizing the browser leaves the terminal's dimensions
unchanged. The pane has tabs, an address bar, back/forward, reload, and detached
DevTools. With focus in the page or browser toolbar, ⌘W closes the browser tab,
⌘T opens a tab, ⌘R reloads, and ⌘L focuses the address bar. Drag its left edge to
resize it. Local-server port buttons open in this
pane. Web/mobile clients continue to use their own browser; the native pane is
not streamed to them.

Tabs and their last URLs survive app restarts and belong to a workspace. Cookies,
localStorage, and IndexedDB use a persistent Electron partition per project, so
workspaces in one project share logins and unrelated projects do not. Development
and production partitions are separate. Login popups inherit the opener's
session. Links and popups open as tabs in the same workspace, preserving normal
window.opener and window.close() behavior (including rel="noopener" isolation). Navigation shows a browser icon and tab count
for each workspace, including workspaces that have only browser tabs. Closing a
tab does not erase site data. Inactive tabs beyond three live background views unload and restore from their saved URL; unsaved page state and
navigation history do not survive unloading. Tabs with active automation and live
popup/opener relationships stay alive. Opener relationships are not restored
across app restarts. The old global `vide-browser` profile is not automatically
imported.

### Agent control

At startup, Vide installs a managed `vide-browser` skill into
`~/.agents/skills/vide-browser` and `~/.claude/skills/vide-browser`. It includes
its own browser CLI, so agents can use it from any project without locating the
Vide source checkout. New agent sessions discover the skill automatically;
restart an existing agent session if its skill list is already loaded. Vide
updates its managed skill on startup and leaves user-owned skills with the same
name untouched. No project `AGENTS.md` changes are needed.

Agents can also read the complete workflow with `node scripts/browser.mjs instructions`
(or `--help`), even when Vide is not running. For agents working elsewhere, tell
them to run the same command using the script's absolute path.

Vide starts a separate authenticated, loopback-only browser-control server.
New terminals receive `VIDE_BROWSER_INFO`, the path to its connection file. On
restart the file contains the current endpoint and token; existing terminals
using the same path can reconnect. The file lives under Electron's `userData`
directory as `browser-control.json` (`browser-control.dev.json` in development),
with owner-only permissions. The companion CLI can also take `--info PATH`.

```sh
node scripts/browser.mjs workspaces
node scripts/browser.mjs --workspace WORKSPACE_ID open http://localhost:3000
node scripts/browser.mjs --workspace WORKSPACE_ID list
node scripts/browser.mjs --workspace WORKSPACE_ID --tab TAB_ID eval 'document.title'
node scripts/browser.mjs --workspace WORKSPACE_ID --tab TAB_ID screenshot --out /tmp/page.png
node scripts/browser.mjs --workspace WORKSPACE_ID --tab TAB_ID console
node scripts/browser.mjs --workspace WORKSPACE_ID --tab TAB_ID cdp
```

Without `--workspace`, the CLI finds the workspace containing the current working
directory. Without `--tab`, commands target the last listed tab. `help` lists all
commands. The CLI is a repository script and can be invoked by its absolute path
from another project; no global installation is required.

The `cdp` command returns an endpoint and authentication headers. A Playwright
client can attach to the existing page:

```js
import { chromium } from 'playwright-core'

// Use the JSON returned by the cdp command; it contains a local access token.
const connection = JSON.parse(connectionJson)
const browser = await chromium.connectOverCDP(connection.endpoint, {
  headers: connection.headers
})
try {
  const page = browser.contexts()[0].pages()[0]
  await page.getByRole('textbox', { name: 'Email' }).fill('me@example.com')
  await page.screenshot({ path: '/tmp/page.png' })
} finally {
  await browser.close() // Disconnects; leaves the user's tab open.
}
```

Each connection exposes the requested tab and its popup descendants. Playwright
can use page.waitForEvent('popup'), interact with the new page, and close it with
page.close(). Unrelated tabs are not exposed. Create unrelated tabs through the
Vide API or CLI, not Playwright's browser/context creation APIs. Only one debugger
client can attach to a tab at a time; close its DevTools before attaching. Automation also
works on background tabs. Browser-wide management commands are not exposed.
Disconnecting leaves the user's tabs open; explicitly calling page.close() closes
that tab. The API uses the project's real signed-in session.
