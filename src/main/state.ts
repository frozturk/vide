import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'
import type { PersistedState, Project, SessionAgent, Workspace } from '../shared/types'
import { currentBranch, projectRootOf } from './git'
import { loadSession } from './session'
import { runtimeStateFile } from './runtime'

const EMPTY_STATE: PersistedState = { version: 2, projects: [], workspaces: [], agents: [] }
let current: PersistedState | null = null

function statePath(): string {
  return join(app.getPath('userData'), runtimeStateFile('state'))
}

function writeState(state: PersistedState): void {
  const path = statePath()
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, path)
}

function validState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PersistedState>
  return v.version === 2 && Array.isArray(v.projects) && Array.isArray(v.workspaces) && Array.isArray(v.agents)
}

export async function migrateLegacySessions(
  legacy: SessionAgent[],
  rootOf: (cwd: string) => Promise<string> = projectRootOf,
  branchOf: (cwd: string) => Promise<string | null> = currentBranch
): Promise<PersistedState> {
  if (legacy.length === 0) return { ...EMPTY_STATE }
  const now = Date.now()
  const projects: Project[] = []
  const workspaces: Workspace[] = []
  const agents: SessionAgent[] = []
  const projectByRoot = new Map<string, Project>()
  const mainByProject = new Map<string, Workspace>()
  const worktreeByPath = new Map<string, Workspace>()

  for (const saved of legacy) {
    if (!saved.id || !saved.cwd) continue
    const root = resolve(await rootOf(saved.cwd).catch(() => saved.cwd))
    let project = projectByRoot.get(root)
    if (!project) {
      project = { id: randomUUID(), name: basename(root), rootPath: root, createdAt: now, lastOpenedAt: now }
      projects.push(project)
      projectByRoot.set(root, project)
      const main: Workspace = {
        id: randomUUID(), projectId: project.id, name: 'Main', kind: 'main', path: root, createdAt: now
      }
      workspaces.push(main)
      mainByProject.set(project.id, main)
    }

    let workspace: Workspace
    if (saved.worktreePath) {
      const path = resolve(saved.worktreePath)
      workspace = worktreeByPath.get(path) ?? {
        id: randomUUID(),
        projectId: project.id,
        name: basename(path),
        kind: 'worktree',
        path,
        branch: saved.worktreeBranch ?? (await branchOf(path).catch(() => null)) ?? undefined,
        baseSha: saved.baseSha,
        createdAt: saved.createdAt ?? now
      }
      if (!worktreeByPath.has(path)) {
        worktreeByPath.set(path, workspace)
        workspaces.push(workspace)
      }
    } else {
      workspace = mainByProject.get(project.id)!
    }
    agents.push({ ...saved, workspaceId: workspace.id })
  }
  return { version: 2, projects, workspaces, agents }
}

async function migrateLegacy(): Promise<PersistedState> {
  return migrateLegacySessions(loadSession())
}

export async function loadState(): Promise<PersistedState> {
  if (current) return current
  const path = statePath()
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (validState(parsed)) {
        current = parsed
        return current
      }
    } catch (err) {
      console.error('state load failed, migrating legacy state', err)
    }
  }
  current = await migrateLegacy()
  writeState(current)
  return current
}

export function saveState(state: PersistedState): PersistedState {
  current = state
  writeState(state)
  return state
}

export async function updateAgents(agents: SessionAgent[]): Promise<void> {
  const state = await loadState()
  saveState({ ...state, agents })
}
