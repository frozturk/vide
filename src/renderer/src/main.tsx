import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store'
import { feedData, terminals, refit } from './terminals'
import { dispatch, installKeyboard } from './shortcuts'
import * as actions from './actions'
import { createWebApi } from './webApi'
import { composerFocused, rememberKeyboard } from './keyboard'

function syncViewport(): void {
  const vv = window.visualViewport
  const root = document.documentElement
  let stable = document.body.clientHeight
  let width = window.innerWidth
  const update = (): void => {
    const visible = vv ? vv.height : window.innerHeight
    if (window.innerWidth !== width || visible >= stable - 120) {
      width = window.innerWidth
      stable = document.body.clientHeight
    }
    const keyboard = vv ? Math.max(0, stable - vv.height - vv.offsetTop) : 0
    root.style.setProperty('--vv-h', `${visible}px`)
    if (keyboard > 120) {
      root.style.setProperty('--kb-h', `${keyboard}px`)
      root.classList.add('keyboard-open')
      rememberKeyboard(keyboard)
    } else if (!composerFocused()) {
      root.style.setProperty('--kb-h', '0px')
      root.classList.remove('keyboard-open')
    }
    if (vv && vv.offsetTop > 0) window.scrollTo(0, 0)
  }
  update()
  vv?.addEventListener('resize', update)
  vv?.addEventListener('scroll', update)
  window.addEventListener('resize', update)
}

async function connectWeb(): Promise<void> {
  if (window.vide) return
  const { api, connection, ready } = createWebApi()
  window.vide = api
  useStore.setState({ isWeb: true })
  document.documentElement.classList.add('web')
  if ('serviceWorker' in navigator && !import.meta.env.DEV) void navigator.serviceWorker.register('/sw.js').catch(() => {})
  connection.onClose(() => useStore.setState({ connection: 'reconnecting' }))
  connection.onOpen((reconnected) => {
    useStore.setState({ connection: 'online' })
    if (reconnected) void actions.reattachAll()
  })
  await ready
}

async function bootstrap(): Promise<void> {
  syncViewport()
  await connectWeb()
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
      useStore.setState({ statuses: { ...s.statuses, [agentId]: 'exited' } })
      return
    }
    void window.vide.terminalKill(agentId)
    actions.dropAgent(agentId)
  })

  window.vide.onPtyState(({ agentId, state, activity }) => actions.applyAgentState(agentId, state, activity))

  window.vide.onStateChanged(() => void actions.syncState())
  window.vide.onConfigChanged(() => void actions.reloadConfigFromServer())

  let lastAssert = 0
  const reassertSize = (): void => {
    const id = useStore.getState().selectedId
    if (!id || document.visibilityState !== 'visible' || Date.now() - lastAssert < 1500) return
    lastAssert = Date.now()
    refit(id)
  }
  window.addEventListener('focus', reassertSize)
  document.addEventListener('visibilitychange', reassertSize)
  window.addEventListener('pointerdown', reassertSize, { passive: true })

  window.vide.onPtyTitle(({ agentId, title }) => {
    const cleaned = title.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\s]+/u, '').trim()
    const st = useStore.getState()
    useStore.setState({ titles: { ...st.titles, [agentId]: cleaned } })
  })

  installKeyboard()
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
