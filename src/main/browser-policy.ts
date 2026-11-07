import { createHash } from 'crypto'
import { isAbsolute } from 'path'
import { pathToFileURL } from 'url'

export function browserPartition(projectId: string, dev = false): string {
  return `persist:vide-browser-${dev ? 'dev-' : ''}${createHash('sha256').update(projectId).digest('hex').slice(0, 24)}`
}

export function browserUrl(input: string, from?: string): string {
  const value = input.trim()
  if (value === 'about:blank') return value
  if (isAbsolute(value)) return pathToFileURL(value).href
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value) ? value : `http://${value}`)
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) throw new Error('Only HTTP, HTTPS and file pages are supported')
  if (url.protocol === 'file:' && from !== undefined && !from.startsWith('file:')) throw new Error('Pages cannot open local files')
  return url.href
}

export function chromeUserAgent(ua: string): string {
  return ua.replace(/\(KHTML, like Gecko\).*?Chrome\/(\d+)\S*/, '(KHTML, like Gecko) Chrome/$1.0.0.0').replace(/ Electron\/\S+/, '')
}

export function chromeHeaders(url: string, headers: Record<string, string>, full: string, platform: NodeJS.Platform): Record<string, string> {
  const brands = (version: string, grease: string): string => `"Google Chrome";v="${version}", "Chromium";v="${version}", "Not;A=Brand";v="${grease}"`
  const present = Object.keys(headers).filter((key) => key.toLowerCase().startsWith('sec-ch-ua'))
  if (!url.startsWith('https:') && !present.length) return headers
  const result = Object.fromEntries(Object.entries(headers).filter(([key]) => !['sec-ch-ua', 'sec-ch-ua-full-version-list'].includes(key.toLowerCase())))
  if (!present.some((key) => key.toLowerCase() === 'sec-ch-ua-mobile')) result['sec-ch-ua-mobile'] = '?0'
  if (!present.some((key) => key.toLowerCase() === 'sec-ch-ua-platform')) result['sec-ch-ua-platform'] = `"${platform === 'darwin' ? 'macOS' : platform === 'win32' ? 'Windows' : 'Linux'}"`
  result['sec-ch-ua'] = brands(full.split('.')[0], '8')
  if (present.some((key) => key.toLowerCase() === 'sec-ch-ua-full-version-list')) result['sec-ch-ua-full-version-list'] = brands(full, '8.0.0.0')
  return result
}

export function deadline<T>(promise: Promise<T>, ms = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Browser operation timed out')), ms)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
