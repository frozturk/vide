import type { VideApi } from './types'

export type Invoke = (channel: string, arg?: unknown) => Promise<any>
export type Send = (channel: string, arg: unknown) => void
export type Subscribe = (channel: string, cb: (payload: any) => void) => () => void

export function createApi(invoke: Invoke, send: Send, on: Subscribe): VideApi {
  return {
    configGet: () => invoke('config:get'),
    configReload: () => invoke('config:reload'),
    configSave: (config) => invoke('config:save', config),
    configOpen: () => invoke('config:open'),
    sessionLoad: () => invoke('session:load'),
    sessionSave: (agents) => invoke('session:save', agents),
    stateLoad: () => invoke('state:load'),
    projectAdd: (req) => invoke('project:add', req),
    projectRemove: (projectId) => invoke('project:remove', { projectId }),
    workspaceCreate: (req) => invoke('workspace:create', req),
    workspaceAdopt: (req) => invoke('workspace:adopt', req),
    workspaceDelete: (req) => invoke('workspace:delete', req),
    recentDirsLoad: () => invoke('recent:load'),
    recentDirsSave: (dirs) => invoke('recent:save', dirs),
    agentSpawn: (req) => invoke('agent:spawn', req),
    agentAttach: (req) => invoke('agent:attach', req),
    terminalSpawn: (req) => invoke('agent:spawn', req),
    terminalAttach: (req) => invoke('agent:attach', req),
    worktreeStatus: (path, baseSha) => invoke('agent:worktreeStatus', { path, baseSha }),
    agentKill: (req) => invoke('agent:kill', req),
    terminalKill: (agentId) => invoke('agent:kill', { agentId }).then(() => undefined),
    orphanWorktrees: (cwd, livePaths) => invoke('git:orphanWorktrees', { cwd, livePaths }),
    deleteOrphanWorktree: (path) => invoke('git:deleteOrphan', { path }),
    diffGet: (cwd, ref, full, allChanges) => invoke('diff:get', { cwd, ref, full, allChanges }),
    diffStatusHash: (cwd) => invoke('diff:statusHash', { cwd }),
    gitLog: (cwd, skip) => invoke('git:log', { cwd, skip }),
    gitSummary: (cwd) => invoke('git:summary', { cwd }),
    gitRepoRoot: (cwd) => invoke('git:repoRoot', { cwd }),
    gitBranches: (cwd) => invoke('git:branches', { cwd }),
    gitWorktreeBranches: (cwd) => invoke('git:worktreeBranches', { cwd }),
    gitCheckout: (cwd, branch) => invoke('git:checkout', { cwd, branch }),
    localServers: () => invoke('ports:list'),
    localServerKill: (pid, force) => invoke('ports:kill', { pid, force }),
    openInIde: (path) => invoke('open:ide', { path }),
    openExternal: (url) => invoke('open:external', { url }),
    pickDirectory: () => invoke('dialog:pickDirectory'),
    clipboardReadText: () => invoke('clipboard:readText'),
    ptyInput: (agentId, data) => send('pty:input', { agentId, data }),
    ptyResize: (agentId, cols, rows) => send('pty:resize', { agentId, cols, rows }),
    onPtyData: (cb) => on('pty:data', cb),
    onPtyExit: (cb) => on('pty:exit', cb),
    onPtyTitle: (cb) => on('pty:title', cb),
    onPtyState: (cb) => on('pty:state', cb),
    onStateChanged: (cb) => on('state:changed', cb),
    onConfigChanged: (cb) => on('config:changed', cb),
    webInfo: () => invoke('web:info'),
    webRevokeDevice: (id) => invoke('web:revokeDevice', { id })
  }
}
