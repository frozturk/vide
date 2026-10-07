import { useStore } from './store'
import { TopBar } from './components/TopBar'
import { RAIL_WIDTH } from '../../shared/layout'
import { TerminalPane } from './components/TerminalPane'
import { AgentStrip } from './components/AgentStrip'
import { DiffOverlay } from './components/DiffOverlay'
import { SpawnDialog } from './components/SpawnDialog'
import { CloseDialog } from './components/CloseDialog'
import { SettingsOverlay } from './components/SettingsOverlay'
import { CommandPalette } from './components/CommandPalette'
import { Spinner } from './components/Spinner'
import { KeyBar } from './components/KeyBar'
import { BrowserPane } from './components/BrowserPane'
import { Composer } from './components/Composer'

export default function App(): React.JSX.Element {
  const booting = useStore((s) => s.booting)
  const pinned = useStore((s) => s.panelPinned)
  const panelWidth = useStore((s) => s.panelWidth)
  const compact = useStore((s) => s.compact)
  const dock = useStore((s) => (s.compact && s.isWeb ? s.selectedId : null))
  const reconnecting = useStore((s) => s.connection === 'reconnecting')

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-950 text-zinc-200">
      <TopBar />
      <div style={{ position: 'absolute', inset: compact ? `var(--toolbar-h) 0 ${dock ? 'var(--dock-h)' : '0px'} 0` : `var(--toolbar-h) 0 0 ${pinned ? RAIL_WIDTH + panelWidth : RAIL_WIDTH}px`, transition: 'left 150ms' }}>
        <TerminalPane />
      </div>
      {dock && (
        <div className="dock fixed inset-x-0 z-30 bg-gradient-to-t from-zinc-950 from-60% to-transparent">
          <Composer key={dock} agentId={dock} />
          <KeyBar />
        </div>
      )}
      {reconnecting && (
        <div className="fixed left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-700/80 bg-zinc-900/95 px-3.5 py-1.5 text-xs text-zinc-300 shadow-xl backdrop-blur" style={{ top: 'calc(var(--toolbar-h) + 10px)', animation: 'pill-in 220ms var(--ease-out)' }}>
          <Spinner size={11} />
          Reconnecting…
        </div>
      )}
      <BrowserPane />
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
