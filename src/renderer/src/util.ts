export function basename(p: string): string {
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

export function dirname(p: string): string {
  const clean = p.replace(/\/+$/, '')
  const i = clean.lastIndexOf('/')
  return i === -1 ? '' : clean.slice(0, i)
}
