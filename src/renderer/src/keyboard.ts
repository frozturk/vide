const KEY = 'keyboardHeight'

export function composerFocused(): boolean {
  return document.activeElement?.matches('textarea[enterkeyhint=send]') ?? false
}

export function rememberKeyboard(height: number): void {
  try {
    localStorage.setItem(KEY, String(Math.round(height)))
  } catch {
    return
  }
}

function expectedKeyboard(): number {
  try {
    const saved = Number(localStorage.getItem(KEY))
    if (saved > 120) return saved
  } catch {
    return Math.round(window.innerHeight * 0.4)
  }
  return Math.round(window.innerHeight * 0.4)
}

export function anticipateKeyboard(open: boolean): void {
  const root = document.documentElement
  root.style.setProperty('--kb-h', open ? `${expectedKeyboard()}px` : '0px')
  root.classList.toggle('keyboard-open', open)
}

export function focusWithoutPan(el: HTMLElement): void {
  const top = el.getBoundingClientRect().top
  el.style.transform = `translateY(${-top}px)`
  el.focus({ preventScroll: true })
  requestAnimationFrame(() => {
    el.style.transform = ''
  })
}
