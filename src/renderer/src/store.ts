import { create } from 'zustand'
import type { Agent, AgentStatus, BrowserState, Config, RecentDir } from '../../shared/types'

export type PanelState = 'closed' | 'hover' | 'keyboard'
export type OverlayState = 'none' | 'diff' | 'browser'

export type DialogState =
  | { kind: 'spawn' }
  | { kind: 'close'; agentId: string; dirty: boolean; hasOwnCommits: boolean }

export interface VideStore {
  config: Config | null
  agents: Agent[]
  selectedId: string | null
  statuses: Record<string, AgentStatus>
  unread: Record<string, boolean>
  titles: Record<string, string>
  titleBusy: Record<string, boolean>
  panel: PanelState
  overlay: OverlayState
  dialog: DialogState | null
  browser: BrowserState
  urlFocusSeq: number
  recentDirs: RecentDir[]
  settingsOpen: boolean
  suppressUnread: boolean
}

export const useStore = create<VideStore>(() => ({
  config: null,
  agents: [],
  selectedId: null,
  statuses: {},
  unread: {},
  titles: {},
  titleBusy: {},
  panel: 'closed',
  overlay: 'none',
  dialog: null,
  browser: { tabs: [], activeId: null },
  urlFocusSeq: 0,
  recentDirs: [],
  settingsOpen: false,
  suppressUnread: false
}))

export function selectedAgent(s: VideStore): Agent | null {
  return s.agents.find((a) => a.id === s.selectedId) ?? null
}

export function kindOf(s: VideStore, agent: Agent) {
  return s.config?.agentKinds.find((k) => k.id === agent.kindId) ?? null
}
