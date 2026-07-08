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
  kindId: string
  title: string
  sessionName: string
  cwd: string
  repoRoot: string | null
  projectRoot: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
}

export interface SessionAgent {
  id: string
  kindId: string
  cwd: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
  title?: string
}

export interface RecentDir {
  path: string
  lastUsed: number
}

export interface Config {
  agentKinds: AgentKind[]
  worktreeBase: string
  defaultBrowserUrl: string
  shell?: string
}

export interface SpawnRequest {
  kindId: string
  cwd: string
  worktreeName?: string
  adoptWorktreePath?: string
}

export interface AttachRequest {
  id: string
  kindId: string
  cwd: string
  worktreePath?: string
  worktreeBranch?: string
  baseSha?: string
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

export interface BrowserState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
}

export interface VideApi {
  configGet(): Promise<Config>
  configReload(): Promise<Config>
  configSave(config: Config): Promise<Config>
  configOpen(): Promise<void>
  sessionLoad(): Promise<SessionAgent[]>
  sessionSave(agents: SessionAgent[]): Promise<void>
  recentDirsLoad(): Promise<RecentDir[]>
  recentDirsSave(dirs: RecentDir[]): Promise<void>
  agentSpawn(req: SpawnRequest): Promise<Agent>
  agentAttach(req: AttachRequest): Promise<Agent | null>
  worktreeStatus(path: string, baseSha?: string): Promise<WorktreeStatus>
  agentKill(req: KillRequest): Promise<{ branchKept: boolean }>
  orphanWorktrees(cwd: string, livePaths: string[]): Promise<OrphanWorktree[]>
  deleteOrphanWorktree(path: string): Promise<void>
  diffGet(cwd: string): Promise<DiffResult>
  diffStatusHash(cwd: string): Promise<string>
  gitSummary(cwd: string): Promise<GitSummary>
  openInEditor(path: string): Promise<void>
  browserSetVisible(visible: boolean, focusPage: boolean): Promise<void>
  browserLoadUrl(url: string): Promise<void>
  browserBack(): Promise<void>
  browserReload(): Promise<void>
  pickDirectory(): Promise<string | null>
  ptyInput(agentId: string, data: string): void
  ptyResize(agentId: string, cols: number, rows: number): void
  onPtyData(cb: (p: { agentId: string; data: string }) => void): () => void
  onPtyExit(cb: (p: { agentId: string; exitCode: number }) => void): () => void
  onPtyTitle(cb: (p: { agentId: string; title: string }) => void): () => void
  onBrowserState(cb: (s: BrowserState) => void): () => void
  onShortcut(cb: (p: { chord: string }) => void): () => void
}
