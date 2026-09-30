import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from '../shared/api'

function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const api = createApi(
  (channel, arg) => ipcRenderer.invoke(channel, arg),
  (channel, arg) => ipcRenderer.send(channel, arg),
  sub
)

contextBridge.exposeInMainWorld('vide', api)
