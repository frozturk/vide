export function isDevelopmentRuntime(): boolean {
  return Boolean(process.env.ELECTRON_RENDERER_URL)
}

export function sessionPrefix(dev = isDevelopmentRuntime()): string {
  return dev ? 'vide-dev-' : 'vide-'
}

export function runtimeStateFile(base: string, dev = isDevelopmentRuntime()): string {
  return dev ? `${base}.dev.json` : `${base}.json`
}
