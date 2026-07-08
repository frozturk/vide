# vide

A keyboard-driven desktop shell for running multiple AI coding agents in
parallel.

Vide spawns each agent in its own tmux-backed terminal inside a single window,
so you can keep a fleet of Claude Code, Codex, and OpenCode sessions running
side by side — each isolated in its own git worktree — and never lose them when
the app closes.

## Features

**Multi-agent terminals** — One window, many agents. Each agent runs in a real
PTY backed by a tmux session, so it survives app restarts. Reopen vide and
your agents are right where you left them.

**Git worktree isolation** — Optionally spawn an agent in a fresh worktree on a
new `vide/<slug>` branch off HEAD. Orphaned worktrees are detected and can be
adopted or deleted from the spawn dialog.

**Live status detection** — Per-agent regexes parse terminal output to show
`busy`, `waiting`, `idle`, or `exited` at a glance, with pulsing dots and
unread indicators in the agent strip.

**Diff viewer** — A full git diff overlay (`⌘D`) with syntax-highlighted hunks,
file status letters, and untracked-file support. Built on
`@git-diff-view/react`.

**Embedded browser** — A WebContentsView pane (`⌘B`) for viewing your dev
server alongside your agents, with navigation back/reload and URL focus (`⌘L`).

**Keyboard-first** — `⌘T` spawn, `⌘W` close, `⌘↑/↓` switch agents, `⌘1`–`⌘9`
jump, `⌘D` diff, `⌘B` browser, `⌘,` open config, `⌘⇧R` reload config.

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
  "defaultBrowserUrl": "http://localhost:3000",
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

Each spawned agent creates a detached tmux session named
`vide-<kind>-<dir>-<shortid>`. vide attaches a node-pty to it and streams
output to the renderer. When you quit vide with agents still running, the tmux
sessions are left alive in the background; on next launch, vide reattaches
automatically. Orphaned `vide-*` sessions from crashed runs are reaped on
startup.

## How worktrees work

When you give an agent a worktree name (optional), vide runs
`git worktree add -b vide/<slug> <path> HEAD` inside the chosen repo, creating
`.vide/worktrees/<slug>` (gitignored automatically) and a branch
`vide/<slug>`. The agent's terminal starts in that worktree. On close, vide
offers to remove the worktree and delete the branch.

## Shortcuts

| chord   | action                         |
| ------- | ----------------------------- |
| `⌘T`    | Spawn new agent               |
| `⌘W`    | Close current agent           |
| `⌘↑/↓`  | Previous / next agent         |
| `⌘1`–`9` | Jump to agent N               |
| `⌘D`    | Toggle diff overlay           |
| `⌘B`    | Toggle browser pane           |
| `⌘L`    | Focus browser URL bar         |
| `⌘,`    | Open config file              |
| `⌘⇧R`   | Reload config                 |
| `Esc`   | Close overlay / dialog        |

## Tech

Electron · electron-vite · React 19 · TypeScript · Tailwind v4 · zustand ·
node-pty · xterm.js · `@git-diff-view/react` · tmux.
