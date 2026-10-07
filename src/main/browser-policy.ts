import { createHash } from 'crypto'

export function browserPartition(projectId: string, dev = false): string {
  return `persist:vide-browser-${dev ? 'dev-' : ''}${createHash('sha256').update(projectId).digest('hex').slice(0, 24)}`
}

export function browserUrl(input: string): string {
  const value = input.trim()
  if (value === 'about:blank') return value
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value) ? value : `http://${value}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS pages are supported')
  return url.href
}

export function deadline<T>(promise: Promise<T>, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser operation timed out')), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
