export type Sink = (channel: string, payload: unknown) => void

export const DESKTOP = 'desktop'

const sinks = new Map<string, Sink>()

export function registerClient(id: string, sink: Sink): void {
  sinks.set(id, sink)
}

export function unregisterClient(id: string): void {
  sinks.delete(id)
}

export function post(clientId: string, channel: string, payload: unknown): void {
  try {
    sinks.get(clientId)?.(channel, payload)
  } catch {
    return
  }
}

export function broadcast(channel: string, payload: unknown, except?: string): void {
  for (const id of sinks.keys()) if (id !== except) post(id, channel, payload)
}
