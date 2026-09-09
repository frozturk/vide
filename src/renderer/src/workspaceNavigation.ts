import type { Agent, Project, Workspace } from '../../shared/types'

export function workspaceNavigation(projects: Project[], workspaces: Workspace[], agents: Agent[]): Workspace[] {
  const activeWorkspaceIds = new Set(agents.map((agent) => agent.workspaceId))
  const visibleProjectIds = new Set(workspaces.filter((workspace) => activeWorkspaceIds.has(workspace.id)).map((workspace) => workspace.projectId))
  return projects.filter((project) => visibleProjectIds.has(project.id))
    .flatMap((project) => workspaces.filter((workspace) => workspace.projectId === project.id))
}

export function workspaceTerminals(agents: Agent[], workspaceId: string | null): Agent[] {
  return agents.filter((agent) => agent.workspaceId === workspaceId)
}

export function terminalNavigation(workspaces: Workspace[], agents: Agent[]): Agent[] {
  return workspaces.flatMap((workspace) => workspaceTerminals(agents, workspace.id))
}
