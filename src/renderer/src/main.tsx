import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import { feedData, terminals, disposeTerminal, activateVisual } from './terminals'
import { dispatch, installKeyboard } from './shortcuts'
import { startStatusTicker, SPINNER_GLYPHS } from './status'
import * as actions from './actions'
import type { ChordId } from '../../shared/chords'

async function bootstrap(): Promise<void> {
  const config = await window.vide.configGet()
  const recentDirs = await window.vide.recentDirsLoad()
  useStore.setState({ config, recentDirs })

  window.vide.onPtyData(({ agentId, data }) => feedData(agentId, data))

  window.vide.onPtyExit(({ agentId }) => {
    const s = useStore.getState()
    const agent = s.agents.find((a) => a.id === agentId)
    if (!agent) return
    void window.vide.agentKill({ agentId })
    disposeTerminal(agentId)
    const idx = s.agents.findIndex((a) => a.id === agentId)
    const agents = s.agents.filter((a) => a.id !== agentId)
    const statuses = { ...s.statuses }
    const unread = { ...s.unread }
    const titles = { ...s.titles }
    const titleBusy = { ...s.titleBusy }
    delete statuses[agentId]
    delete unread[agentId]
    delete titles[agentId]
    delete titleBusy[agentId]
    const nextSelected = s.selectedId === agentId ? (agents[idx] ?? agents[idx - 1] ?? null) : null
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

  window.vide.onBrowserState((browser) => useStore.setState({ browser }))
  window.vide.onShortcut(({ chord }) => dispatch(chord as ChordId))

  installKeyboard()
  startStatusTicker()
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__vide = { useStore, terminals, dispatch, actions }
  }
  createRoot(document.getElementById('root')!).render(<App />)

  const saved = await window.vide.sessionLoad()
  const lastSelectedId = localStorage.getItem('lastSelectedId')
  useStore.setState({ suppressUnread: true })
  for (const s of saved) {
    if (!s.id) continue
    try {
      await actions.restoreAgent(s)
    } catch (err) {
      console.error('agent restore failed', s, err)
    }
  }
  if (lastSelectedId && useStore.getState().agents.some((a) => a.id === lastSelectedId)) {
    actions.selectAgent(lastSelectedId, 'click')
  }
  setTimeout(() => useStore.setState({ suppressUnread: false }), 3000)
  useStore.subscribe((state, prev) => {
    if (state.selectedId !== prev.selectedId && state.selectedId) {
      localStorage.setItem('lastSelectedId', state.selectedId)
    }
  })
  useStore.subscribe((state, prev) => {
    if (state.agents === prev.agents && state.titles === prev.titles) return
    void window.vide.sessionSave(
      state.agents.map((a) => ({
        id: a.id,
        kindId: a.kindId,
        cwd: a.cwd,
        worktreePath: a.worktreePath,
        worktreeBranch: a.worktreeBranch,
        baseSha: a.baseSha,
        title: state.titles[a.id],
        createdAt: a.createdAt
      }))
    )
  })
}

void bootstrap()
