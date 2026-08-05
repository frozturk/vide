import { useEffect } from 'react'
import { useStore } from './store'
import { TopBar, TOOLBAR_HEIGHT } from './components/TopBar'
import { TerminalPane } from './components/TerminalPane'
import { AgentStrip } from './components/AgentStrip'
import { BrowserBar } from './components/BrowserBar'
import { DiffOverlay } from './components/DiffOverlay'
import { SpawnDialog } from './components/SpawnDialog'
import { CloseDialog } from './components/CloseDialog'
import { SettingsOverlay } from './components/SettingsOverlay'
import { CommandPalette } from './components/CommandPalette'

export default function App(): React.JSX.Element {
  const overlay = useStore((s) => s.overlay)
  const dialog = useStore((s) => s.dialog)
  const paletteOpen = useStore((s) => s.paletteOpen)

  useEffect(() => {
    void window.vide.browserSetVisible(overlay === 'browser' && !dialog && !paletteOpen, false)
  }, [overlay, dialog, paletteOpen])

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-200">
      <TopBar />
      <div style={{ position: 'absolute', inset: `${TOOLBAR_HEIGHT}px 0 0 14px` }}>
        <TerminalPane />
      </div>
      <AgentStrip />
      <BrowserBar />
      <DiffOverlay />
      <SpawnDialog />
      <CloseDialog />
      <SettingsOverlay />
      <CommandPalette />
    </div>
  )
}
