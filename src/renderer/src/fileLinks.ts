export interface FileLinkCandidate {
  text: string
  start: number
  path: string
  suffix: string
}

export function fileLinkCandidates(line: string): FileLinkCandidate[] {
  const candidates: FileLinkCandidate[] = []
  for (const match of line.matchAll(/[^\s'"`()<>[\]{}|,;]+/g)) {
    const text = match[0].replace(/[.:]+$/, '')
    if (/^[a-z][\w+.-]*:\/\//i.test(text) && !/^file:\/\//i.test(text)) continue
    const suffix = /(?::\d+){1,2}$/.exec(text)?.[0] ?? ''
    let path = text.slice(0, text.length - suffix.length)
    if (/^file:\/\//i.test(path)) {
      try { path = decodeURIComponent(new URL(path).pathname) } catch { continue }
    }
    if (!path.includes('/') && !/\w\.[a-z][\w-]*$/i.test(path)) continue
    candidates.push({ text, start: match.index, path, suffix })
    if (candidates.length === 20) break
  }
  return candidates
}

export function opensInBrowser(fileUrl: string): boolean {
  return /\.(pdf|html?|png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(fileUrl)
}
