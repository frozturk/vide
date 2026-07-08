import { contextBridge, ipcRenderer } from 'electron'
import type { AttachRequest, Config, KillRequest, RecentDir, SpawnRequest, VideApi } from '../shared/types'

function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api: VideApi = {
  configGet: () => ipcRenderer.invoke('config:get'),
  configReload: () => ipcRenderer.invoke('config:reload'),
  configSave: (config) => ipcRenderer.invoke('config:save', config),
  configOpen: () => ipcRenderer.invoke('config:open'),
  sessionLoad: () => ipcRenderer.invoke('session:load'),
  sessionSave: (agents) => ipcRenderer.invoke('session:save', agents),
  recentDirsLoad: () => ipcRenderer.invoke('recent:load'),
  recentDirsSave: (dirs) => ipcRenderer.invoke('recent:save', dirs),
  agentSpawn: (req: SpawnRequest) => ipcRenderer.invoke('agent:spawn', req),
  agentAttach: (req: AttachRequest) => ipcRenderer.invoke('agent:attach', req),
  worktreeStatus: (path, baseSha) => ipcRenderer.invoke('agent:worktreeStatus', { path, baseSha }),
  agentKill: (req: KillRequest) => ipcRenderer.invoke('agent:kill', req),
  orphanWorktrees: (cwd, livePaths) => ipcRenderer.invoke('git:orphanWorktrees', { cwd, livePaths }),
  deleteOrphanWorktree: (path) => ipcRenderer.invoke('git:deleteOrphan', { path }),
  diffGet: (cwd) => ipcRenderer.invoke('diff:get', { cwd }),
  diffStatusHash: (cwd) => ipcRenderer.invoke('diff:statusHash', { cwd }),
  gitSummary: (cwd) => ipcRenderer.invoke('git:summary', { cwd }),
  openInEditor: (path) => ipcRenderer.invoke('open:editor', { path }),
  browserSetVisible: (visible, focusPage) => ipcRenderer.invoke('browser:setVisible', { visible, focusPage }),
  browserLoadUrl: (url) => ipcRenderer.invoke('browser:loadUrl', { url }),
  browserBack: () => ipcRenderer.invoke('browser:back'),
  browserForward: () => ipcRenderer.invoke('browser:forward'),
  browserReload: () => ipcRenderer.invoke('browser:reload'),
  browserNewTab: () => ipcRenderer.invoke('browser:newTab'),
  browserCloseTab: (id) => ipcRenderer.invoke('browser:closeTab', { id }),
  browserSelectTab: (id) => ipcRenderer.invoke('browser:selectTab', { id }),
  browserOpenUrl: (url) => ipcRenderer.invoke('browser:openUrl', { url }),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  ptyInput: (agentId, data) => ipcRenderer.send('pty:input', { agentId, data }),
  ptyResize: (agentId, cols, rows) => ipcRenderer.send('pty:resize', { agentId, cols, rows }),
  onPtyData: (cb) => sub('pty:data', cb),
  onPtyExit: (cb) => sub('pty:exit', cb),
  onPtyTitle: (cb) => sub('pty:title', cb),
  onBrowserState: (cb) => sub('browser:state', cb),
  onShortcut: (cb) => sub('shortcut', cb)
}

contextBridge.exposeInMainWorld('vide', api)
