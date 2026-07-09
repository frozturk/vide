import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RecentDir, SessionAgent } from '../shared/types'

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

export function loadSession(): SessionAgent[] {
  const file = sessionPath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveSession(agents: SessionAgent[]): void {
  try {
    writeFileSync(sessionPath(), JSON.stringify(agents, null, 2), 'utf8')
  } catch (err) {
    console.error('session save failed', err)
  }
}

export function loadRecent(): RecentDir[] {
  const file = recentPath()
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveRecent(dirs: RecentDir[]): void {
  try {
    writeFileSync(recentPath(), JSON.stringify(dirs, null, 2), 'utf8')
  } catch (err) {
    console.error('recent save failed', err)
  }
}
