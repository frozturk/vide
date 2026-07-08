export type ChordId =
  | 'prev'
  | 'next'
  | 'spawn'
  | 'close'
  | 'diff'
  | 'browser'
  | 'focus-url'
  | 'reload-config'
  | 'open-config'
  | 'jump-1'
  | 'jump-2'
  | 'jump-3'
  | 'jump-4'
  | 'jump-5'
  | 'jump-6'
  | 'jump-7'
  | 'jump-8'
  | 'jump-9'

interface ChordDef {
  id: ChordId
  key: string
  shift?: boolean
}

const jumps = Array.from({ length: 9 }, (_, i): ChordDef => ({ id: `jump-${i + 1}` as ChordId, key: String(i + 1) }))

export const CHORDS: ChordDef[] = [
  { id: 'prev', key: 'arrowup' },
  { id: 'next', key: 'arrowdown' },
  { id: 'spawn', key: 't' },
  { id: 'close', key: 'w' },
  { id: 'diff', key: 'd' },
  { id: 'browser', key: 'b' },
  { id: 'focus-url', key: 'l' },
  { id: 'reload-config', key: 'r', shift: true },
  { id: 'open-config', key: ',' },
  ...jumps
]

export function matchChord(key: string, meta: boolean, shift: boolean): ChordId | null {
  if (!meta) return null
  const k = key.toLowerCase()
  return CHORDS.find((c) => c.key === k && !!c.shift === shift)?.id ?? null
}
