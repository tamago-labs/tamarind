// Toolbar-driven modal for picking a local AI model + loading it via
// QVAC. Composed from BaseModal (variant='canvas'). Has four regions:
//
//   1. Model configuration — context size + tools toggle, persisted
//      in <userData>/models.json> under the aiConfig key.
//   2. Model list — one row per ModelEntry (builtin / custom URL /
//      custom file).
//   3. Add custom model — URL or .gguf file picker.
//   4. Footer — Close / Unload / Cancel depending on state.
//
// `busy` is true while progress != null so the modal can't be
// dismissed mid-download. The config controls are also disabled mid-
// load to prevent a config race with the in-flight SDK request.

import { useMemo, useState } from 'react'
import { Brain, Plus, Trash2, X } from 'lucide-react'
import { BaseModal } from './BaseModal'
import { useAI } from '../hooks/useAI'
import { bridge } from '../lib/bridge'
import { CTX_SIZE_OPTIONS, type AiConfig, type ModelEntry } from '../ai/types'

interface AIModelModalProps {
  open: boolean
  onClose: () => void
}

export function AIModelModal({ open, onClose }: AIModelModalProps) {
  const ai = useAI()
  const isLoading = ai.progress != null
  const isLoaded = ai.isReady

  // local "Add custom" form state — kept inside the modal so the
  // form unmounts cleanly with the modal (no draft carryover).
  const [showAdd, setShowAdd] = useState(false)

  // Group: builtins first, then customs. Builtins pinned to the top
  // matches TamaFlow's order and keeps the "obvious" picks (QWEN
  // 1.7B / 4B) above user drop-ins.
  const grouped = useMemo(() => {
    const builtins: ModelEntry[] = []
    const customs: ModelEntry[] = []
    for (const m of ai.status?.available ?? []) {
      if (m.builtin) builtins.push(m)
      else customs.push(m)
    }
    return { builtins, customs }
  }, [ai.status])

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
    } catch (err) {
      console.error('[AIModal] remove failed:', err)
    }
  }

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='AI model'
      hint={
        isLoading
          ? `Loading… ${Math.round(ai.progress?.percentage ?? 0)}%`
          : ai.error
            ? ai.error.message
            : isLoaded
              ? `Loaded — ${ai.activeModel?.name ?? 'model'}`
              : 'Pick a model to load, or add a custom one.'
      }
      icon={<Brain className='h-4 w-4 text-tamarind-700' aria-hidden='true' />}
      variant='canvas'
      busy={isLoading}
      footer={
        <div className='flex items-center gap-2'>
          {isLoading && (
            <button
              type='button'
              onClick={() => void ai.cancel(true)}
              className='rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              Cancel
            </button>
          )}
          {isLoaded && !isLoading && (
            <button
              type='button'
              onClick={() => void ai.unload()}
              className='rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              Unload
            </button>
          )}
          <button
            type='button'
            onClick={onClose}
            disabled={isLoading}
            className='rounded-md bg-tamarind-700 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-tamarind-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
          >
            Close
          </button>
        </div>
      }
    >
      <div className='space-y-5'>
        {/* ── Model configuration ─────────────────────────────── */}
        <ConfigSection
          config={ai.config}
          disabled={isLoading}
          onChange={(next) => void ai.setConfig(next)}
        />

        {/* ── Error banner ─────────────────────────────────────── */}
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

        {/* ── Built-in models ──────────────────────────────────── */}
        <section>
          <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>
            Built-in
          </h3>
          {grouped.builtins.length === 0 ? (
            <p className='text-xs text-gray-500'>No built-in models registered.</p>
          ) : (
            <ul className='divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200'>
              {grouped.builtins.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  isActive={ai.activeModel?.id === m.id}
                  isLoading={isLoading && ai.activeModel?.id === m.id}
                  onSelect={() => void ai.select(m.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ── Custom models ────────────────────────────────────── */}
        <section>
          <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>
            Custom
          </h3>
          {grouped.customs.length === 0 ? (
            <p className='text-xs text-gray-500'>No custom models added yet.</p>
          ) : (
            <ul className='divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-200'>
              {grouped.customs.map((m) => (
                <ModelRow
                  key={m.id}
                  model={m}
                  isActive={ai.activeModel?.id === m.id}
                  isLoading={isLoading && ai.activeModel?.id === m.id}
                  onSelect={() => void ai.select(m.id)}
                  onRemove={() => void handleRemove(m.id)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* ── Add custom ───────────────────────────────────────── */}
        <section className='border-t border-gray-200 pt-4'>
          {!showAdd ? (
            <button
              type='button'
              onClick={() => setShowAdd(true)}
              className='inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-300 px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              <Plus className='h-3.5 w-3.5' aria-hidden='true' />
              Add custom model
            </button>
          ) : (
            <AddCustomModelForm
              onComplete={(e) => void handleAdd(e)}
              onCancel={() => setShowAdd(false)}
            />
          )}
        </section>
      </div>
    </BaseModal>
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
    <section className='rounded-md border border-gray-200 bg-gray-50 p-3'>
      <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>
        Model configuration
      </h3>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <label className='flex flex-col gap-1'>
          <span className='text-[11px] font-medium text-gray-600'>Context size</span>
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
            className='h-8 rounded border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
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
        <div className='flex flex-col gap-1'>
          <span className='text-[11px] font-medium text-gray-600'>Tools</span>
          <div
            role='radiogroup'
            aria-label='Tools'
            className='inline-flex h-8 w-fit overflow-hidden rounded border border-gray-300 bg-white'
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
                    ? 'bg-blue-50 px-3 text-xs font-medium text-blue-700'
                    : 'px-3 text-xs text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
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
// Model row
// ─────────────────────────────────────────────────────────────────────

interface ModelRowProps {
  model: ModelEntry
  isActive: boolean
  isLoading: boolean
  onSelect: () => void
  onRemove?: () => void
}

function ModelRow({ model, isActive, isLoading, onSelect, onRemove }: ModelRowProps) {
  const sourceKindLabel: Record<ModelEntry['sourceKind'], string> = {
    registry: 'registry',
    file: 'file',
    https: 'URL',
    http: 'URL'
  }

  return (
    <li
      className={
        isActive
          ? 'flex items-center gap-2 bg-blue-50 px-3 py-2 text-xs'
          : 'flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-50'
      }
    >
      <button
        type='button'
        onClick={onSelect}
        disabled={isLoading}
        aria-pressed={isActive}
        className='flex-1 text-left disabled:cursor-not-allowed'
      >
        <div className='flex items-center gap-2'>
          <span className='font-medium text-gray-800'>{model.name}</span>
          <span className='rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-gray-600'>
            {sourceKindLabel[model.sourceKind]}
          </span>
          {model.params && (
            <span className='rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600'>
              {model.params}
            </span>
          )}
          {model.quantization && (
            <span className='rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600'>
              {model.quantization}
            </span>
          )}
        </div>
        {model.description && (
          <p className='mt-0.5 text-[10px] text-gray-500'>{model.description}</p>
        )}
      </button>
      {isLoading && <span className='text-[10px] font-medium text-yellow-700'>loading…</span>}
      {isActive && !isLoading && (
        <span className='text-[10px] font-medium text-blue-700'>loaded</span>
      )}
      {onRemove && (
        <button
          type='button'
          onClick={onRemove}
          aria-label={`Remove ${model.name}`}
          className='inline-flex h-6 w-6 items-center justify-center rounded text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300'
        >
          <Trash2 className='h-3 w-3' aria-hidden='true' />
        </button>
      )}
    </li>
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
    <div className='flex flex-col gap-3'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-gray-500'>
        Add custom model
      </h3>

      {/* Mode toggle */}
      <div className='inline-flex w-fit overflow-hidden rounded border border-gray-300'>
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
                ? 'bg-blue-600 px-3 py-1 text-[11px] font-medium text-white'
                : 'border-r border-gray-300 bg-white px-3 py-1 text-[11px] font-medium text-gray-700 last:border-r-0 hover:bg-gray-50'
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
          <label className='text-[10px] font-medium uppercase tracking-wide text-gray-500'>
            GGUF file
          </label>
          <div className='flex items-center gap-2'>
            <input
              type='text'
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder='Click “Browse…” to pick a .gguf file'
              readOnly
              className='h-8 flex-1 rounded border border-gray-300 px-2 font-mono text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
            <button
              type='button'
              onClick={() => void handlePickFile()}
              disabled={picking}
              className='inline-flex h-8 items-center rounded-md border border-blue-500 px-3 text-[11px] font-medium uppercase text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
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
          className='rounded-md bg-tamarind-700 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-tamarind-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
        >
          Add model
        </button>
        <button
          type='button'
          onClick={onCancel}
          className='rounded-md border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
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
      <span className='text-[10px] font-medium uppercase tracking-wide text-gray-500'>{label}</span>
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-8 rounded border border-gray-300 px-2 text-xs text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          monospace ? 'font-mono' : ''
        }`}
      />
    </label>
  )
}
