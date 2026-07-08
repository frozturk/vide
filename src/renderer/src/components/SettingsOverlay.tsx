import { useState } from 'react'
import { useStore } from '../store'
import type { AgentKind, Config } from '../../../shared/types'
import { TOOLBAR_HEIGHT } from './TopBar'

export function SettingsOverlay(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  if (!open) return null
  return <SettingsInner />
}

function SettingsInner(): React.JSX.Element {
  const config = useStore((s) => s.config)
  const [draft, setDraft] = useState<Config | null>(config ? JSON.parse(JSON.stringify(config)) : null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  function close(): void {
    useStore.setState({ settingsOpen: false })
  }

  async function save(): Promise<void> {
    if (!draft) return
    setBusy(true)
    try {
      const updated = await window.vide.configSave(draft)
      useStore.setState({ config: updated })
      setDraft(JSON.parse(JSON.stringify(updated)))
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setBusy(false)
    }
  }

  function updateKind(idx: number, patch: Partial<AgentKind>): void {
    if (!draft) return
    const kinds = [...draft.agentKinds]
    kinds[idx] = { ...kinds[idx], ...patch }
    setDraft({ ...draft, agentKinds: kinds })
  }

  function addKind(): void {
    if (!draft) return
    setDraft({
      ...draft,
      agentKinds: [
        ...draft.agentKinds,
        { id: `custom-${Date.now()}`, name: 'New Agent', command: '', color: '#8b8b8b' }
      ]
    })
  }

  function removeKind(idx: number): void {
    if (!draft) return
    const kinds = draft.agentKinds.filter((_, i) => i !== idx)
    setDraft({ ...draft, agentKinds: kinds })
  }

  function setField<K extends keyof Config>(key: K, value: Config[K]): void {
    if (!draft) return
    setDraft({ ...draft, [key]: value })
  }

  if (!draft) return <></>

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        className="flex max-h-[80vh] w-[640px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ marginTop: TOOLBAR_HEIGHT }}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <span className="text-base font-semibold text-zinc-100">Settings</span>
          <button
            onClick={close}
            className="rounded-lg px-2 py-1 text-sm text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-6">
            <div className="mb-3 text-xs font-medium uppercase tracking-wider text-zinc-500">General</div>
            <div className="flex flex-col gap-4">
              <Field label="Shell" hint="Path to shell binary (default: /bin/zsh)">
                <input
                  type="text"
                  value={draft.shell ?? ''}
                  onChange={(e) => setField('shell', e.target.value || undefined)}
                  placeholder="/bin/zsh"
                  className={inputCls}
                />
              </Field>
              <Field label="Worktree Base" hint="Where to create git worktrees">
                <input
                  type="text"
                  value={draft.worktreeBase}
                  onChange={(e) => setField('worktreeBase', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Default Browser URL">
                <input
                  type="text"
                  value={draft.defaultBrowserUrl}
                  onChange={(e) => setField('defaultBrowserUrl', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Agent Providers</span>
              <button
                onClick={addKind}
                className="rounded-lg border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {draft.agentKinds.map((k, i) => (
                <div key={k.id ?? i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: `${k.color}22`, color: k.color }}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="8" r="6" opacity="0.3" />
                        <circle cx="8" cy="8" r="3" />
                      </svg>
                    </span>
                    <input
                      type="color"
                      value={k.color}
                      onChange={(e) => updateKind(i, { color: e.target.value })}
                      className="h-7 w-7 cursor-pointer rounded border border-zinc-700 bg-transparent"
                    />
                    <input
                      type="text"
                      value={k.name}
                      onChange={(e) => updateKind(i, { name: e.target.value })}
                      placeholder="Name"
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      onClick={() => removeKind(i)}
                      className="rounded-lg p-1.5 text-zinc-600 transition hover:bg-red-950/50 hover:text-red-400"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 0 1 1.492-.15z" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Field label="ID" hint="Unique identifier (e.g. claude, codex)">
                      <input
                        type="text"
                        value={k.id}
                        onChange={(e) => updateKind(i, { id: e.target.value })}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Command" hint="Shell command. Use {prompt} for prompt substitution">
                      <input
                        type="text"
                        value={k.command}
                        onChange={(e) => updateKind(i, { command: e.target.value })}
                        placeholder="e.g. claude {prompt}"
                        className={inputCls}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Busy Regex" hint="Pattern for busy state (optional)">
                        <input
                          type="text"
                          value={k.busyRegex ?? ''}
                          onChange={(e) => updateKind(i, { busyRegex: e.target.value || undefined })}
                          className={inputCls}
                        />
                      </Field>
                      <Field label="Waiting Regex" hint="Pattern for waiting state (optional)">
                        <input
                          type="text"
                          value={k.waitingRegex ?? ''}
                          onChange={(e) => updateKind(i, { waitingRegex: e.target.value || undefined })}
                          className={inputCls}
                        />
                      </Field>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4">
          <span className="text-xs text-zinc-600">
            {saved ? <span className="text-emerald-400">Saved!</span> : 'Changes apply to new agents'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={close}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={() => void save()}
              disabled={busy}
              className="rounded-lg bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-900 transition hover:bg-white disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-zinc-400">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-zinc-600">{hint}</div>}
    </label>
  )
}
