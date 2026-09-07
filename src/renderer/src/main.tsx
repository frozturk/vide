import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import { feedData, terminals, disposeTerminal, activateVisual } from './terminals'
import { dispatch, installKeyboard } from './shortcuts'
import { startStatusTicker, SPINNER_GLYPHS } from './status'
import * as actions from './actions'

async function bootstrap(): Promise<void> {
  const config = await window.vide.configGet()
  const recentDirs = await window.vide.recentDirsLoad()
  const persisted = await window.vide.stateLoad()
  useStore.setState({ config, recentDirs, projects: persisted.projects, workspaces: persisted.workspaces })

  window.vide.onPtyData(({ agentId, data }) => feedData(agentId, data))

  window.vide.onPtyExit(({ agentId }) => {
    const s = useStore.getState()
    const agent = s.agents.find((a) => a.id === agentId)
    if (!agent) return
    if (s.workspaces.find((w) => w.id === agent.workspaceId)?.kind === 'worktree') {
      useStore.setState({
        statuses: { ...s.statuses, [agentId]: 'exited' },
        titleBusy: { ...s.titleBusy, [agentId]: false }
      })
      return
    }
    void window.vide.terminalKill(agentId)
    disposeTerminal(agentId)
    const agents = s.agents.filter((a) => a.id !== agentId)
    const statuses = { ...s.statuses }
    const unread = { ...s.unread }
    const titles = { ...s.titles }
    const titleBusy = { ...s.titleBusy }
    delete statuses[agentId]
    delete unread[agentId]
    delete titles[agentId]
    delete titleBusy[agentId]
    const nextSelected = s.selectedId === agentId ? (agents.find((a) => a.workspaceId === agent.workspaceId) ?? null) : null
    useStore.setState({
      agents,
      statuses,
      unread,
      titles,
      titleBusy,
      selectedId: s.selectedId === agentId ? (nextSelected?.id ?? null) : s.selectedId
    })
    if (nextSelected) activateVisual(nextSelected.id)
  })

  window.vide.onPtyTitle(({ agentId, title }) => {
    const busy = SPINNER_GLYPHS.test(title)
    const cleaned = title.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '').trim()
    const st = useStore.getState()
    useStore.setState({
      titles: { ...st.titles, [agentId]: cleaned },
      titleBusy: { ...st.titleBusy, [agentId]: busy }
    })
  })

  installKeyboard()
  startStatusTicker()
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__vide = { useStore, terminals, dispatch, actions }
  }
  createRoot(document.getElementById('root')!).render(<App />)

  const saved = persisted.agents
  const lastSelectedId = localStorage.getItem('lastSelectedId')
  const lastWorkspaceId = localStorage.getItem('lastWorkspaceId')
  useStore.setState({ suppressUnread: true })
  for (const s of saved) {
    if (!s.id) continue
    try {
      await actions.restoreAgent(s)
    } catch (err) {
      console.error('agent restore failed', s, err)
    }
  }
  void window.vide.sessionSave(useStore.getState().agents.map((a) => ({ id: a.id, workspaceId: a.workspaceId, kindId: a.kindId, cwd: a.cwd, createdAt: a.createdAt })))
  if (lastSelectedId && useStore.getState().agents.some((a) => a.id === lastSelectedId)) {
    actions.selectAgent(lastSelectedId, 'click')
  } else if (lastWorkspaceId && persisted.workspaces.some((w) => w.id === lastWorkspaceId)) {
    actions.selectWorkspace(lastWorkspaceId, 'click')
  } else if (persisted.workspaces[0]) {
    actions.selectWorkspace(persisted.workspaces[0].id, 'click')
  }
  requestAnimationFrame(() => useStore.setState({ booting: false }))
  setTimeout(() => useStore.setState({ suppressUnread: false }), 3000)
  useStore.subscribe((state, prev) => {
    if (state.selectedId !== prev.selectedId && state.selectedId) {
      localStorage.setItem('lastSelectedId', state.selectedId)
    }
  })
  useStore.subscribe((state, prev) => {
    if (state.selectedWorkspaceId !== prev.selectedWorkspaceId && state.selectedWorkspaceId) localStorage.setItem('lastWorkspaceId', state.selectedWorkspaceId)
  })
  useStore.subscribe((state, prev) => {
    if (state.agents === prev.agents && state.titles === prev.titles) return
    void window.vide.sessionSave(
      state.agents.map((a) => {
        const workspace = state.workspaces.find((w) => w.id === a.workspaceId)
        return {
          id: a.id,
          workspaceId: a.workspaceId,
          kindId: a.kindId,
          cwd: a.cwd,
          worktreePath: workspace?.kind === 'worktree' ? workspace.path : undefined,
          worktreeBranch: workspace?.branch,
          baseSha: workspace?.baseSha,
          title: state.titles[a.id],
          createdAt: a.createdAt
        }
      })
    )
  })
}

void bootstrap()
