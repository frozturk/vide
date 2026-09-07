import type { Agent, SessionAgent, SpawnRequest } from '../../shared/types'
import { useStore } from './store'
import { activateVisual, clearTerminalSearch, createTerminal, disposeTerminal, focusTerminal } from './terminals'

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

export function togglePanelPinned(): void {
  const pinned = !useStore.getState().panelPinned
  localStorage.setItem('panelPinned', pinned ? '1' : '0')
  useStore.setState({ panelPinned: pinned })
}

export function panelKeyboardRelease(): void {
  if (kbTimer) clearTimeout(kbTimer)
  kbTimer = setTimeout(() => {
    if (useStore.getState().panel === 'keyboard') useStore.setState({ panel: 'closed' })
  }, 80)
}

export function selectAgent(id: string, via: 'keyboard' | 'click'): void {
  const s = useStore.getState()
  const agent = s.agents.find((a) => a.id === id)
  if (!agent) return
  const unread = { ...s.unread }
  delete unread[id]
  useStore.setState({ selectedId: id, selectedWorkspaceId: agent.workspaceId, unread })
  if (via === 'keyboard') panelKeyboardShow()
  activateVisual(id)
}

export function selectWorkspace(id: string, via: 'keyboard' | 'click'): void {
  const s = useStore.getState()
  if (!s.workspaces.some((w) => w.id === id)) return
  const agents = s.agents.filter((a) => a.workspaceId === id)
  const selected = agents.find((a) => a.id === s.selectedId) ?? agents[0] ?? null
  useStore.setState({ selectedWorkspaceId: id, selectedId: selected?.id ?? null })
  if (via === 'keyboard') panelKeyboardShow()
  if (selected) activateVisual(selected.id)
}

export function selectSibling(delta: 1 | -1): void {
  const s = useStore.getState()
  if (s.workspaces.length === 0) return
  const idx = s.workspaces.findIndex((w) => w.id === s.selectedWorkspaceId)
  const next = s.workspaces[(idx + delta + s.workspaces.length) % s.workspaces.length]
  selectWorkspace(next.id, 'keyboard')
}

export function selectTerminalSibling(delta: 1 | -1): void {
  const s = useStore.getState()
  const agents = s.agents.filter((a) => a.workspaceId === s.selectedWorkspaceId)
  if (agents.length < 2) return
  const idx = agents.findIndex((a) => a.id === s.selectedId)
  selectAgent(agents[(idx + delta + agents.length) % agents.length].id, 'click')
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
    selectedWorkspaceId: agent.workspaceId,
    statuses: { ...s.statuses, [agent.id]: 'busy' },
    unread,
    dialog: null
  })
  activateVisual(agent.id)
}

export async function spawnAgent(req: SpawnRequest): Promise<void> {
  const agent = await window.vide.terminalSpawn(req)
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
  const added = await window.vide.projectAdd({ path: cwd })
  const state = useStore.getState()
  if (!state.projects.some((p) => p.id === added.project.id)) {
    useStore.setState({ projects: [...state.projects, added.project], workspaces: [...state.workspaces, added.workspace] })
  }
  await spawnAgent({ kindId: id, cwd: added.workspace.path, workspaceId: added.workspace.id })
}

export async function restoreAgent(saved: SessionAgent): Promise<void> {
  const agent = await window.vide.terminalAttach({
    id: saved.id,
    workspaceId: saved.workspaceId,
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

export function openNewWorkspaceDialog(): void {
  useStore.setState({ dialog: { kind: 'new-workspace' } })
}

export function openSpawnDialog(): void {
  useStore.setState({ dialog: { kind: 'spawn' } })
}

export function openAddTerminalDialog(): void {
  const s = useStore.getState()
  if (s.selectedWorkspaceId) useStore.setState({ dialog: { kind: 'add-terminal' } })
  else useStore.setState({ dialog: { kind: 'new-workspace' } })
}

export async function createWorkspace(projectId: string, name: string, kindId: string): Promise<string | null> {
  const result = await window.vide.workspaceCreate({ projectId, name, kindId })
  const s = useStore.getState()
  useStore.setState({ workspaces: [...s.workspaces, result.workspace], selectedWorkspaceId: result.workspace.id, dialog: null })
  if (result.agent) {
    createTerminal(result.agent.id)
    addAgent(result.agent)
  }
  return result.launchError ?? null
}

export async function adoptWorkspace(projectId: string, path: string, kindId: string): Promise<string | null> {
  const result = await window.vide.workspaceAdopt({ projectId, path, kindId })
  const s = useStore.getState()
  useStore.setState({ workspaces: [...s.workspaces, result.workspace], selectedWorkspaceId: result.workspace.id, dialog: null })
  if (result.agent) {
    createTerminal(result.agent.id)
    addAgent(result.agent)
  }
  return result.launchError ?? null
}

export async function removeCurrentProject(): Promise<void> {
  const s = useStore.getState()
  const workspace = s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  const project = workspace ? s.projects.find((p) => p.id === workspace.projectId) : null
  if (!project || !confirm(`Remove ${project.name} from Vide? Files on disk will not be changed.`)) return
  try {
    await window.vide.projectRemove(project.id)
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err))
    return
  }
  const projects = s.projects.filter((p) => p.id !== project.id)
  const workspaces = s.workspaces.filter((w) => w.projectId !== project.id)
  const next = workspaces[0] ?? null
  useStore.setState({ projects, workspaces, selectedWorkspaceId: next?.id ?? null, selectedId: s.agents.find((a) => a.workspaceId === next?.id)?.id ?? null })
}

export async function addTerminal(kindId: string): Promise<void> {
  const s = useStore.getState()
  const workspace = s.workspaces.find((w) => w.id === s.selectedWorkspaceId)
  if (!workspace) return
  await spawnAgent({ kindId, cwd: workspace.path, workspaceId: workspace.id })
}

export async function spawnFromDialog(kindId: string, cwd: string, worktreeName?: string, adoptPath?: string): Promise<void> {
  const added = await window.vide.projectAdd({ path: cwd })
  let s = useStore.getState()
  if (!s.projects.some((p) => p.id === added.project.id)) {
    useStore.setState({ projects: [...s.projects, added.project], workspaces: [...s.workspaces, added.workspace] })
    s = useStore.getState()
  }
  if (adoptPath) {
    const error = await adoptWorkspace(added.project.id, adoptPath, kindId)
    if (error) alert(`Workspace adopted, but the agent failed to launch: ${error}`)
  } else if (worktreeName?.trim()) {
    const error = await createWorkspace(added.project.id, worktreeName.trim(), kindId)
    if (error) alert(`Workspace created, but the agent failed to launch: ${error}`)
  } else {
    const workspace = s.workspaces.find((w) => w.path === cwd) ?? added.workspace
    await spawnAgent({ kindId, cwd: workspace.path, workspaceId: workspace.id })
  }
  recordRecentDir(added.project.rootPath)
}

function selectedOf(agents: Agent[], id: string | null): Agent | null {
  return agents.find((a) => a.id === id) ?? null
}

export async function requestClose(): Promise<void> {
  const s = useStore.getState()
  const agent = selectedOf(s.agents, s.selectedId)
  if (!agent) return
  await finalizeKill(agent, undefined)
}

export async function requestDeleteWorkspace(workspaceId?: string): Promise<void> {
  const s = useStore.getState()
  const workspace = s.workspaces.find((w) => w.id === (workspaceId ?? s.selectedWorkspaceId))
  if (!workspace || workspace.kind === 'main') return
  try {
    const info = await window.vide.worktreeStatus(workspace.path, workspace.baseSha)
    useStore.setState({ dialog: { kind: 'delete-workspace', workspaceId: workspace.id, ...info } })
  } catch {
    useStore.setState({ dialog: { kind: 'delete-workspace', workspaceId: workspace.id, dirty: true, hasOwnCommits: true } })
  }
}

export async function confirmDeleteWorkspace(force: boolean, deleteBranch: boolean): Promise<void> {
  const s = useStore.getState()
  const d = s.dialog
  if (d?.kind !== 'delete-workspace') return
  await window.vide.workspaceDelete({ workspaceId: d.workspaceId, force, deleteBranch })
  const removedAgents = s.agents.filter((a) => a.workspaceId === d.workspaceId)
  for (const agent of removedAgents) disposeTerminal(agent.id)
  const workspaces = s.workspaces.filter((w) => w.id !== d.workspaceId)
  const agents = s.agents.filter((a) => a.workspaceId !== d.workspaceId)
  const next = workspaces.find((w) => w.projectId === s.workspaces.find((x) => x.id === d.workspaceId)?.projectId) ?? workspaces[0] ?? null
  useStore.setState({ workspaces, agents, selectedWorkspaceId: next?.id ?? null, selectedId: agents.find((a) => a.workspaceId === next?.id)?.id ?? null, dialog: null })
}

async function finalizeKill(agent: Agent, worktree: Parameters<typeof window.vide.agentKill>[0]['worktree']): Promise<void> {
  try {
    if (worktree) await window.vide.agentKill({ agentId: agent.id, worktree })
    else await window.vide.terminalKill(agent.id)
  } catch (err) {
    alert(`close failed: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  disposeTerminal(agent.id)
  const s = useStore.getState()
  const agents = s.agents.filter((a) => a.id !== agent.id)
  const statuses = { ...s.statuses }
  const unread = { ...s.unread }
  const titles = { ...s.titles }
  const titleBusy = { ...s.titleBusy }
  delete statuses[agent.id]
  delete unread[agent.id]
  delete titles[agent.id]
  delete titleBusy[agent.id]
  const sameWorkspace = agents.filter((a) => a.workspaceId === agent.workspaceId)
  const nextSelected = s.selectedId === agent.id ? (sameWorkspace[0] ?? null) : null
  useStore.setState({
    agents,
    statuses,
    unread,
    titles,
    titleBusy,
    dialog: null,
    selectedId: s.selectedId === agent.id ? (nextSelected?.id ?? null) : s.selectedId
  })
  if (nextSelected) activateVisual(nextSelected.id)
}

export function closeDialog(): void {
  useStore.setState({ dialog: null })
  focusTerminal(useStore.getState().selectedId)
}

export function toggleOverlay(which: 'diff'): void {
  const s = useStore.getState()
  if (s.overlay === which) {
    closeOverlay()
    return
  }
  useStore.setState({ overlay: which })
}

export function closeOverlay(): void {
  useStore.setState({ overlay: 'none' })
  focusTerminal(useStore.getState().selectedId)
}

export async function reloadConfig(): Promise<void> {
  const config = await window.vide.configReload()
  useStore.setState({ config })
}

export function togglePalette(): void {
  const s = useStore.getState()
  if (s.paletteOpen) closePalette()
  else useStore.setState({ paletteOpen: true })
}

export function closePalette(): void {
  useStore.setState({ paletteOpen: false })
  focusTerminal(useStore.getState().selectedId)
}

export function openSearch(): void {
  const s = useStore.getState()
  if (!s.selectedId) return
  useStore.setState({ searchOpen: true, searchSeq: s.searchSeq + 1 })
}

export function closeSearch(): void {
  const s = useStore.getState()
  if (s.selectedId) clearTerminalSearch(s.selectedId)
  useStore.setState({ searchOpen: false })
  focusTerminal(s.selectedId)
}
