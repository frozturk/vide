import { create } from 'zustand'
import type { Agent, AgentStatus, Config, RecentDir } from '../../shared/types'

export type PanelState = 'closed' | 'hover' | 'keyboard'
export type OverlayState = 'none' | 'diff'

export type DialogState =
  | { kind: 'spawn' }
  | { kind: 'close'; agentId: string; dirty: boolean; hasOwnCommits: boolean }

export interface VideStore {
  booting: boolean
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
  agents: [],
  selectedId: null,
  statuses: {},
  unread: {},
  titles: {},
  titleBusy: {},
  panel: 'closed',
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

export function kindOf(s: VideStore, agent: Agent) {
  return s.config?.agentKinds.find((k) => k.id === agent.kindId) ?? null
}
