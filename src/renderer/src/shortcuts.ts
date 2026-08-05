import { matchChord, type ChordId } from '../../shared/chords'
import {
  closeBrowserTab,
  closeDialog,
  closeOverlay,
  closePalette,
  closeSearch,
  focusUrlBar,
  newBrowserTab,
  openSearch,
  openSpawnDialog,
  panelKeyboardRelease,
  reloadConfig,
  requestClose,
  selectAgent,
  selectSibling,
  toggleOverlay,
  togglePalette
} from './actions'
import { useStore } from './store'

export function dispatch(chord: ChordId): void {
  const s = useStore.getState()
  if (s.dialog) return
  if (chord.startsWith('jump-')) {
    const idx = Number(chord.slice(5)) - 1
    const agent = s.agents[idx]
    if (agent) selectAgent(agent.id, 'click')
    return
  }
  switch (chord) {
    case 'prev':
      selectSibling(-1)
      break
    case 'next':
      selectSibling(1)
      break
    case 'spawn':
      if (s.overlay === 'browser') newBrowserTab()
      else openSpawnDialog()
      break
    case 'close':
      if (s.overlay === 'browser') {
        if (s.browser.activeId !== null) closeBrowserTab(s.browser.activeId)
      } else void requestClose()
      break
    case 'diff':
      toggleOverlay('diff')
      break
    case 'browser':
      toggleOverlay('browser')
      break
    case 'palette':
      togglePalette()
      break
    case 'find':
      openSearch()
      break
    case 'focus-url':
      focusUrlBar()
      break
    case 'reload-config':
      void reloadConfig()
      break
    case 'open-config':
      void window.vide.configOpen()
      break
  }
}

export function installKeyboard(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      const s = useStore.getState()
      if (e.key === 'Escape') {
        if (s.dialog) {
          e.preventDefault()
          e.stopPropagation()
          closeDialog()
        } else if (s.paletteOpen) {
          e.preventDefault()
          e.stopPropagation()
          closePalette()
        } else if (s.searchOpen) {
          e.preventDefault()
          e.stopPropagation()
          closeSearch()
        } else if (s.overlay !== 'none') {
          e.preventDefault()
          e.stopPropagation()
          closeOverlay()
        }
        return
      }
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const chord = matchChord(e.key, true, e.shiftKey)
      if (!chord) return
      e.preventDefault()
      e.stopPropagation()
      dispatch(chord)
    },
    { capture: true }
  )
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Meta') panelKeyboardRelease()
  })
  window.addEventListener('blur', () => panelKeyboardRelease())
}
