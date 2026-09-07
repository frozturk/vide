export function isDevelopmentRuntime(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

export function tmuxSessionPrefix(dev = isDevelopmentRuntime()): string {
  return dev ? 'vide-dev-' : 'vide-'
}

export function ownsTmuxSession(name: string, dev = isDevelopmentRuntime()): boolean {
  if (dev) return name.startsWith(tmuxSessionPrefix(true))
  return name.startsWith(tmuxSessionPrefix(false)) && !name.startsWith(tmuxSessionPrefix(true))
}

export function runtimeStateFile(base: string, dev = isDevelopmentRuntime()): string {
  return dev ? `${base}.dev.json` : `${base}.json`
}
