import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Project, Workspace } from '../../shared/types'
import { createWorkspace, selectSibling, selectWorkspace } from './actions'
import { dispatch } from './shortcuts'
import { useStore } from './store'
import { activateVisual } from './terminals'
import { terminalNavigation, workspaceNavigation, workspaceTerminals } from './workspaceNavigation'

vi.hoisted(() => { vi.stubGlobal('localStorage', { getItem: () => null }) })
vi.mock('./terminals', () => ({
  activateVisual: vi.fn(), clearTerminalSearch: vi.fn(), createTerminal: vi.fn(),
  disposeTerminal: vi.fn(), focusTerminal: vi.fn()
}))

const project = (id: string): Project => ({ id, name: id, rootPath: `/${id}`, createdAt: 0, lastOpenedAt: 0 })
const workspace = (id: string, projectId: string): Workspace => ({
  id, projectId, name: id, kind: 'worktree', path: `/${projectId}/${id}`, createdAt: 0
})
const agent = (id: string, workspaceId: string): Agent => ({
  id, workspaceId, kindId: 'shell', title: id, sessionName: id,
  cwd: '/a', repoRoot: '/a', projectRoot: '/a', createdAt: 0
})

beforeEach(() => {
  vi.clearAllMocks()
  useStore.setState({
    ...useStore.getInitialState(),
    projects: [project('a'), project('b')],
    workspaces: [workspace('a-main', 'a'), workspace('b-main', 'b')],
    agents: [agent('a-terminal', 'a-main'), agent('b-terminal', 'b-main')],
    selectedWorkspaceId: 'a-main', selectedId: 'a-terminal'
  }, true)
})

describe('workspace keyboard navigation', () => {
  it('orders the left bar by workspace, with each workspace matching its terminal tabs and Cmd+S', () => {
    useStore.setState({
      workspaces: [workspace('a-main', 'a'), workspace('b-main', 'b'), workspace('a-new', 'a')],
      agents: [agent('b-terminal', 'b-main'), agent('new-terminal', 'a-new'), agent('a-second', 'a-main'), agent('a-first', 'a-main')]
    })
    const s = useStore.getState()
    const navigation = workspaceNavigation(s.projects, s.workspaces, s.agents)
    expect(terminalNavigation(navigation, s.agents).map((a) => a.id)).toEqual(['a-second', 'a-first', 'new-terminal', 'b-terminal'])
    expect(workspaceTerminals(s.agents, 'a-main').map((a) => a.id)).toEqual(['a-second', 'a-first'])
    selectWorkspace('a-main', 'click')
    expect(useStore.getState().selectedId).toBe('a-second')
    dispatch('next-terminal')
    expect(useStore.getState().selectedId).toBe('a-first')
    dispatch('next-terminal')
    expect(useStore.getState().selectedId).toBe('a-second')
  })

  it('visits terminals needing attention in left-bar order and wraps', () => {
    useStore.setState({
      workspaces: [workspace('a-main', 'a'), workspace('b-main', 'b'), workspace('a-new', 'a')],
      agents: [agent('a-terminal', 'a-main'), agent('b-terminal', 'b-main'), agent('new-terminal', 'a-new')],
      statuses: { 'a-terminal': 'waiting', 'b-terminal': 'busy' },
      unread: { 'new-terminal': true }
    })
    dispatch('next-attention')
    expect(useStore.getState().selectedId).toBe('new-terminal')
    dispatch('next-attention')
    expect(useStore.getState().selectedId).toBe('b-terminal')
    dispatch('next-attention')
    expect(useStore.getState().selectedId).toBe('a-terminal')
  })

  it('visits a newly created workspace beside its project in both directions', async () => {
    vi.stubGlobal('window', { vide: { workspaceCreate: vi.fn().mockResolvedValue({
      workspace: workspace('a-new', 'a'), agent: agent('new-terminal', 'a-new')
    }) } })
    await createWorkspace('a', 'a-new', 'shell')
    selectWorkspace('a-main', 'click')
    dispatch('next')
    expect(useStore.getState().selectedWorkspaceId).toBe('a-new')
    expect(activateVisual).toHaveBeenLastCalledWith('new-terminal')
    dispatch('next')
    expect(useStore.getState().selectedWorkspaceId).toBe('b-main')
    dispatch('prev')
    expect(useStore.getState().selectedWorkspaceId).toBe('a-new')
  })

  it('includes a new visible workspace even when its terminal fails to launch', async () => {
    vi.stubGlobal('window', { vide: { workspaceCreate: vi.fn().mockResolvedValue({
      workspace: workspace('a-empty', 'a'), launchError: 'Launch failed'
    }) } })
    await createWorkspace('a', 'a-empty', 'shell')
    selectWorkspace('a-main', 'click')
    selectSibling(1)
    expect(useStore.getState()).toMatchObject({ selectedWorkspaceId: 'a-empty', selectedId: null })
    selectSibling(1)
    expect(useStore.getState().selectedWorkspaceId).toBe('b-main')
  })

  it('uses the sidebar order for numbered jumps and excludes hidden projects', () => {
    useStore.setState({
      projects: [project('hidden'), project('a'), project('b')],
      workspaces: [workspace('hidden-main', 'hidden'), workspace('a-main', 'a'), workspace('b-main', 'b'), workspace('a-new', 'a')]
    })
    const s = useStore.getState()
    expect(workspaceNavigation(s.projects, s.workspaces, s.agents).map((w) => w.id)).toEqual(['a-main', 'a-new', 'b-main'])
    for (const [index, id] of ['a-main', 'a-new', 'b-main'].entries()) {
      dispatch(`jump-${index + 1}` as 'jump-1' | 'jump-2' | 'jump-3')
      expect(useStore.getState().selectedWorkspaceId).toBe(id)
    }
  })

  it('wraps and handles a missing selection or no visible workspaces', () => {
    selectSibling(-1)
    expect(useStore.getState().selectedWorkspaceId).toBe('b-main')
    selectSibling(1)
    expect(useStore.getState().selectedWorkspaceId).toBe('a-main')
    useStore.setState({ selectedWorkspaceId: null })
    selectSibling(-1)
    expect(useStore.getState().selectedWorkspaceId).toBe('b-main')
    useStore.setState({ selectedWorkspaceId: null })
    selectSibling(1)
    expect(useStore.getState().selectedWorkspaceId).toBe('a-main')
    useStore.setState({ agents: [], selectedWorkspaceId: null })
    selectSibling(1)
    expect(useStore.getState().selectedWorkspaceId).toBeNull()
  })
})
