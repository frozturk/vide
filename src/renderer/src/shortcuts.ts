import { matchBrowserShortcut, type BrowserShortcut } from '../../shared/browser-shortcuts'
import { matchChord, type ChordId } from '../../shared/chords'
import {
  closeDialog,
  closeOverlay,
  closePalette,
  closeSearch,
  openSearch,
  openAddTerminalDialog,
  openNewWorkspaceDialog,
  openSpawnDialog,
  panelKeyboardRelease,
  reloadConfig,
  requestClose,
  selectSibling,
  selectNextAttentionTerminal,
  selectTerminalSibling,
  selectWorkspace,
  toggleOverlay,
  togglePalette
} from './actions'
import { useStore } from './store'
import { workspaceNavigation } from './workspaceNavigation'

export function dispatch(chord: ChordId | BrowserShortcut): void {
  const s = useStore.getState()
  if (s.dialog) return
  if (['browser-close-tab', 'browser-new-tab', 'browser-reload', 'browser-address'].includes(chord)) {
    window.dispatchEvent(new CustomEvent('vide:browser-shortcut', { detail: chord }))
    return
  }
  if (chord.startsWith('jump-')) {
    const idx = Number(chord.slice(5)) - 1
    const workspace = workspaceNavigation(s.projects, s.workspaces, s.agents)[idx]
    if (workspace) selectWorkspace(workspace.id, 'click')
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
      openSpawnDialog()
      break
    case 'new-workspace':
      openNewWorkspaceDialog()
      break
    case 'close':
      void requestClose()
      break
    case 'browser':
      if (!s.isWeb && s.selectedWorkspaceId) useStore.setState({ browserOpen: !s.browserOpen })
      break
    case 'diff':
      toggleOverlay('diff')
      break
    case 'palette':
      togglePalette()
      break
    case 'find':
      openSearch()
      break
    case 'next-attention':
      selectNextAttentionTerminal()
      break
    case 'next-terminal':
      selectTerminalSibling(1)
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
      const inBrowser = e.target instanceof Element && !!e.target.closest('[data-browser-pane]')
      const chord = (inBrowser ? matchBrowserShortcut(e.key, true, e.shiftKey) : null) ?? matchChord(e.key, true, e.shiftKey)
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
