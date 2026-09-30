const TOP_RULE = /^─{3,}(.*─{3,})?$/
const BOTTOM_RULE = /^─{8,}$/

export function inputBoxRows(lines: string[]): [number, number] | null {
  let end = lines.length
  while (end > 0 && !lines[end - 1].trim()) end--
  for (let bottom = end - 1; bottom >= Math.max(2, end - 5); bottom--) {
    if (!BOTTOM_RULE.test(lines[bottom])) continue
    for (let top = bottom - 2; top >= Math.max(0, bottom - 12); top--) {
      if (TOP_RULE.test(lines[top])) return lines[top + 1].startsWith('❯') ? [top, bottom] : null
    }
    return null
  }
  return null
}
