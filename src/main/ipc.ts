import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { stat } from 'fs/promises'
import { resolve } from 'path'
import type { Agent, AttachRequest, Config, KillRequest, ProjectAddRequest, SpawnRequest, WorkspaceAdoptRequest, WorkspaceCreateRequest, WorkspaceDeleteRequest } from '../shared/types'
import { configPath, getConfig, reloadConfig, saveConfig } from './config'
import {
  checkoutBranch,
  createWorktree,
  currentBranch,
  getDiff,
  gitLog,
  gitSummary,
  listBranches,
  listWorktreeBranches,
  orphanWorktrees,
  projectRootOf,
  removeWorktree,
  repoRoot,
  statusHash,
  worktreeStatus
} from './git'
import { attachPty, killPty, resizePty, sessionName, spawnPty, writePty } from './pty'
import { loadSession, loadRecent, saveRecent } from './session'
import type { RecentDir, SessionAgent } from '../shared/types'
import { loadState, saveState, updateAgents } from './state'

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

async function spawnAgent(req: SpawnRequest): Promise<Agent> {
  const cfg = getConfig()
  const kind = cfg.agentKinds.find((k) => k.id === req.kindId)
  if (!kind) throw new Error(`unknown agent kind: ${req.kindId}`)
  if ((req.adoptWorktreePath || req.worktreeName?.trim()) && !(await repoRoot(req.cwd))) {
    throw new Error('Worktrees require a Git repository')
  }
  let cwd = req.cwd
  let worktreePath: string | undefined
  let worktreeBranch: string | undefined
  let baseSha: string | undefined
  if (req.adoptWorktreePath) {
    cwd = req.adoptWorktreePath
    worktreePath = cwd
    worktreeBranch = (await currentBranch(cwd)) ?? undefined
  } else if (req.worktreeName?.trim()) {
    const wt = await createWorktree(req.cwd, kind.id, req.worktreeName.trim(), req.baseBranch)
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
    workspaceId: req.workspaceId ?? '',
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
    const agent = await spawnAgent(req)
    const state = await loadState()
    saveState({ ...state, agents: [...state.agents, { id: agent.id, workspaceId: agent.workspaceId, kindId: agent.kindId, cwd: agent.cwd, worktreePath: agent.worktreePath, worktreeBranch: agent.worktreeBranch, baseSha: agent.baseSha, createdAt: agent.createdAt }] })
    return agent
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
      workspaceId: req.workspaceId ?? '',
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
  ipcMain.handle('session:save', (_e, agents: SessionAgent[]) => updateAgents(agents))
  ipcMain.handle('state:load', () => loadState())
  ipcMain.handle('project:add', async (_e, req: ProjectAddRequest) => {
    const path = resolve(req.path)
    if (!(await stat(path)).isDirectory()) throw new Error('Choose a project folder')
    const rootPath = await projectRootOf(path)
    const state = await loadState()
    const existing = state.projects.find((p) => p.rootPath === rootPath)
    if (existing) {
      const workspace = state.workspaces.find((w) => w.projectId === existing.id && w.kind === 'main')
      if (!workspace) throw new Error('Project is missing its Main workspace')
      return { project: existing, workspace }
    }
    const now = Date.now()
    const project = { id: randomUUID(), name: rootPath.split('/').pop() || rootPath, rootPath, createdAt: now, lastOpenedAt: now }
    const workspace = { id: randomUUID(), projectId: project.id, name: 'Main', kind: 'main' as const, path: rootPath, createdAt: now }
    saveState({ ...state, projects: [...state.projects, project], workspaces: [...state.workspaces, workspace] })
    return { project, workspace }
  })
  ipcMain.handle('project:remove', async (_e, p: { projectId: string }) => {
    const state = await loadState()
    const workspaceIds = new Set(state.workspaces.filter((w) => w.projectId === p.projectId).map((w) => w.id))
    if (state.workspaces.some((w) => w.projectId === p.projectId && w.kind === 'worktree')) throw new Error('Delete isolated workspaces first')
    if (state.agents.some((a) => a.workspaceId && workspaceIds.has(a.workspaceId))) throw new Error('Close project terminals first')
    saveState({ ...state, projects: state.projects.filter((x) => x.id !== p.projectId), workspaces: state.workspaces.filter((w) => w.projectId !== p.projectId) })
  })
  ipcMain.handle('workspace:create', async (_e, req: WorkspaceCreateRequest) => {
    const state = await loadState()
    const project = state.projects.find((p) => p.id === req.projectId)
    if (!project) throw new Error('Project not found')
    if (!(await repoRoot(project.rootPath))) throw new Error('Worktrees require a Git repository')
    const wt = await createWorktree(project.rootPath, 'workspace', req.name, req.baseBranch)
    const workspace = { id: randomUUID(), projectId: project.id, name: wt.name, kind: 'worktree' as const, path: wt.path, branch: wt.branch, baseSha: wt.baseSha, createdAt: Date.now() }
    saveState({ ...state, workspaces: [...state.workspaces, workspace] })
    try {
      const agent = await spawnAgent({ kindId: req.kindId, cwd: workspace.path, workspaceId: workspace.id })
      const next = await loadState()
      saveState({ ...next, agents: [...next.agents, { id: agent.id, workspaceId: workspace.id, kindId: agent.kindId, cwd: agent.cwd, worktreePath: workspace.path, worktreeBranch: workspace.branch, baseSha: workspace.baseSha, createdAt: agent.createdAt }] })
      return { workspace, agent }
    } catch (err) {
      return { workspace, launchError: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('workspace:adopt', async (_e, req: WorkspaceAdoptRequest) => {
    const state = await loadState()
    const project = state.projects.find((p) => p.id === req.projectId)
    if (!project) throw new Error('Project not found')
    if (!(await repoRoot(project.rootPath))) throw new Error('Worktrees require a Git repository')
    const livePaths = state.workspaces.filter((w) => w.kind === 'worktree').map((w) => w.path)
    const orphan = (await orphanWorktrees(project.rootPath, livePaths)).find((w) => w.path === req.path)
    if (!orphan) throw new Error('Worktree is already managed or is not a Vide worktree')
    const workspace = { id: randomUUID(), projectId: project.id, name: orphan.path.split('/').pop() || orphan.branch, kind: 'worktree' as const, path: orphan.path, branch: orphan.branch, createdAt: Date.now() }
    saveState({ ...state, workspaces: [...state.workspaces, workspace] })
    try {
      const agent = await spawnAgent({ kindId: req.kindId, cwd: workspace.path, workspaceId: workspace.id })
      const next = await loadState()
      saveState({ ...next, agents: [...next.agents, { id: agent.id, workspaceId: workspace.id, kindId: agent.kindId, cwd: agent.cwd, worktreePath: workspace.path, worktreeBranch: workspace.branch, createdAt: agent.createdAt }] })
      return { workspace, agent }
    } catch (err) {
      return { workspace, launchError: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('workspace:delete', async (_e, req: WorkspaceDeleteRequest) => {
    const state = await loadState()
    const workspace = state.workspaces.find((w) => w.id === req.workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.kind === 'main') throw new Error('The Main workspace cannot be deleted')
    const info = await worktreeStatus(workspace.path, workspace.baseSha)
    if ((info.dirty || info.hasOwnCommits) && !req.force) throw new Error('Workspace has changes or commits; force confirmation required')
    const owned = state.agents.filter((a) => a.workspaceId === workspace.id)
    for (const agent of owned) await killPty(agent.id)
    const result = await removeWorktree({ path: workspace.path, branch: workspace.branch, force: info.dirty, deleteBranch: req.deleteBranch })
    saveState({ ...state, workspaces: state.workspaces.filter((w) => w.id !== workspace.id), agents: state.agents.filter((a) => a.workspaceId !== workspace.id) })
    return result
  })
  ipcMain.handle('recent:load', () => loadRecent())
  ipcMain.handle('recent:save', (_e, dirs: RecentDir[]) => saveRecent(dirs))

  ipcMain.handle('agent:worktreeStatus', (_e, p: { path: string; baseSha?: string }) =>
    worktreeStatus(p.path, p.baseSha)
  )

  ipcMain.handle('agent:kill', async (_e, req: KillRequest) => {
    await killPty(req.agentId)
    const state = await loadState()
    saveState({ ...state, agents: state.agents.filter((a) => a.id !== req.agentId) })
    if (req.worktree) return removeWorktree(req.worktree)
    return { branchKept: false }
  })

  ipcMain.handle('git:orphanWorktrees', (_e, p: { cwd: string; livePaths: string[] }) =>
    orphanWorktrees(p.cwd, p.livePaths)
  )

  ipcMain.handle('git:deleteOrphan', async (_e, p: { path: string }) => {
    await removeWorktree({ path: p.path, force: true, deleteBranch: false })
  })

  ipcMain.handle(
    'diff:get',
    (_e, p: { cwd: string; ref?: string; full?: boolean; allChanges?: boolean }) =>
      getDiff(p.cwd, p.ref, p.full, p.allChanges)
  )
  ipcMain.handle('diff:statusHash', (_e, p: { cwd: string }) => statusHash(p.cwd))
  ipcMain.handle('git:log', (_e, p: { cwd: string; skip?: number }) => gitLog(p.cwd, p.skip))
  ipcMain.handle('git:summary', (_e, p: { cwd: string }) => gitSummary(p.cwd))
  ipcMain.handle('git:repoRoot', (_e, p: { cwd: string }) => repoRoot(p.cwd))
  ipcMain.handle('git:branches', (_e, p: { cwd: string }) => listBranches(p.cwd))
  ipcMain.handle('git:worktreeBranches', (_e, p: { cwd: string }) => listWorktreeBranches(p.cwd))
  ipcMain.handle('git:checkout', (_e, p: { cwd: string; branch: string }) =>
    checkoutBranch(p.cwd, p.branch)
  )
  ipcMain.handle(
    'open:ide',
    (_e, p: { path: string }) =>
      new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', ['-b', 'com.microsoft.VSCode', p.path], (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
  )

  ipcMain.handle('open:external', (_e, p: { url: string }) => shell.openExternal(p.url))

  ipcMain.handle('dialog:pickDirectory', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })

  ipcMain.handle('clipboard:readText', () => clipboard.readText())

  ipcMain.on('pty:input', (_e, p: { agentId: string; data: string }) => writePty(p.agentId, p.data))
  ipcMain.on('pty:resize', (_e, p: { agentId: string; cols: number; rows: number }) =>
    resizePty(p.agentId, p.cols, p.rows)
  )
}
