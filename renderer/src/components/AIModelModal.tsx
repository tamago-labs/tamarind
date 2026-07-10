// Toolbar-driven modal for picking a local AI model + loading it via
// QVAC. Composed from BaseModal (variant='canvas').
//
// Layout: two columns (no tabs).
//   • Left  — QVAC Registry (2 cards per row) + Custom models + Add form
//   • Right — Config (context size + tools) + Load status / Selection bar
//
// Load flow: clicking a card only updates a local "selected" id; no
// IPC fires until the user clicks Load in the right column. This
// fixes the previous "click = download" trap. A load in flight is
// reflected inline on the active card + the selection bar; `busy`
// stays true so the modal can't be dismissed mid-download.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Download, Plus, Trash2, X } from 'lucide-react'
import { BaseModal } from './BaseModal'
import { useAI } from '../hooks/useAI'
import { bridge } from '../lib/bridge'
import {
  CTX_SIZE_OPTIONS,
  type AiConfig,
  type ModelEntry,
  type ModelLoadProgress
} from '../ai/types'

interface AIModelModalProps {
  open: boolean
  onClose: () => void
}

export function AIModelModal({ open, onClose }: AIModelModalProps) {
  const ai = useAI()
  const isLoading = ai.progress !== null

  const [showAdd, setShowAdd] = useState(false)
  // Local "selected" id — clicking a model card only updates this. The
  // Load button in the right column is the only thing that fires
  // bridge.models.select(). Cleared after Unload so the picker lands
  // on a fresh empty state instead of re-presenting the model that
  // was just released.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Local "click just happened" flag. `useAI.select()` sets
  // `ai.progress` on its first line, but the IPC roundtrip + React
  // re-render takes a tick. Without this, the user sees a stale
  // "Load" button they can mash twice. The ref blocks re-entrant
  // calls even if the click fires before the state flushes.
  const [pendingLoad, setPendingLoad] = useState(false)
  const loadInFlightRef = useRef(false)

  // On open, pre-select the currently active model (or the last
  // selection) so the user sees what's loaded already highlighted.
  useEffect(() => {
    if (!open) return
    const fallback = ai.activeModel?.id ?? ai.status?.lastSelectedId ?? null
    setSelectedId(fallback)
    setShowAdd(false)
    // Intentionally only react to `open` flipping; later status
    // changes (e.g. a load completing) must not yank the user's
    // selection out from under them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const grouped = useMemo(() => {
    const builtins: ModelEntry[] = []
    const customs: ModelEntry[] = []
    for (const m of ai.status?.available ?? []) {
      if (m.builtin) builtins.push(m)
      else customs.push(m)
    }
    return { builtins, customs }
  }, [ai.status])

  const selectedModel = useMemo<ModelEntry | null>(() => {
    if (!selectedId) return null
    return ai.status?.available.find((m) => m.id === selectedId) ?? null
  }, [selectedId, ai.status])

  const isSelectedActive = !!ai.activeModel && ai.activeModel.id === selectedId
  const isSelectedLoading = isLoading && isSelectedActive
  // Hide the picker once a model is loaded — the user must Unload
  // first before they can pick a different one. Re-show it during a
  // load (so the in-flight progress row is visible) or if no model
  // is loaded yet.
  const showPicker = !ai.activeModel || isLoading || pendingLoad

  async function handleAdd(entry: {
    name: string
    source: string
    description?: string
  }): Promise<void> {
    try {
      await bridge.models.add(entry)
      await ai.refresh()
      setShowAdd(false)
    } catch (err) {
      console.error('[AIModal] add failed:', err)
    }
  }

  async function handleRemove(id: string): Promise<void> {
    try {
      await bridge.models.remove(id)
      await ai.refresh()
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      console.error('[AIModal] remove failed:', err)
    }
  }

  async function handleLoad(): Promise<void> {
    if (!selectedId) return
    if (loadInFlightRef.current) return
    loadInFlightRef.current = true
    setPendingLoad(true)
    try {
      await ai.select(selectedId)
    } finally {
      loadInFlightRef.current = false
      setPendingLoad(false)
    }
  }

  async function handleUnload(): Promise<void> {
    await ai.unload()
    // Clear the local selection so the picker lands on a fresh empty
    // state instead of re-presenting the model that was just released.
    setSelectedId(null)
  }

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='Enable Team AI'
      subtitle='Set up AI so your team can refine plans and automation.'
      variant='canvas'
      busy={isLoading}
      className='h-[80vh] w-[80vw] max-w-none'
    >
      <div className='mt-4 flex gap-5'>
        {/* ── Left column: Model lists ─────────────────────────── */}
        <div className='min-w-0 flex-[6] space-y-4'>
          {/* ── Error banner ───────────────────────────────────── */}
          {ai.error && (
            <div
              role='alert'
              className='flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'
            >
              <span className='font-mono uppercase tracking-wide'>{ai.error.code}</span>
              <span className='flex-1'>{ai.error.message}</span>
              <button
                type='button'
                onClick={() => ai.setError(null)}
                aria-label='Dismiss error'
                className='text-red-500 transition hover:text-red-700 focus:outline-none focus:ring-2 focus:ring-red-300'
              >
                <X className='h-3 w-3' aria-hidden='true' />
              </button>
            </div>
          )}

          {/* ── Model picker (QVAC Registry + Custom + Add custom)
              Hidden when a model is fully loaded and the user hasn't
              clicked "Switch model" — the loaded card with Unload +
              Switch is the only thing they need. Re-shown during a
              load (so progress is visible) or after Switch. */}
          {showPicker && (
            <>
              {/* ── QVAC Registry ─────────────────────────────── */}
              <section>
                <h3 className='mb-2.5 text-sm font-semibold text-gray-700'>QVAC Registry</h3>
                {grouped.builtins.length === 0 ? (
                  <p className='text-sm text-gray-500'>No recommended models registered.</p>
                ) : (
                  <div className='grid grid-cols-2 gap-2.5'>
                    {grouped.builtins.map((m) => (
                      <ModelCard
                        key={m.id}
                        model={m}
                        isSelected={selectedId === m.id}
                        isActive={ai.activeModel?.id === m.id}
                        isLoading={isLoading && ai.activeModel?.id === m.id}
                        progress={isLoading && ai.activeModel?.id === m.id ? ai.progress : null}
                        onSelect={() => setSelectedId(m.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* ── Custom models ──────────────────────────────── */}
              <section>
                <h3 className='mb-2.5 text-sm font-semibold text-gray-700'>Custom</h3>
                {grouped.customs.length === 0 ? (
                  <p className='text-sm text-gray-500'>No custom models added yet.</p>
                ) : (
                  <div className='grid grid-cols-2 gap-2.5'>
                    {grouped.customs.map((m) => (
                      <ModelCard
                        key={m.id}
                        model={m}
                        isSelected={selectedId === m.id}
                        isActive={ai.activeModel?.id === m.id}
                        isLoading={isLoading && ai.activeModel?.id === m.id}
                        progress={isLoading && ai.activeModel?.id === m.id ? ai.progress : null}
                        onSelect={() => setSelectedId(m.id)}
                        onRemove={() => void handleRemove(m.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* ── Add custom ─────────────────────────────────── */}
              <section>
                {!showAdd ? (
                  <button
                    type='button'
                    onClick={() => setShowAdd(true)}
                    className='inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
                  >
                    <Plus className='h-4 w-4' aria-hidden='true' />
                    Add custom model
                  </button>
                ) : (
                  <AddCustomModelForm
                    onComplete={(e) => void handleAdd(e)}
                    onCancel={() => setShowAdd(false)}
                  />
                )}
              </section>
            </>
          )}
        </div>

        {/* ── Right column: Config + Load status ────────────────── */}
        <div className='flex-[4] space-y-4'>
          {/* ── Config section ──────────────────────────────────── */}
          <ConfigSection
            config={ai.config}
            disabled={isLoading}
            onChange={(next) => void ai.setConfig(next)}
          />

          {/* ── Load status / Selection bar ─────────────────────── */}
          <SelectionBar
            model={selectedModel}
            isActive={isSelectedActive}
            isLoading={isSelectedLoading}
            pending={pendingLoad}
            progress={isSelectedLoading ? ai.progress : null}
            onLoad={() => void handleLoad()}
            onUnload={() => void handleUnload()}
            onCancel={() => void ai.cancel(true)}
          />
        </div>
      </div>
    </BaseModal>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Model card — select-only (clicking does NOT trigger a load)
// Renders as a 2-per-row card with larger text for QVAC registry
// ─────────────────────────────────────────────────────────────────────

interface ModelCardProps {
  model: ModelEntry
  isSelected: boolean
  isActive: boolean
  isLoading: boolean
  progress: ModelLoadProgress | null
  onSelect: () => void
  onRemove?: () => void
}

function ModelCard({
  model,
  isSelected,
  isActive,
  isLoading,
  progress,
  onSelect,
  onRemove
}: ModelCardProps) {
  return (
    <div
      className={
        isSelected
          ? 'relative flex flex-col rounded-lg border-2 border-tamarind-600 bg-tamarind-50 p-3 transition'
          : 'relative flex flex-col rounded-lg border border-gray-200 bg-white p-3 transition hover:border-gray-300 hover:bg-gray-50'
      }
    >
      <button
        type='button'
        onClick={onSelect}
        aria-pressed={isSelected}
        className='flex flex-1 flex-col text-left'
      >
        {/* Radio indicator + model name */}
        <div className='flex items-center gap-2'>
          <span
            aria-hidden='true'
            className={
              isSelected
                ? 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-tamarind-700 bg-tamarind-700'
                : 'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 bg-white'
            }
          >
            {isSelected && <Check className='h-2.5 w-2.5 text-white' aria-hidden='true' />}
          </span>
          <span className='truncate text-sm font-medium text-gray-800'>{model.name}</span>
        </div>

        {/* Description */}
        {model.description && (
          <p className='mt-1.5 pl-6 text-xs text-gray-500 line-clamp-2'>{model.description}</p>
        )}

        {/* File size */}
        {model.size && (
          <div className='mt-1.5 pl-6 text-[10px] text-gray-500'>
            Space required: {(model.size / 1024 / 1024 / 1024).toFixed(2)} GB
          </div>
        )}

        {/* Badges */}
        <div className='mt-1.5 flex flex-wrap items-center gap-1.5 pl-6'>
          {isActive && !isLoading && (
            <span className='rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
              Loaded
            </span>
          )}
          {isLoading && (
            <span className='rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700'>
              {progress?.phase ?? 'loading'}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {isLoading && progress && (
          <div className='mt-2 pl-6'>
            <div className='h-1.5 w-full overflow-hidden rounded-full bg-gray-200'>
              <div
                className='h-full rounded-full bg-tamarind-600 transition-all'
                style={{ width: `${Math.round(progress.percentage)}%` }}
              />
            </div>
            <p className='mt-1 text-[10px] text-gray-500'>
              {progress.phase === 'downloading'
                ? `Downloading… ${Math.round(progress.percentage)}%`
                : `Loading into memory… ${Math.round(progress.percentage)}%`}
            </p>
          </div>
        )}
      </button>

      {/* Remove button for custom models */}
      {onRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={`Remove ${model.name}`}
          className='absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-300'
        >
          <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
        </button>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Selection bar — explicit Load / Unload / Cancel
// ─────────────────────────────────────────────────────────────────────

interface SelectionBarProps {
  model: ModelEntry | null
  isActive: boolean
  isLoading: boolean
  // True between the click and the first progress event — the
  // bridge roundtrip + render takes a tick and we don't want a stale
  // clickable Load button in that gap.
  pending: boolean
  progress: ModelLoadProgress | null
  onLoad: () => void
  onUnload: () => void
  onCancel: () => void
}

function SelectionBar({
  model,
  isActive,
  isLoading,
  pending,
  progress,
  onLoad,
  onUnload,
  onCancel
}: SelectionBarProps) {
  if (!model) {
    return (
      <div className='rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500'>
        Pick a model, then load it.
      </div>
    )
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span className='text-sm font-medium text-gray-800'>{model.name}</span>
            {isActive && !isLoading && !pending && (
              <span className='rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700'>
                Loaded
              </span>
            )}
            {isLoading && (
              <span className='rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700'>
                {progress?.phase ?? 'loading'}
              </span>
            )}
            {pending && !isLoading && (
              <span className='rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600'>
                downloading
              </span>
            )}
          </div>
          {isLoading && progress && (
            <div className='mt-2'>
              <div className='h-2 w-full overflow-hidden rounded-full bg-gray-200'>
                <div
                  className='h-full rounded-full bg-tamarind-600 transition-all'
                  style={{ width: `${Math.round(progress.percentage)}%` }}
                />
              </div>
              <p className='mt-1 text-[10px] text-gray-500'>
                {progress.phase === 'downloading'
                  ? `Downloading… ${Math.round(progress.percentage)}%`
                  : `Loading into memory… ${Math.round(progress.percentage)}%`}
              </p>
            </div>
          )}
          {pending && !isLoading && <p className='mt-1 text-[10px] text-gray-500'>Starting…</p>}
        </div>
      </div>

      {/* Action buttons */}
      <div className='mt-3 flex items-center gap-2'>
        {isLoading ? (
          <button
            type='button'
            onClick={onCancel}
            className='rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            Cancel
          </button>
        ) : pending ? (
          <button
            type='button'
            disabled
            aria-busy='true'
            className='inline-flex cursor-not-allowed items-center gap-1.5 rounded-md bg-tamarind-700 px-4 py-1.5 text-sm font-medium text-white opacity-60'
          >
            Starting…
          </button>
        ) : isActive ? (
          <button
            type='button'
            onClick={onUnload}
            className='rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            Unload
          </button>
        ) : (
          <button
            type='button'
            onClick={onLoad}
            className='inline-flex items-center gap-1.5 rounded-md bg-tamarind-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-tamarind-800 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            <Download className='h-4 w-4' aria-hidden='true' />
            Load
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Config section
// ─────────────────────────────────────────────────────────────────────

interface ConfigSectionProps {
  config: AiConfig
  disabled: boolean
  onChange: (next: AiConfig) => void
}

function ConfigSection({ config, disabled, onChange }: ConfigSectionProps) {
  return (
    <section className='rounded-lg border border-gray-200 bg-gray-50 p-4'>
      <h3 className='mb-3 text-sm font-semibold text-gray-700'>Model configuration</h3>
      <div className='space-y-3'>
        <label className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-gray-600'>Context size</span>
          <select
            value={config.ctx_size}
            disabled={disabled}
            aria-label='Context size in tokens'
            onChange={(e) => {
              const v = Number(e.target.value)
              if (v === 2048 || v === 4096 || v === 8192) {
                onChange({ ...config, ctx_size: v })
              }
            }}
            className='h-9 rounded-md border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {CTX_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
                {n === 4096 ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <span className='text-[10px] text-gray-500'>
            Lower uses less memory; higher keeps longer conversations in one call.
          </span>
        </label>
        <div className='flex flex-col gap-1.5'>
          <span className='text-xs font-medium text-gray-600'>Tools</span>
          <div
            role='radiogroup'
            aria-label='Tools'
            className='inline-flex h-9 w-fit overflow-hidden rounded-md border border-gray-300 bg-white'
          >
            {(
              [
                { v: false, label: 'Off' },
                { v: true, label: 'On' }
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.v)}
                type='button'
                role='radio'
                aria-checked={config.tools === opt.v}
                disabled={disabled}
                onClick={() => onChange({ ...config, tools: opt.v })}
                className={
                  config.tools === opt.v
                    ? 'bg-blue-50 px-4 text-sm font-medium text-blue-700'
                    : 'px-4 text-sm text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className='text-[10px] text-gray-500'>
            Allow the model to call tools (function-calling). Disable for simpler chat-only
            workloads.
          </span>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Add custom model form
// ─────────────────────────────────────────────────────────────────────

type AddMode = 'url' | 'file'

interface AddCustomModelFormProps {
  onComplete: (entry: { name: string; source: string; description?: string }) => void
  onCancel: () => void
}

function AddCustomModelForm({ onComplete, onCancel }: AddCustomModelFormProps) {
  const [mode, setMode] = useState<AddMode>('url')
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [description, setDescription] = useState('')
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState('')

  async function handlePickFile() {
    setPickError('')
    setPicking(true)
    try {
      const picked = await bridge.models.pickFile()
      if (picked) {
        setSource(picked)
        if (!name.trim()) {
          const filename = picked.split(/[\\/]/).pop() ?? picked
          setName(filename.replace(/\.gguf$/i, ''))
        }
      }
    } catch (e) {
      setPickError(e instanceof Error ? e.message : 'Failed to pick file')
    } finally {
      setPicking(false)
    }
  }

  function handleSubmit() {
    if (!name.trim()) return
    if (mode === 'url' && !/^https?:\/\//i.test(source.trim())) return
    if (mode === 'file' && !source.trim()) return
    onComplete({
      name: name.trim(),
      source: source.trim(),
      description: description.trim() || undefined
    })
  }

  const canSubmit =
    name.trim().length > 0 &&
    ((mode === 'url' && /^https?:\/\//i.test(source.trim())) ||
      (mode === 'file' && source.trim().length > 0))

  return (
    <div className='flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4'>
      <h3 className='text-sm font-semibold text-gray-700'>Add custom model</h3>

      {/* Mode toggle */}
      <div className='inline-flex w-fit overflow-hidden rounded-md border border-gray-300'>
        {(
          [
            { v: 'url', label: 'URL' },
            { v: 'file', label: 'File' }
          ] as const
        ).map((opt) => (
          <button
            key={opt.v}
            type='button'
            onClick={() => setMode(opt.v)}
            className={
              mode === opt.v
                ? 'bg-blue-600 px-3 py-1.5 text-xs font-medium text-white'
                : 'border-r border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 last:border-r-0 hover:bg-gray-50'
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      <Field label='Name' value={name} onChange={setName} placeholder='My fine-tuned QWEN' />

      {mode === 'url' ? (
        <Field
          label='Source URL'
          value={source}
          onChange={setSource}
          placeholder='https://example.com/model.gguf'
          monospace
        />
      ) : (
        <div className='flex flex-col gap-1.5'>
          <label className='text-xs font-medium text-gray-600'>GGUF file</label>
          <div className='flex items-center gap-2'>
            <input
              type='text'
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder='Click "Browse…" to pick a .gguf file'
              readOnly
              className='h-9 flex-1 rounded-md border border-gray-300 px-2.5 font-mono text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <button
              type='button'
              onClick={() => void handlePickFile()}
              disabled={picking}
              className='inline-flex h-9 items-center rounded-md border border-blue-500 px-3 text-xs font-medium text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
            >
              {picking ? 'Picking…' : 'Browse…'}
            </button>
          </div>
          {pickError && <p className='text-xs text-red-600'>{pickError}</p>}
        </div>
      )}

      <Field
        label='Description (optional)'
        value={description}
        onChange={setDescription}
        placeholder='Local fine-tune, 8K context'
      />

      <div className='flex items-center gap-2 pt-1'>
        <button
          type='button'
          onClick={handleSubmit}
          disabled={!canSubmit}
          className='rounded-md bg-tamarind-700 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-tamarind-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
        >
          Add model
        </button>
        <button
          type='button'
          onClick={onCancel}
          className='rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  monospace?: boolean
}

function Field({ label, value, onChange, placeholder, monospace }: FieldProps) {
  return (
    <label className='flex flex-col gap-1.5'>
      <span className='text-xs font-medium text-gray-600'>{label}</span>
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-9 rounded-md border border-gray-300 px-2.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          monospace ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}
