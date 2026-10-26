// Keep Ctrl+C/D and other terminal control keys available on Windows/Linux.
export function shortcutModifiers(key: string, meta: boolean, ctrl: boolean, shift: boolean, alt: boolean, isMac: boolean): { active: boolean; shift: boolean } {
  return isMac
    ? { active: meta && !ctrl && !alt, shift }
    : { active: ctrl && shift && !meta && !alt, shift: key.toLowerCase() === 'r' }
}
