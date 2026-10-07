---
name: vide-browser
description: Use Vide's in-app browser to preview localhost apps, inspect pages and console errors, take screenshots, and interact with web flows when working in Vide.
---

# Vide browser

Use Vide's in-app browser for browser work in Vide unless the user requests another browser. The desktop app must be running. Outside Vide, use this skill only when the user requests Vide's browser.

The CLI is bundled beside this skill at `scripts/browser.mjs`. Resolve that path relative to this SKILL.md and invoke it by absolute path with Node, keeping the working directory in the user's project or worktree.

1. Run `node /absolute/path/to/scripts/browser.mjs instructions` for commands and Playwright connection examples.
2. Run `list` to find the current worktree's tabs. Workspace selection uses the current directory; if it cannot resolve it, run `workspaces` and supply `--workspace ID`.
3. Reuse a suitable tab or `open http://localhost:PORT`. Pass `--tab ID` explicitly for subsequent commands.
4. Inspect with `eval`, `console`, or `screenshot --out FILE`. For Playwright, parse the `cdp` command's JSON directly in your script and use `chromium.connectOverCDP` with its endpoint and headers. Keep its authentication token out of chat, logs, and committed files.

`VIDE_BROWSER_INFO`, supplied to new Vide terminals, selects the running app instance. `--info PATH` overrides it; `--dev` selects the development instance when the environment variable is absent. Re-read connection details after Vide restarts.

Each CDP connection exposes the requested tab and its popup descendants. Open unrelated tabs through the CLI. `browser.close()` disconnects; `page.close()` closes a tab. Leave the user's tabs open unless asked to close them. The panel may stay hidden during automation. The browser uses the project's persistent signed-in session; perform only actions within the user's requested task.
