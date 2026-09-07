import { describe, expect, it } from 'vitest'
import type { SessionAgent } from '../shared/types'
import { migrateLegacySessions } from './state'

describe('legacy state migration', () => {
  it('groups repositories, creates Main, and shares a worktree workspace', async () => {
    const sessions: SessionAgent[] = [
      { id: 'main-a', kindId: 'shell', cwd: '/repos/app', createdAt: 1 },
      { id: 'wt-a', kindId: 'codex', cwd: '/repos/app/.vide/worktrees/auth', worktreePath: '/repos/app/.vide/worktrees/auth', worktreeBranch: 'vide/auth', createdAt: 2 },
      { id: 'wt-b', kindId: 'claude', cwd: '/repos/app/.vide/worktrees/auth', worktreePath: '/repos/app/.vide/worktrees/auth', worktreeBranch: 'vide/auth', createdAt: 3 },
      { id: 'other', kindId: 'shell', cwd: '/repos/other', createdAt: 4 }
    ]
    const state = await migrateLegacySessions(sessions, async (cwd) => cwd.includes('/app') ? '/repos/app' : '/repos/other')
    expect(state.version).toBe(2)
    expect(state.projects).toHaveLength(2)
    expect(state.workspaces.filter((w) => w.kind === 'main')).toHaveLength(2)
    expect(state.workspaces.filter((w) => w.kind === 'worktree')).toHaveLength(1)
    expect(state.agents.find((a) => a.id === 'wt-a')?.workspaceId).toBe(state.agents.find((a) => a.id === 'wt-b')?.workspaceId)
    expect(state.agents.find((a) => a.id === 'main-a')?.id).toBe('main-a')
  })

  it('returns an empty v2 state for an empty legacy session', async () => {
    expect(await migrateLegacySessions([])).toEqual({ version: 2, projects: [], workspaces: [], agents: [] })
  })
})
