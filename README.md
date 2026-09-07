# vide

A keyboard-driven desktop shell for running multiple AI coding agents in
parallel.

Vide organizes repositories into projects, gives each project a permanent Main
workspace plus isolated git-worktree workspaces, and runs one or more
tmux-backed agent terminals in each workspace.

## Features

**Multi-agent terminals** — One window, many agents. Each agent runs in a real
PTY backed by a tmux session, so it survives app restarts. Reopen vide and
your agents are right where you left them.

**Projects and workspaces** — Register a Git repository once, work directly in
its permanent Main workspace, or create isolated workspaces for parallel work.
Each workspace can contain multiple agent and shell terminals.

**Git worktree isolation** — New workspaces get a unique `vide/<slug>` branch
off Main's current HEAD. Orphaned Vide worktrees can be adopted. Closing a
terminal never removes its workspace.

**Live status detection** — Per-agent regexes parse terminal output to show
`busy`, `waiting`, `idle`, or `exited` at a glance, with pulsing dots and
unread indicators in the agent strip.

**Diff viewer** — A full git diff overlay (`⌘D`) with syntax-highlighted hunks,
file status letters, and untracked-file support. Built on
`@git-diff-view/react`.

**Keyboard-first** — `⌘N` workspace, `⌘T` new agent with optional worktree, `⌘W` close terminal,
`⌘↑/↓` switch workspaces, `Ctrl+Tab` switch terminals, `⌘E` jump to the next non-idle terminal,
and `⌘D` diff.

**macOS-native chrome** — Hidden inset title bar, traffic lights, dark zinc
palette.

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
on first launch. Open it with `⌘,` from the app, or edit it directly —
`⌘⇧R` reloads it without restarting.

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
HEAD`, then launches the selected agent there. Additional terminals share the
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
| `Ctrl+Tab` | Next terminal in workspace  |
| `Ctrl+Shift+Tab` | Previous terminal       |
| `⌘E`    | Next non-idle terminal across workspaces |
| `⌘D`    | Toggle diff overlay           |
| `⌘,`    | Open config file              |
| `⌘⇧R`   | Reload config                 |
| `Esc`   | Close overlay / dialog        |

## Tech

Electron · electron-vite · React 19 · TypeScript · Tailwind v4 · zustand ·
node-pty · xterm.js · `@git-diff-view/react` · tmux.
