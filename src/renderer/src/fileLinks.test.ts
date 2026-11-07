import { describe, expect, it } from 'vitest'
import { fileLinkCandidates, opensInBrowser } from './fileLinks'

describe('terminal file links', () => {
  it('finds paths with line suffixes and file URLs', () => {
    expect(fileLinkCandidates('Edited src/main/browser.ts:12:5, see ./README.md.')).toEqual([
      { text: 'src/main/browser.ts:12:5', start: 7, path: 'src/main/browser.ts', suffix: ':12:5' },
      { text: './README.md', start: 37, path: './README.md', suffix: '' }
    ])
    expect(fileLinkCandidates('open file:///tmp/a%20b.html now')).toEqual([{ text: 'file:///tmp/a%20b.html', start: 5, path: '/tmp/a b.html', suffix: '' }])
  })
  it('sends pages, PDFs and images to the browser and other files to VS Code', () => {
    for (const file of ['a.html', 'b.PDF', 'c.png', 'd.svg']) expect(opensInBrowser(`file:///tmp/${file}`)).toBe(true)
    for (const file of ['a.ts', 'README.md', 'html.json']) expect(opensInBrowser(`file:///tmp/${file}`)).toBe(false)
  })
  it('skips web URLs and plain words', () => {
    expect(fileLinkCandidates('visit https://example.com/a.html or just words here')).toEqual([])
  })
})
