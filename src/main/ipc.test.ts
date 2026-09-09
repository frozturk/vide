import { execFileSync } from 'child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../shared/types'
import { wireIpc } from './ipc'
import { spawnPty } from './pty'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  state: { version: 2, projects: [], workspaces: [], agents: [] } as PersistedState
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler), on: vi.fn() },
  clipboard: {}, dialog: {}, shell: {}
}))
vi.mock('./state', () => ({
  loadState: async () => mocks.state,
  saveState: (state: PersistedState) => { mocks.state = state },
  updateAgents: vi.fn()
}))
vi.mock('./config', () => ({
  getConfig: () => ({ agentKinds: [{ id: 'shell', command: '' }], shell: '/bin/zsh' }),
  configPath: vi.fn(), reloadConfig: vi.fn(), saveConfig: vi.fn()
}))
vi.mock('./pty', () => ({
  spawnPty: vi.fn(), sessionName: () => 'test-session', attachPty: vi.fn(),
  killPty: vi.fn(), resizePty: vi.fn(), writePty: vi.fn()
}))

let root: string
const invoke = (name: string, request: unknown) => mocks.handlers.get(name)!(null, request)

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'vide-project-test-')))
  mocks.state = { version: 2, projects: [], workspaces: [], agents: [] }
  vi.clearAllMocks()
  wireIpc({} as BrowserWindow)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('folder projects', () => {
  it.each([
    ['workspace:create', 'feature/base'], ['agent:spawn', 'feature/base'],
    ['workspace:create', 'refs/remotes/origin/base'], ['agent:spawn', 'refs/remotes/origin/base']
  ])('%s creates from %s and preserves the current checkout', async (channel, baseBranch) => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-b', 'main')
    git('config', 'user.email', 'vide@example.test')
    git('config', 'user.name', 'Vide Test')
    git('commit', '--allow-empty', '-m', 'initial')
    const mainSha = git('rev-parse', 'HEAD')
    git('checkout', '-b', 'feature/base')
    git('commit', '--allow-empty', '-m', 'base branch commit')
    const baseSha = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/base', baseSha)
    git('checkout', 'main')
    git('tag', 'feature/base') // A same-named tag must not override the chosen branch.
    const { project } = await invoke('project:add', { path: root })
    const result = await invoke(channel, {
      projectId: project.id, cwd: root, name: 'feature', worktreeName: 'feature',
      kindId: 'shell', baseBranch
    })
    const workspace = channel === 'workspace:create' ? result.workspace : result
    expect(workspace.baseSha).toBe(baseSha)
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace.path ?? workspace.cwd, encoding: 'utf8' }).trim()).toBe(baseSha)
    expect(git('branch', '--show-current')).toBe('main')
    expect(git('rev-parse', 'HEAD')).toBe(mainSha)
  })

  it('opens a non-Git folder, reuses Main, and launches a terminal', async () => {
    const added = await invoke('project:add', { path: root })
    expect(added.workspace).toMatchObject({ kind: 'main', path: root })
    expect(await invoke('project:add', { path: join(root, '.') })).toEqual(added)
    const agent = await invoke('agent:spawn', { kindId: 'shell', cwd: root, workspaceId: added.workspace.id })
    expect(agent).toMatchObject({ cwd: root, repoRoot: null, projectRoot: root, workspaceId: added.workspace.id })
    expect(spawnPty).toHaveBeenCalledWith(agent.id, '/bin/zsh', '', root, 'shell')
    expect(mocks.state.projects).toHaveLength(1)
    expect(mocks.state.agents).toHaveLength(1)
  })

  it('rejects worktree operations for a non-Git folder without adding workspaces', async () => {
    const { project } = await invoke('project:add', { path: root })
    expect(await invoke('git:repoRoot', { cwd: root })).toBeNull()
    await expect(invoke('workspace:create', { projectId: project.id, name: 'feature', kindId: 'shell' })).rejects.toThrow('Worktrees require a Git repository')
    await expect(invoke('workspace:adopt', { projectId: project.id, path: root, kindId: 'shell' })).rejects.toThrow('Worktrees require a Git repository')
    await expect(invoke('agent:spawn', { cwd: root, kindId: 'shell', worktreeName: 'feature' })).rejects.toThrow('Worktrees require a Git repository')
    expect(mocks.state.workspaces).toHaveLength(1)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it('recognizes a repository even before its first commit', async () => {
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
    expect(await invoke('git:repoRoot', { cwd: root })).toBe(root)
    expect((await invoke('project:add', { path: root })).project.rootPath).toBe(root)
  })

  it('does not register a file or missing folder as a project', async () => {
    const file = join(root, 'file.txt')
    writeFileSync(file, 'test')
    await expect(invoke('project:add', { path: file })).rejects.toThrow('Choose a project folder')
    await expect(invoke('project:add', { path: join(root, 'missing') })).rejects.toThrow()
    expect(mocks.state.projects).toHaveLength(0)
  })
})
