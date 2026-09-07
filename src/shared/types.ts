export type AgentStatus = 'busy' | 'waiting' | 'idle' | 'exited'

export interface AgentKind {
  id: string
  name: string
  command: string
  color: string
  busyRegex?: string
  waitingRegex?: string
}

export interface Agent {
  id: string
  workspaceId: string
  kindId: string
  title: string
  sessionName: string
  cwd: string
  repoRoot: string | null
  projectRoot: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
  createdAt: number
}

export interface SessionAgent {
  id: string
  workspaceId?: string
  kindId: string
  cwd: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
  title?: string
  createdAt?: number
}

export interface Project {
  id: string
  name: string
  rootPath: string
  createdAt: number
  lastOpenedAt: number
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  kind: 'main' | 'worktree'
  path: string
  branch?: string
  baseSha?: string
  createdAt: number
}

export interface PersistedState {
  version: 2
  projects: Project[]
  workspaces: Workspace[]
  agents: SessionAgent[]
}

export interface RecentDir {
  path: string
  lastUsed: number
}

export interface Config {
  agentKinds: AgentKind[]
  worktreeBase: string
  shell?: string
}

export interface SpawnRequest {
  kindId: string
  cwd: string
  workspaceId?: string
  worktreeName?: string
  adoptWorktreePath?: string
}

export interface AttachRequest {
  id: string
  workspaceId?: string
  kindId: string
  cwd: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
  createdAt: number
}

export interface ProjectAddRequest {
  path: string
}

export interface WorkspaceCreateRequest {
  projectId: string
  name: string
  kindId: string
}

export interface WorkspaceAdoptRequest {
  projectId: string
  path: string
  kindId: string
}

export interface WorkspaceDeleteRequest {
  workspaceId: string
  force: boolean
  deleteBranch: boolean
}

export interface WorktreeStatus {
  dirty: boolean
  hasOwnCommits: boolean
}

export interface GitSummary {
  branch: string | null
  dirty: boolean
  ahead: number
  behind: number
  modified: number
  staged: number
  untracked: number
}

export interface KillRequest {
  agentId: string
  worktree?: {
    path: string
    branch: string
    force: boolean
    deleteBranch: boolean
  }
}

export interface OrphanWorktree {
  path: string
  branch: string
}

export type DiffFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface DiffFile {
  path: string
  status: DiffFileStatus
  hunks: string
}

export type DiffResult =
  | { kind: 'no-repo' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; files: DiffFile[]; truncated: number }

export interface GitCommit {
  sha: string
  short: string
  author: string
  date: string
  subject: string
}

export interface VideApi {
  configGet(): Promise<Config>
  configReload(): Promise<Config>
  configSave(config: Config): Promise<Config>
  configOpen(): Promise<void>
  sessionLoad(): Promise<SessionAgent[]>
  sessionSave(agents: SessionAgent[]): Promise<void>
  stateLoad(): Promise<PersistedState>
  projectAdd(req: ProjectAddRequest): Promise<{ project: Project; workspace: Workspace }>
  projectRemove(projectId: string): Promise<void>
  workspaceCreate(req: WorkspaceCreateRequest): Promise<{ workspace: Workspace; agent?: Agent; launchError?: string }>
  workspaceAdopt(req: WorkspaceAdoptRequest): Promise<{ workspace: Workspace; agent?: Agent; launchError?: string }>
  workspaceDelete(req: WorkspaceDeleteRequest): Promise<{ branchKept: boolean }>
  recentDirsLoad(): Promise<RecentDir[]>
  recentDirsSave(dirs: RecentDir[]): Promise<void>
  agentSpawn(req: SpawnRequest): Promise<Agent>
  agentAttach(req: AttachRequest): Promise<Agent | null>
  terminalSpawn(req: SpawnRequest): Promise<Agent>
  terminalAttach(req: AttachRequest): Promise<Agent | null>
  worktreeStatus(path: string, baseSha?: string): Promise<WorktreeStatus>
  agentKill(req: KillRequest): Promise<{ branchKept: boolean }>
  terminalKill(agentId: string): Promise<void>
  orphanWorktrees(cwd: string, livePaths: string[]): Promise<OrphanWorktree[]>
  deleteOrphanWorktree(path: string): Promise<void>
  diffGet(cwd: string, ref?: string, full?: boolean, allChanges?: boolean): Promise<DiffResult>
  diffStatusHash(cwd: string): Promise<string>
  gitLog(cwd: string, skip?: number): Promise<GitCommit[]>
  gitSummary(cwd: string): Promise<GitSummary>
  gitBranches(cwd: string): Promise<string[]>
  gitCheckout(cwd: string, branch: string): Promise<{ ok: boolean; error?: string }>
  openInIde(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  pickDirectory(): Promise<string | null>
  clipboardReadText(): Promise<string>
  ptyInput(agentId: string, data: string): void
  ptyResize(agentId: string, cols: number, rows: number): void
  onPtyData(cb: (p: { agentId: string; data: string }) => void): () => void
  onPtyExit(cb: (p: { agentId: string; exitCode: number }) => void): () => void
  onPtyTitle(cb: (p: { agentId: string; title: string }) => void): () => void
}
