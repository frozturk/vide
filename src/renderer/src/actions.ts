import type { Agent, SessionAgent, SpawnRequest } from '../../shared/types'
import { useStore } from './store'
import { activateVisual, createTerminal, disposeTerminal, focusTerminal } from './terminals'

let hoverOpenTimer: ReturnType<typeof setTimeout> | null = null
let hoverCloseTimer: ReturnType<typeof setTimeout> | null = null
let kbTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers(): void {
  if (hoverOpenTimer) clearTimeout(hoverOpenTimer)
  if (hoverCloseTimer) clearTimeout(hoverCloseTimer)
  hoverOpenTimer = null
  hoverCloseTimer = null
}

export function panelHoverEnter(): void {
  clearTimers()
  if (useStore.getState().panel !== 'closed') {
    useStore.setState({ panel: 'hover' })
    return
  }
  hoverOpenTimer = setTimeout(() => useStore.setState({ panel: 'hover' }), 150)
}

export function panelHoverLeave(): void {
  clearTimers()
  hoverCloseTimer = setTimeout(() => {
    if (useStore.getState().panel === 'hover') useStore.setState({ panel: 'closed' })
  }, 300)
}

function panelKeyboardShow(): void {
  if (useStore.getState().panel === 'hover') return
  clearTimers()
  if (kbTimer) {
    clearTimeout(kbTimer)
    kbTimer = null
  }
  useStore.setState({ panel: 'keyboard' })
}

export function panelKeyboardRelease(): void {
  if (kbTimer) clearTimeout(kbTimer)
  kbTimer = setTimeout(() => {
    if (useStore.getState().panel === 'keyboard') useStore.setState({ panel: 'closed' })
  }, 80)
}

export function selectAgent(id: string, via: 'keyboard' | 'click'): void {
  const s = useStore.getState()
  if (!s.agents.some((a) => a.id === id)) return
  const unread = { ...s.unread }
  delete unread[id]
  useStore.setState({ selectedId: id, unread })
  if (via === 'keyboard') panelKeyboardShow()
  activateVisual(id)
}

export function selectSibling(delta: 1 | -1): void {
  const s = useStore.getState()
  if (s.agents.length === 0) return
  const idx = s.agents.findIndex((a) => a.id === s.selectedId)
  const next = s.agents[(idx + delta + s.agents.length) % s.agents.length]
  selectAgent(next.id, 'keyboard')
}

function sortAgents(agents: Agent[]): Agent[] {
  const groupSeen = new Map<string, number>()
  for (const a of agents) {
    const cur = groupSeen.get(a.projectRoot)
    if (cur === undefined || a.createdAt < cur) groupSeen.set(a.projectRoot, a.createdAt)
  }
  return [...agents].sort((x, y) => {
    if (x.projectRoot !== y.projectRoot) {
      const gx = groupSeen.get(x.projectRoot)!
      const gy = groupSeen.get(y.projectRoot)!
      return gx !== gy ? gx - gy : x.projectRoot < y.projectRoot ? -1 : 1
    }
    return y.createdAt - x.createdAt
  })
}

function addAgent(agent: Agent): void {
  const s = useStore.getState()
  const agents = sortAgents([...s.agents, agent])
  const unread = { ...s.unread }
  delete unread[agent.id]
  useStore.setState({
    agents,
    selectedId: agent.id,
    statuses: { ...s.statuses, [agent.id]: 'busy' },
    unread,
    dialog: null
  })
  activateVisual(agent.id)
}

export async function spawnAgent(req: SpawnRequest): Promise<void> {
  const agent = await window.vide.agentSpawn(req)
  createTerminal(agent.id)
  addAgent(agent)
  recordRecentDir(req.cwd)
}

function recordRecentDir(cwd: string): void {
  const s = useStore.getState()
  const now = Date.now()
  const filtered = s.recentDirs.filter((d) => d.path !== cwd)
  const recentDirs = [{ path: cwd, lastUsed: now }, ...filtered].slice(0, 12)
  useStore.setState({ recentDirs })
  void window.vide.recentDirsSave(recentDirs)
}

export async function spawnInDir(cwd: string, kindId?: string): Promise<void> {
  const s = useStore.getState()
  const id = kindId ?? s.config?.agentKinds[0]?.id
  if (!id) return
  await spawnAgent({ kindId: id, cwd })
}

export async function restoreAgent(saved: SessionAgent): Promise<void> {
  const agent = await window.vide.agentAttach({
    id: saved.id,
    kindId: saved.kindId,
    cwd: saved.cwd,
    worktreePath: saved.worktreePath,
    worktreeBranch: saved.worktreeBranch,
    baseSha: saved.baseSha,
    createdAt: saved.createdAt ?? Date.now()
  })
  if (!agent) return
  createTerminal(agent.id)
  addAgent(agent)
  if (saved.title) {
    useStore.setState({ titles: { ...useStore.getState().titles, [agent.id]: saved.title } })
  }
}

export function openSpawnDialog(): void {
  useStore.setState({ dialog: { kind: 'spawn' } })
}

function selectedOf(agents: Agent[], id: string | null): Agent | null {
  return agents.find((a) => a.id === id) ?? null
}

export async function requestClose(): Promise<void> {
  const s = useStore.getState()
  const agent = selectedOf(s.agents, s.selectedId)
  if (!agent) return
  if (!agent.worktreePath) {
    await finalizeKill(agent, undefined)
    return
  }
  try {
    const info = await window.vide.worktreeStatus(agent.worktreePath, agent.baseSha)
    useStore.setState({
      dialog: { kind: 'close', agentId: agent.id, dirty: info.dirty, hasOwnCommits: info.hasOwnCommits }
    })
  } catch {
    useStore.setState({ dialog: { kind: 'close', agentId: agent.id, dirty: true, hasOwnCommits: true } })
  }
}

export async function confirmClose(deleteWorktree: boolean): Promise<void> {
  const s = useStore.getState()
  const d = s.dialog
  if (d?.kind !== 'close') return
  const agent = s.agents.find((a) => a.id === d.agentId)
  if (!agent) {
    useStore.setState({ dialog: null })
    return
  }
  const worktree =
    deleteWorktree && agent.worktreePath
      ? {
          path: agent.worktreePath,
          branch: agent.worktreeBranch ?? '',
          force: d.dirty,
          deleteBranch: !d.hasOwnCommits
        }
      : undefined
  await finalizeKill(agent, worktree)
}

async function finalizeKill(agent: Agent, worktree: Parameters<typeof window.vide.agentKill>[0]['worktree']): Promise<void> {
  try {
    await window.vide.agentKill({ agentId: agent.id, worktree })
  } catch (err) {
    alert(`close failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  disposeTerminal(agent.id)
  const s = useStore.getState()
  const idx = s.agents.findIndex((a) => a.id === agent.id)
  const agents = s.agents.filter((a) => a.id !== agent.id)
  const statuses = { ...s.statuses }
  const unread = { ...s.unread }
  const titles = { ...s.titles }
  delete statuses[agent.id]
  delete unread[agent.id]
  delete titles[agent.id]
  const nextSelected = s.selectedId === agent.id ? (agents[idx] ?? agents[idx - 1] ?? null) : null
  useStore.setState({
    agents,
    statuses,
    unread,
    titles,
    dialog: null,
    selectedId: s.selectedId === agent.id ? (nextSelected?.id ?? null) : s.selectedId
  })
  if (nextSelected) activateVisual(nextSelected.id)
}

export function closeDialog(): void {
  useStore.setState({ dialog: null })
  focusTerminal(useStore.getState().selectedId)
}

export function toggleOverlay(which: 'diff' | 'browser'): void {
  const s = useStore.getState()
  if (s.overlay === which) {
    closeOverlay()
    return
  }
  useStore.setState({ overlay: which })
  if (which === 'browser') void window.vide.browserSetVisible(true, true)
}

export function closeOverlay(): void {
  useStore.setState({ overlay: 'none' })
  focusTerminal(useStore.getState().selectedId)
}

export function focusUrlBar(): void {
  const s = useStore.getState()
  if (s.overlay !== 'browser') useStore.setState({ overlay: 'browser' })
  useStore.setState({ urlFocusSeq: useStore.getState().urlFocusSeq + 1 })
}

export async function reloadConfig(): Promise<void> {
  const config = await window.vide.configReload()
  useStore.setState({ config })
}
