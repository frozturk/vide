import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import type { AttachRequest, Config, KillRequest, SpawnRequest } from '../shared/types'
import { configPath, getConfig, reloadConfig, saveConfig } from './config'
import {
  checkoutBranch,
  createWorktree,
  currentBranch,
  getDiff,
  gitLog,
  gitSummary,
  listBranches,
  orphanWorktrees,
  projectRootOf,
  removeWorktree,
  repoRoot,
  statusHash,
  worktreeStatus
} from './git'
import { attachPty, killPty, resizePty, sessionName, spawnPty, writePty } from './pty'
import {
  browserBack,
  browserCloseTab,
  browserForward,
  browserLoadUrl,
  browserNewTab,
  browserOpenUrl,
  browserReload,
  browserSelectTab,
  setBrowserDragging,
  setBrowserSplit,
  setBrowserVisible
} from './browser'
import { loadSession, saveSession, loadRecent, saveRecent } from './session'
import type { RecentDir, SessionAgent } from '../shared/types'

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function buildCommand(template: string, prompt?: string): string {
  const t = template.trim()
  if (!t) return ''
  const p = prompt?.trim()
  if (t.includes('{prompt}')) {
    return t.replace('{prompt}', () => (p ? shellQuote(p) : '')).trim()
  }
  return p ? `${t} ${shellQuote(p)}` : t
}

export function wireIpc(win: BrowserWindow): void {
  ipcMain.handle('config:get', () => getConfig())
  ipcMain.handle('config:reload', () => reloadConfig())
  ipcMain.handle('config:save', (_e, config: Config) => {
    saveConfig(config)
    return reloadConfig()
  })
  ipcMain.handle('config:open', () => {
    shell.openPath(configPath())
  })

  ipcMain.handle('agent:spawn', async (_e, req: SpawnRequest) => {
    const cfg = getConfig()
    const kind = cfg.agentKinds.find((k) => k.id === req.kindId)
    if (!kind) throw new Error(`unknown agent kind: ${req.kindId}`)
    let cwd = req.cwd
    let worktreePath: string | undefined
    let worktreeBranch: string | undefined
    let baseSha: string | undefined
    if (req.adoptWorktreePath) {
      cwd = req.adoptWorktreePath
      worktreePath = cwd
      worktreeBranch = (await currentBranch(cwd)) ?? undefined
    } else if (req.worktreeName?.trim()) {
      const wt = await createWorktree(req.cwd, kind.id, req.worktreeName.trim())
      cwd = wt.path
      worktreePath = wt.path
      worktreeBranch = wt.branch
      baseSha = wt.baseSha
    }
    const root = await repoRoot(cwd)
    const projectRoot = await projectRootOf(cwd)
    const id = randomUUID()
    const sh = cfg.shell ?? process.env.SHELL ?? '/bin/zsh'
    const sName = sessionName(id, kind.id, cwd)
    await spawnPty(id, sh, buildCommand(kind.command), cwd, kind.id)
    return {
      id,
      kindId: kind.id,
      title: sName,
      sessionName: sName,
      cwd,
      repoRoot: root,
      projectRoot,
      worktreePath,
      worktreeBranch,
      baseSha,
      createdAt: Date.now()
    }
  })

  ipcMain.handle('agent:attach', async (_e, req: AttachRequest) => {
    const cfg = getConfig()
    const kind = cfg.agentKinds.find((k) => k.id === req.kindId)
    if (!kind) throw new Error(`unknown agent kind: ${req.kindId}`)
    const sName = sessionName(req.id, kind.id, req.cwd)
    const attached = await attachPty(req.id, kind.id, req.cwd)
    if (!attached) return null
    const root = await repoRoot(req.cwd).catch(() => null)
    const projectRoot = await projectRootOf(req.cwd).catch(() => req.cwd)
    return {
      id: req.id,
      kindId: kind.id,
      title: sName,
      sessionName: sName,
      cwd: req.cwd,
      repoRoot: root,
      projectRoot,
      worktreePath: req.worktreePath,
      worktreeBranch: req.worktreeBranch,
      baseSha: req.baseSha,
      createdAt: req.createdAt
    }
  })

  ipcMain.handle('session:load', () => loadSession())
  ipcMain.handle('session:save', (_e, agents: SessionAgent[]) => saveSession(agents))
  ipcMain.handle('recent:load', () => loadRecent())
  ipcMain.handle('recent:save', (_e, dirs: RecentDir[]) => saveRecent(dirs))

  ipcMain.handle('agent:worktreeStatus', (_e, p: { path: string; baseSha?: string }) =>
    worktreeStatus(p.path, p.baseSha)
  )

  ipcMain.handle('agent:kill', async (_e, req: KillRequest) => {
    await killPty(req.agentId)
    if (req.worktree) return removeWorktree(req.worktree)
    return { branchKept: false }
  })

  ipcMain.handle('git:orphanWorktrees', (_e, p: { cwd: string; livePaths: string[] }) =>
    orphanWorktrees(p.cwd, p.livePaths)
  )

  ipcMain.handle('git:deleteOrphan', async (_e, p: { path: string }) => {
    await removeWorktree({ path: p.path, force: true, deleteBranch: false })
  })

  ipcMain.handle('diff:get', (_e, p: { cwd: string; ref?: string }) => getDiff(p.cwd, p.ref))
  ipcMain.handle('diff:statusHash', (_e, p: { cwd: string }) => statusHash(p.cwd))
  ipcMain.handle('git:log', (_e, p: { cwd: string }) => gitLog(p.cwd))
  ipcMain.handle('git:summary', (_e, p: { cwd: string }) => gitSummary(p.cwd))
  ipcMain.handle('git:branches', (_e, p: { cwd: string }) => listBranches(p.cwd))
  ipcMain.handle('git:checkout', (_e, p: { cwd: string; branch: string }) =>
    checkoutBranch(p.cwd, p.branch)
  )
  ipcMain.handle('open:editor', (_e, p: { path: string }) => {
    shell.openExternal(`vscode://file${p.path}`)
  })

  ipcMain.handle('browser:setVisible', (_e, p: { visible: boolean; focusPage: boolean }) =>
    setBrowserVisible(p.visible, p.focusPage)
  )
  ipcMain.handle('browser:loadUrl', (_e, p: { url: string }) => browserLoadUrl(p.url))
  ipcMain.handle('browser:back', () => browserBack())
  ipcMain.handle('browser:forward', () => browserForward())
  ipcMain.handle('browser:reload', () => browserReload())
  ipcMain.handle('browser:newTab', () => browserNewTab())
  ipcMain.handle('browser:closeTab', (_e, p: { id: number }) => browserCloseTab(p.id))
  ipcMain.handle('browser:selectTab', (_e, p: { id: number }) => browserSelectTab(p.id))
  ipcMain.handle('browser:openUrl', (_e, p: { url: string }) => browserOpenUrl(p.url))
  ipcMain.handle('browser:setSplit', (_e, p: { fraction: number }) => setBrowserSplit(p.fraction))
  ipcMain.handle('browser:setDragging', (_e, p: { dragging: boolean }) =>
    setBrowserDragging(p.dragging)
  )

  ipcMain.handle('dialog:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.on('pty:input', (_e, p: { agentId: string; data: string }) => writePty(p.agentId, p.data))
  ipcMain.on('pty:resize', (_e, p: { agentId: string; cols: number; rows: number }) =>
    resizePty(p.agentId, p.cols, p.rows)
  )
}
