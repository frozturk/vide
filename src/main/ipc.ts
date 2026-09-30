import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { stat } from 'fs/promises'
import { homedir } from 'os'
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
import { killLocalServer, listLocalServers } from './ports'
import { attachPty, killPty, resizePty, sessionName, spawnPty, writePty } from './pty'
import { loadSession, loadRecent, saveRecent } from './session'
import type { RecentDir, SessionAgent } from '../shared/types'
import { loadState, saveState, updateAgents } from './state'
import { broadcast, DESKTOP } from './clients'
import { regenerateToken, restartWebServer, webInfo } from './web'

export type Handler = (arg: any, clientId: string) => unknown

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

async function spawnAgent(req: SpawnRequest, clientId: string): Promise<Agent> {
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
  await spawnPty(clientId, id, sh, buildCommand(kind.command), cwd, kind.id)
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

const MUTATIONS: Record<string, string> = {
  'config:save': 'config:changed',
  'agent:spawn': 'state:changed',
  'agent:kill': 'state:changed',
  'project:add': 'state:changed',
  'project:remove': 'state:changed',
  'workspace:create': 'state:changed',
  'workspace:adopt': 'state:changed',
  'workspace:delete': 'state:changed'
}

export const DESKTOP_ONLY = new Set(['config:open', 'open:ide', 'open:external', 'dialog:pickDirectory', 'clipboard:readText', 'web:info', 'web:regenerateToken'])

function toSessionAgent(agent: Agent, workspace?: { path: string; branch?: string; baseSha?: string }) {
  return { id: agent.id, workspaceId: agent.workspaceId, kindId: agent.kindId, cwd: agent.cwd, worktreePath: workspace?.path ?? agent.worktreePath, worktreeBranch: workspace?.branch ?? agent.worktreeBranch, baseSha: workspace ? workspace.baseSha : agent.baseSha, createdAt: agent.createdAt }
}

export function createHandlers(win: BrowserWindow): Record<string, Handler> {
  return {
    'config:get': () => getConfig(),
    'config:reload': () => reloadConfig(),
    'config:save': (config: Config) => {
      saveConfig(config)
      const next = reloadConfig()
      restartWebServer()
      return next
    },
    'config:open': () => {
      shell.openPath(configPath())
    },
    'agent:spawn': async (req: SpawnRequest, clientId) => {
      const agent = await spawnAgent(req, clientId)
      const state = await loadState()
      saveState({ ...state, agents: [...state.agents, toSessionAgent(agent)] })
      return agent
    },
    'agent:attach': async (req: AttachRequest, clientId) => {
      const cfg = getConfig()
      const kind = cfg.agentKinds.find((k) => k.id === req.kindId)
      if (!kind) throw new Error(`unknown agent kind: ${req.kindId}`)
      const sName = sessionName(req.id, kind.id, req.cwd)
      const attached = await attachPty(clientId, req.id, kind.id, req.cwd)
      if (!attached) {
        const state = await loadState()
        if (state.agents.some((a) => a.id === req.id)) saveState({ ...state, agents: state.agents.filter((a) => a.id !== req.id) })
        return null
      }
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
    },
    'session:load': () => loadSession(),
    'session:save': (agents: SessionAgent[]) => updateAgents(agents),
    'state:load': () => loadState(),
    'project:add': async (req: ProjectAddRequest) => {
      const path = resolve(req.path.replace(/^~(?=$|\/)/, homedir()))
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
    },
    'project:remove': async (p: { projectId: string }) => {
      const state = await loadState()
      const workspaceIds = new Set(state.workspaces.filter((w) => w.projectId === p.projectId).map((w) => w.id))
      if (state.workspaces.some((w) => w.projectId === p.projectId && w.kind === 'worktree')) throw new Error('Delete isolated workspaces first')
      if (state.agents.some((a) => a.workspaceId && workspaceIds.has(a.workspaceId))) throw new Error('Close project terminals first')
      saveState({ ...state, projects: state.projects.filter((x) => x.id !== p.projectId), workspaces: state.workspaces.filter((w) => w.projectId !== p.projectId) })
    },
    'workspace:create': async (req: WorkspaceCreateRequest, clientId) => {
      const state = await loadState()
      const project = state.projects.find((p) => p.id === req.projectId)
      if (!project) throw new Error('Project not found')
      if (!(await repoRoot(project.rootPath))) throw new Error('Worktrees require a Git repository')
      const wt = await createWorktree(project.rootPath, 'workspace', req.name, req.baseBranch)
      const workspace = { id: randomUUID(), projectId: project.id, name: wt.name, kind: 'worktree' as const, path: wt.path, branch: wt.branch, baseSha: wt.baseSha, createdAt: Date.now() }
      saveState({ ...state, workspaces: [...state.workspaces, workspace] })
      try {
        const agent = await spawnAgent({ kindId: req.kindId, cwd: workspace.path, workspaceId: workspace.id }, clientId)
        const next = await loadState()
        saveState({ ...next, agents: [...next.agents, toSessionAgent(agent, workspace)] })
        return { workspace, agent }
      } catch (err) {
        return { workspace, launchError: err instanceof Error ? err.message : String(err) }
      }
    },
    'workspace:adopt': async (req: WorkspaceAdoptRequest, clientId) => {
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
        const agent = await spawnAgent({ kindId: req.kindId, cwd: workspace.path, workspaceId: workspace.id }, clientId)
        const next = await loadState()
        saveState({ ...next, agents: [...next.agents, toSessionAgent(agent, workspace)] })
        return { workspace, agent }
      } catch (err) {
        return { workspace, launchError: err instanceof Error ? err.message : String(err) }
      }
    },
    'workspace:delete': async (req: WorkspaceDeleteRequest) => {
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
    },
    'recent:load': () => loadRecent(),
    'recent:save': (dirs: RecentDir[]) => saveRecent(dirs),
    'agent:worktreeStatus': (p: { path: string; baseSha?: string }) => worktreeStatus(p.path, p.baseSha),
    'agent:kill': async (req: KillRequest) => {
      await killPty(req.agentId)
      const state = await loadState()
      saveState({ ...state, agents: state.agents.filter((a) => a.id !== req.agentId) })
      if (req.worktree) return removeWorktree(req.worktree)
      return { branchKept: false }
    },
    'git:orphanWorktrees': (p: { cwd: string; livePaths: string[] }) => orphanWorktrees(p.cwd, p.livePaths),
    'git:deleteOrphan': async (p: { path: string }) => {
      await removeWorktree({ path: p.path, force: true, deleteBranch: false })
    },
    'diff:get': (p: { cwd: string; ref?: string; full?: boolean; allChanges?: boolean }) => getDiff(p.cwd, p.ref, p.full, p.allChanges),
    'diff:statusHash': (p: { cwd: string }) => statusHash(p.cwd),
    'git:log': (p: { cwd: string; skip?: number }) => gitLog(p.cwd, p.skip),
    'git:summary': (p: { cwd: string }) => gitSummary(p.cwd),
    'git:repoRoot': (p: { cwd: string }) => repoRoot(p.cwd),
    'git:branches': (p: { cwd: string }) => listBranches(p.cwd),
    'git:worktreeBranches': (p: { cwd: string }) => listWorktreeBranches(p.cwd),
    'git:checkout': (p: { cwd: string; branch: string }) => checkoutBranch(p.cwd, p.branch),
    'ports:list': () => listLocalServers(),
    'ports:kill': (p: { pid: number; force: boolean }) => killLocalServer(p.pid, p.force),
    'open:ide': (p: { path: string }) =>
      new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', ['-b', 'com.microsoft.VSCode', p.path], (error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
    'open:external': (p: { url: string }) => shell.openExternal(p.url),
    'dialog:pickDirectory': async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    'clipboard:readText': () => clipboard.readText(),
    'web:info': () => webInfo(),
    'web:regenerateToken': () => regenerateToken()
  }
}

export const senders: Record<string, (arg: any, clientId: string) => void> = {
  'pty:input': (p: { agentId: string; data: string }, clientId) => writePty(clientId, p.agentId, p.data),
  'pty:resize': (p: { agentId: string; cols: number; rows: number }, clientId) => resizePty(clientId, p.agentId, p.cols, p.rows)
}

export async function runHandler(handlers: Record<string, Handler>, channel: string, arg: unknown, clientId: string): Promise<unknown> {
  const handler = handlers[channel]
  if (!handler) throw new Error(`unknown channel: ${channel}`)
  const result = await handler(arg, clientId)
  const event = MUTATIONS[channel]
  if (event) broadcast(event, null, clientId)
  return result
}

export function wireIpc(win: BrowserWindow): Record<string, Handler> {
  const handlers = createHandlers(win)
  for (const channel of Object.keys(handlers)) {
    ipcMain.handle(channel, (_e, arg) => runHandler(handlers, channel, arg, DESKTOP))
  }
  for (const [channel, sender] of Object.entries(senders)) {
    ipcMain.on(channel, (_e, arg) => sender(arg, DESKTOP))
  }
  return handlers
}
