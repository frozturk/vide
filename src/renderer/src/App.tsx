import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { RAIL_WIDTH, TOOLBAR_HEIGHT } from '../../shared/layout'
import { TerminalPane } from './components/TerminalPane'
import { AgentStrip } from './components/AgentStrip'
import { DiffOverlay } from './components/DiffOverlay'
import { SpawnDialog } from './components/SpawnDialog'
import { CloseDialog } from './components/CloseDialog'
import { SettingsOverlay } from './components/SettingsOverlay'
import { CommandPalette } from './components/CommandPalette'
import { Spinner } from './components/Spinner'

export default function App(): React.JSX.Element {
  const booting = useStore((s) => s.booting)
  const pinned = useStore((s) => s.panelPinned)
  const panelWidth = useStore((s) => s.panelWidth)

  return (
    <div className="h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-200">
      <TopBar />
      <div style={{ position: 'absolute', inset: `${TOOLBAR_HEIGHT}px 0 0 ${pinned ? RAIL_WIDTH + panelWidth : RAIL_WIDTH}px`, transition: 'left 150ms' }}>
        <TerminalPane />
      </div>
      <AgentStrip />
      <DiffOverlay />
      <SpawnDialog />
      <CloseDialog />
      <SettingsOverlay />
      <CommandPalette />
      {booting && (
        <div className="fixed inset-0 z-60 flex flex-col items-center justify-center gap-3 bg-zinc-950">
          <Spinner size={22} />
          <span className="text-xs text-zinc-500">restoring agents…</span>
        </div>
      )}
    </div>
  )
}
