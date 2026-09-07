import { create } from 'zustand'
import type { Agent, AgentStatus, Config, Project, RecentDir, Workspace } from '../../shared/types'
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, PANEL_WIDTH } from '../../shared/layout'

export type PanelState = 'closed' | 'hover' | 'keyboard'
export type OverlayState = 'none' | 'diff'

export type DialogState =
  | { kind: 'spawn' }
  | { kind: 'new-workspace' }
  | { kind: 'add-terminal' }
  | { kind: 'delete-workspace'; workspaceId: string; dirty: boolean; hasOwnCommits: boolean }

export interface VideStore {
  booting: boolean
  config: Config | null
  projects: Project[]
  workspaces: Workspace[]
  agents: Agent[]
  selectedWorkspaceId: string | null
  selectedId: string | null
  statuses: Record<string, AgentStatus>
  unread: Record<string, boolean>
  titles: Record<string, string>
  titleBusy: Record<string, boolean>
  panel: PanelState
  panelPinned: boolean
  panelWidth: number
  overlay: OverlayState
  dialog: DialogState | null
  recentDirs: RecentDir[]
  settingsOpen: boolean
  suppressUnread: boolean
  paletteOpen: boolean
  searchOpen: boolean
  searchSeq: number
}

export const useStore = create<VideStore>(() => ({
  booting: true,
  config: null,
  projects: [],
  workspaces: [],
  agents: [],
  selectedWorkspaceId: null,
  selectedId: null,
  statuses: {},
  unread: {},
  titles: {},
  titleBusy: {},
  panel: 'closed',
  panelPinned: localStorage.getItem('panelPinned') === '1',
  panelWidth: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Number(localStorage.getItem('panelWidth')) || PANEL_WIDTH)),
  overlay: 'none',
  dialog: null,
  recentDirs: [],
  settingsOpen: false,
  suppressUnread: false,
  paletteOpen: false,
  searchOpen: false,
  searchSeq: 0
}))

export function selectedAgent(s: VideStore): Agent | null {
  return s.agents.find((a) => a.id === s.selectedId) ?? null
}

export function selectedWorkspace(s: VideStore): Workspace | null {
  return s.workspaces.find((w) => w.id === s.selectedWorkspaceId) ?? null
}

export function selectedProject(s: VideStore): Project | null {
  const workspace = selectedWorkspace(s)
  return workspace ? s.projects.find((p) => p.id === workspace.projectId) ?? null : null
}

export function kindOf(s: VideStore, agent: Agent) {
  return s.config?.agentKinds.find((k) => k.id === agent.kindId) ?? null
}
