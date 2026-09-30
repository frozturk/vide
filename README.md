# vide

A keyboard-driven desktop shell for running multiple AI coding agents in
parallel.

Vide organizes folders into projects, gives each project a permanent Main
workspace, offers isolated git-worktree workspaces for Git repositories, and runs one or more
tmux-backed agent terminals in each workspace.

## Features

**Multi-agent terminals** — One window, many agents. Each agent runs in a real
PTY backed by a tmux session, so it survives app restarts. Reopen vide and
your agents are right where you left them.

**Projects and workspaces** — Open any folder and work directly in
its permanent Main workspace. Git repositories also support isolated workspaces for parallel work.
Each workspace can contain multiple agent and shell terminals.

**Git worktree isolation** — New workspaces get a unique `vide/<slug>` branch
off a selected local or origin branch (defaulting to Main's current HEAD). The base branch
picker lists local and fetched origin branches together by latest commit date, newest first. Orphaned Vide worktrees can be adopted. Closing a
terminal never removes its workspace.

**Live status detection**: Claude Code and Codex report `busy`, `waiting`,
and `idle` through their own hooks. At startup vide merges guarded entries
into `~/.claude/settings.json` and `~/.codex/hooks.json`; they only run inside
vide terminals (`VIDE_AGENT` is set) and leave your own hooks untouched. Other
agents fall back to per-agent regexes on terminal output. Pulsing dots and
unread indicators in the agent strip show which terminal needs you.

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
- **Mobile**: a responsive layout with a workspace drawer, bottom-sheet dialogs,
  touch scrolling, and a key bar (`esc`, `tab`, sticky `ctrl`, arrows, `^C`,
  paste). Add it to your home screen for a full-screen app.
- **Not indexed**: every response sends `X-Robots-Tag: noindex`, and
  `robots.txt` disallows all crawlers.
- The port is configurable in Settings (`webPort`). A browser tab can't capture
  `⌘T`/`⌘W`/`⌘N`, so use the command palette or the on-screen buttons there.

## Requirements

- macOS (Apple Silicon or Intel)
- [tmux](https://github.com/tmux/tmux) on your `PATH` (or at a standard location)
- A shell (`zsh` by default; configurable)
- At least one agent CLI installed — e.g. `claude`, `codex`, or `opencode`

## Install

```bash
git clone <repo> vide
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
      "color": "#d97757",
      "busyRegex": "esc to interrupt",
      "waitingRegex": "Do you want|\\(y/n\\)"
    },
    {
      "id": "codex",
      "name": "Codex CLI",
      "command": "codex {prompt}",
      "color": "#4a9eff"
    }
  ],
  "worktreeBase": ".vide/worktrees",
  "shell": "/bin/zsh"
}
```

### Agent kinds

Each kind defines how an agent is launched and how its status is detected.

| field          | purpose                                                                |
| -------------- | --------------------------------------------------------------------- |
| `id`           | Stable identifier used in session names and the store.                |
| `name`         | Display label in buttons and the agent strip.                         |
| `command`      | Shell command template. `{prompt}` is shell-quoted and substituted in. |
| `color`        | Accent color for the agent's icon and active states.                  |
| `busyRegex`    | When matched in output, the agent shows **busy**.                    |
| `waitingRegex` | When matched in output, the agent shows **waiting**.                  |

Leave `command` empty for a plain shell. The `shell` kind is included by
default for ad hoc terminals.

## How sessions work

Each terminal creates a detached tmux session named
`vide-<kind>-<dir>-<shortid>` (`vide-dev-*` during `npm run dev`). Development
also uses `state.dev.json`, so it cannot attach to or overwrite production
terminal metadata. vide attaches a node-pty to the session and streams
output to the renderer. When you quit vide with agents still running, the tmux
sessions are left alive in the background; on next launch, vide reattaches
automatically. Orphaned sessions are reaped only within the current runtime's
production or development namespace.

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

## Tech

Electron · electron-vite · React 19 · TypeScript · Tailwind v4 · zustand ·
node-pty · xterm.js · `@git-diff-view/react` · tmux.
