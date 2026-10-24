---
name: vide-browser
description: Use Vide's in-app browser to preview localhost apps, click through and fill web flows, check mobile layouts, read console errors, and take screenshots when working in Vide. Use when the user asks to open, test, check, or verify a page, a localhost URL, a UI change, or a form in the browser.
---

# Vide browser

Use Vide's in-app browser for browser work in Vide unless the user requests another browser. The desktop app must be running. Outside Vide, use this skill only when the user requests Vide's browser.

The CLI is bundled beside this skill at `scripts/browser.mjs`. Resolve that path relative to this SKILL.md and invoke it by absolute path with Node, keeping the working directory in the user's project or worktree. Run `node /absolute/path/to/scripts/browser.mjs instructions` for the full command list; do not guess commands or flags it does not list.

## Workflow

1. Run `list` to find the current worktree's tabs. Workspace selection uses the current directory; if it cannot resolve it, run `workspaces` and supply `--workspace ID`.
2. Reuse a suitable tab or `open http://localhost:PORT`. Pass `--tab ID` explicitly on every later command.
3. Interact with a snapshot, act, snapshot loop:

```text
node browser.mjs snapshot --tab ID
node browser.mjs click @e3 --tab ID
node browser.mjs fill @e1 me@example.com --tab ID
node browser.mjs press Enter --tab ID
node browser.mjs wait Welcome --tab ID
node browser.mjs snapshot --tab ID
```

4. Check results with `screenshot --out FILE`, `console`, `network [URL_PART]` for request status codes, or `eval`.

## Rules

- Refs like `@e3` come from the latest `snapshot` of that tab. Navigation clears them. Take a new snapshot after navigating, after clicks that change the page, and whenever a ref is unknown or its element is gone.
- `fill` replaces a field's text or picks a `<select>` option by label or value. `type` inserts text into whatever is focused. `press` takes Enter, Tab, Escape, Backspace, arrow keys, single characters, and modifiers such as `Shift+Tab`.
- `hover REF` reveals hover menus and tooltips. `scroll down 800` wheel-scrolls the page and `scroll REF` brings an element into view. `upload REF FILE...` sets files on a file input.
- Elements inside iframes, including cross-origin ones such as payment or login widgets, appear under an `iframe` line in the snapshot and take refs like any other element.
- After an asynchronous change, use `wait TEXT` instead of sleeping.
- `viewport 390x844` renders the tab at phone size, and `viewport off` restores it. Restore it when you finish unless the user wants it kept.
- For anything these commands cannot do, run `cdp` and connect Playwright with `chromium.connectOverCDP` using its endpoint and headers. Keep the authentication token out of chat, logs, and committed files. `browser.close()` disconnects; `page.close()` closes a tab.
- Leave the user's tabs open unless asked to close them. The panel may stay hidden during automation. The browser uses the project's persistent signed-in session; perform only actions within the user's requested task, and check whether a form submission or other data-changing action took effect before retrying it.

## Troubleshooting

`VIDE_BROWSER_INFO`, supplied to new Vide terminals, selects the running app instance. `--info PATH` overrides it; `--dev` selects the development instance when the environment variable is absent. Re-read connection details after Vide restarts. If a sandbox blocks the loopback connection, request network permission rather than working around authentication.

For a crashed page, try `reload --tab ID`. If `Object has been destroyed` or similar native-object errors persist, run `list`, then `recover --tab ID` once for the affected tab. Recovery rebuilds it at its saved URL with the same tab ID and project session, resets page state, and disconnects CDP clients. If the tab has disappeared, reopen its URL.
