// Right-side properties drawer. Three modes:
//
//   • Nothing selected          — placeholder copy.
//   • Single shape selected     — full per-type panel. Note text input
//                                 uses local draft state: each keystroke
//                                 dispatches a transient `update-item`
//                                 (skips the history stack), and the
//                                 final value commits on blur.
//   • Multiple shapes selected  — count badge plus the *common* fields
//                                 only (fill, stroke, stroke width).
//                                 Changes broadcast to every selected
//                                 id. Shape-conditional sections
//                                 (text, line cap) are hidden.
//
// Stroke width uses `onChange` (fires on commit) rather than `onInput`
// to avoid dispatching one action per pixel during slider drag — the
// native range element commits on mouse-up, which is the right cadence.
//
// Colour pickers use the native `<input type="color">` for now. It's
// ugly but works everywhere; a swatch palette is a follow-up.

import { useEffect, useRef, useState } from 'react'
import type { BoardScopedItem, LineCap } from '../canvas/types'
import { useBlurHandler } from '../hooks/useBlur'

interface PropertiesDrawerProps {
  selectedItem: BoardScopedItem | null
  selectedCount: number
  selectedIds: string[]
  itemsById: Record<string, BoardScopedItem>
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onBringToFront: () => void
  onSendToBack: () => void
  // Slot rendered when `selectedCount === 0`. Phase 2 wires this to
  // the GroupChatPanel so the empty properties drawer doubles as
  // the chat + invite surface.
  emptyPanel?: React.ReactNode
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>{children}</h3>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className='mb-2 flex items-center justify-between gap-2 text-xs text-gray-700'>
      <span className='shrink-0'>{label}</span>
      <span className='flex items-center gap-1'>{children}</span>
    </label>
  )
}

export function PropertiesDrawer({
  selectedItem,
  selectedCount,
  selectedIds,
  itemsById,
  onUpdate,
  onTransientUpdate,
  onBringToFront,
  onSendToBack,
  emptyPanel
}: PropertiesDrawerProps) {
  if (selectedCount === 0) {
    if (emptyPanel) return <>{emptyPanel}</>
    return (
      <aside
        aria-label='Properties'
        className='flex w-72 shrink-0 flex-col gap-4 border-l border-gray-200 bg-gray-50 p-4 text-xs text-gray-500'
      >
        <SectionTitle>Properties</SectionTitle>
        <p>Select a shape to edit its properties.</p>
      </aside>
    )
  }

  if (selectedCount > 1) {
    return (
      <MultiSelectPanel
        itemsById={itemsById}
        selectedIds={selectedIds}
        onUpdate={onUpdate}
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
      />
    )
  }

  const item = selectedItem
  if (!item) {
    // Single-count but item is missing — race between delete and render.
    return (
      <aside
        aria-label='Properties'
        className='flex w-72 shrink-0 flex-col gap-4 border-l border-gray-200 bg-gray-50 p-4 text-xs text-gray-500'
      >
        <SectionTitle>Properties</SectionTitle>
        <p>Loading…</p>
      </aside>
    )
  }
  const id = item.id

  return (
    <aside
      aria-label='Properties'
      className='flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50 p-4'
    >
      <div>
        <SectionTitle>Type</SectionTitle>
        <div className='inline-flex h-7 items-center rounded-md bg-white px-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200'>
          {item.type}
        </div>
      </div>

      <div>
        <SectionTitle>Appearance</SectionTitle>
        <Field label='Fill'>
          <input
            type='color'
            value={normaliseColor(item.fill)}
            onChange={(e) => onUpdate(id, { fill: e.target.value })}
            aria-label='Fill colour'
            className='h-7 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0'
          />
        </Field>
        <Field label='Stroke'>
          <input
            type='color'
            value={normaliseColor(item.stroke)}
            onChange={(e) => onUpdate(id, { stroke: e.target.value })}
            aria-label='Stroke colour'
            className='h-7 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0'
          />
        </Field>
        <Field label='Stroke width'>
          <input
            type='range'
            min={1}
            max={10}
            step={0.5}
            value={item.strokeWidth}
            onChange={(e) => onUpdate(id, { strokeWidth: Number(e.target.value) })}
            aria-label='Stroke width'
            className='w-32'
          />
          <span className='w-8 text-right tabular-nums'>{item.strokeWidth}</span>
        </Field>
      </div>

      <ArrangeSection onBringToFront={onBringToFront} onSendToBack={onSendToBack} />

      {(item.type === 'rect' || item.type === 'ellipse' || item.type === 'text') && (
        <TextSection
          key={id}
          item={item}
          onUpdate={onUpdate}
          onTransientUpdate={onTransientUpdate}
          id={id}
        />
      )}

      {item.type === 'connector' && (
        <ConnectorSection
          item={item}
          onUpdate={onUpdate}
          onTransientUpdate={onTransientUpdate}
          id={id}
        />
      )}
    </aside>
  )
}

function MultiSelectPanel({
  itemsById,
  selectedIds,
  onUpdate,
  onBringToFront,
  onSendToBack
}: {
  itemsById: Record<string, BoardScopedItem>
  selectedIds: string[]
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onBringToFront: () => void
  onSendToBack: () => void
}) {
  // Multi-select may include lines / arrows / notes / shapes. We only
  // expose the *common* fields (fill, stroke, stroke width) so the
  // panel doesn't promise controls that have no coherent broadcast
  // value. The first selected item supplies the panel's current
  // values; changes dispatch per id.
  const first = itemsById[selectedIds[0]]
  if (!first) {
    return (
      <aside
        aria-label='Properties'
        className='flex w-72 shrink-0 flex-col gap-4 border-l border-gray-200 bg-gray-50 p-4 text-xs text-gray-500'
      >
        <SectionTitle>Properties</SectionTitle>
        <p>Loading…</p>
      </aside>
    )
  }
  return (
    <aside
      aria-label='Properties'
      className='flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50 p-4'
    >
      <div>
        <SectionTitle>Selection</SectionTitle>
        <div className='inline-flex h-7 items-center rounded-md bg-white px-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200'>
          {selectedIds.length} shapes selected
        </div>
      </div>
      <div>
        <SectionTitle>Appearance</SectionTitle>
        <p className='mb-2 text-xs text-gray-500'>Changes apply to every selected shape.</p>
        <Field label='Fill'>
          <input
            type='color'
            value={normaliseColor(first.fill)}
            onChange={(e) => broadcast(onUpdate, selectedIds, { fill: e.target.value })}
            aria-label='Fill colour'
            className='h-7 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0'
          />
        </Field>
        <Field label='Stroke'>
          <input
            type='color'
            value={normaliseColor(first.stroke)}
            onChange={(e) => broadcast(onUpdate, selectedIds, { stroke: e.target.value })}
            aria-label='Stroke colour'
            className='h-7 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0'
          />
        </Field>
        <Field label='Stroke width'>
          <input
            type='range'
            min={1}
            max={10}
            step={0.5}
            value={first.strokeWidth}
            onChange={(e) =>
              broadcast(onUpdate, selectedIds, { strokeWidth: Number(e.target.value) })
            }
            aria-label='Stroke width'
            className='w-32'
          />
          <span className='w-8 text-right tabular-nums'>{first.strokeWidth}</span>
        </Field>
      </div>

      <ArrangeSection onBringToFront={onBringToFront} onSendToBack={onSendToBack} />
    </aside>
  )
}

function broadcast(
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void,
  ids: string[],
  patch: Partial<BoardScopedItem>
) {
  for (const id of ids) onUpdate(id, patch)
}

// Stacking-order controls. Lives in the right drawer (not the toolbar)
// because glyph-only up/down arrows are ambiguous next to shape tools,
// and "Bring to front" / "Send to back" reads more naturally as a
// side-panel action alongside the other per-selection ops. Both
// buttons are full-width text labels — no tooltip-only affordance.
function ArrangeSection({
  onBringToFront,
  onSendToBack
}: {
  onBringToFront: () => void
  onSendToBack: () => void
}) {
  return (
    <div>
      <SectionTitle>Arrange</SectionTitle>
      <div className='flex flex-col gap-2'>
        <button
          type='button'
          onClick={onBringToFront}
          className='inline-flex h-8 w-full items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-800 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
        >
          Bring to front
        </button>
        <button
          type='button'
          onClick={onSendToBack}
          className='inline-flex h-8 w-full items-center justify-center rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-gray-800 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
        >
          Send to back
        </button>
      </div>
    </div>
  )
}

function TextSection({
  item,
  onUpdate,
  onTransientUpdate,
  id
}: {
  item: BoardScopedItem
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  id: string
}) {
  // Controlled-commit model. Each keystroke updates local `draft` and fires a
  // transient `update-item` (no history, no wire) so the canvas TextOverlay
  // mirrors the draft live. The authoritative network commit lands on blur.
  //
  // The parent mounts this with `key={id}`, so switching shapes remounts a
  // fresh instance seeded from the new item.text — no stale draft carries
  // over between shapes. Commit runs through a *native* blur listener
  // (useBlurHandler) rather than React's synthetic onBlur: when selecting a
  // different shape unmounts this subtree, the native blur still fires
  // synchronously during focus loss, before React tears the tree down.
  const [draft, setDraft] = useState(item.text ?? '')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirtyRef = useRef(false)
  // Last authoritative text we synced from. Distinguishes our own transient-
  // induced item.text moves from external changes (peer edit, snapshot).
  const lastSeenRef = useRef(item.text ?? '')

  const commit = () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    lastSeenRef.current = draftRef.current
    onUpdate(id, { text: draftRef.current })
  }
  // Always fire the latest commit closure from the blur listener / unmount
  // cleanup without re-attaching listeners on every render.
  const commitRef = useRef(commit)
  commitRef.current = commit
  const blurRef = useBlurHandler(() => commitRef.current())

  // Pull external changes only when there's no pending local edit. While
  // dirty, the worker's snapshots keep reverting item.text to the last
  // committed value; syncing here would wipe the in-progress draft and clear
  // dirtyRef, so the pending edit would never commit on blur.
  useEffect(() => {
    if (item.text === lastSeenRef.current) return
    lastSeenRef.current = item.text ?? ''
    if (dirtyRef.current) return
    if (item.text !== draftRef.current) setDraft(item.text ?? '')
  }, [item.text])

  // Safety net: commit a pending edit if the section unmounts (shape deleted,
  // selection cleared) without a preceding blur. dirtyRef guards double-commit
  // when blur already fired.
  useEffect(() => {
    return () => commitRef.current()
  }, [])

  return (
    <div>
      <SectionTitle>Text</SectionTitle>
      <textarea
        ref={blurRef}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          draftRef.current = next
          dirtyRef.current = true
          onTransientUpdate(id, { text: next })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            // Enter commits; Shift+Enter inserts a newline.
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            // Revert to the last authoritative text, then blur without commit.
            e.preventDefault()
            dirtyRef.current = false
            const reverted = lastSeenRef.current
            setDraft(reverted)
            draftRef.current = reverted
            onTransientUpdate(id, { text: reverted })
            e.currentTarget.blur()
          }
        }}
        aria-label='Shape text'
        rows={4}
        className='mb-2 w-full resize-none rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
      />
      <Field label='Font size'>
        <input
          type='range'
          min={8}
          max={48}
          step={1}
          value={item.fontSize ?? 12}
          onChange={(e) => onUpdate(id, { fontSize: Number(e.target.value) })}
          aria-label='Font size'
          className='w-32'
        />
        <span className='w-8 text-right tabular-nums'>{item.fontSize ?? 12}</span>
      </Field>
    </div>
  )
}

function ConnectorSection({
  item,
  onUpdate,
  onTransientUpdate,
  id
}: {
  item: BoardScopedItem
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  id: string
}) {
  if (item.type !== 'connector') return null
  const cap: LineCap = item.lineCap ?? 'round'
  // The label uses the same controlled-commit pattern as TextSection —
  // every keystroke fires a transient update so the canvas chip mirrors
  // the draft live, then blur / Enter commits the authoritative value.
  const [draft, setDraft] = useState(item.label?.text ?? '')
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirtyRef = useRef(false)
  const lastSeenRef = useRef(item.label?.text ?? '')

  const commit = () => {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    lastSeenRef.current = draftRef.current
    const text = draftRef.current
    if (text === '') {
      // Empty string clears the label entirely.
      onUpdate(id, { label: undefined })
    } else {
      onUpdate(id, {
        label: {
          text,
          at: item.label?.at ?? 'middle'
        }
      })
    }
  }
  const commitRef = useRef(commit)
  commitRef.current = commit
  const blurRef = useBlurHandler(() => commitRef.current())

  useEffect(() => {
    const seen = item.label?.text ?? ''
    if (seen === lastSeenRef.current) return
    lastSeenRef.current = seen
    if (dirtyRef.current) return
    if (seen !== draftRef.current) setDraft(seen)
  }, [item.label?.text])

  useEffect(() => {
    return () => commitRef.current()
  }, [])

  return (
    <div>
      <SectionTitle>Connector</SectionTitle>
      <Field label='Start'>
        <select
          value={item.arrowStart ?? 'none'}
          onChange={(e) => onUpdate(id, { arrowStart: e.target.value as 'none' | 'arrow' })}
          aria-label='Start arrowhead'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='none'>None</option>
          <option value='arrow'>Arrow</option>
        </select>
      </Field>
      <Field label='End'>
        <select
          value={item.arrowEnd ?? 'arrow'}
          onChange={(e) => onUpdate(id, { arrowEnd: e.target.value as 'none' | 'arrow' })}
          aria-label='End arrowhead'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='none'>None</option>
          <option value='arrow'>Arrow</option>
        </select>
      </Field>
      <Field label='Style'>
        <select
          value={item.strokePattern ?? 'solid'}
          onChange={(e) =>
            onUpdate(id, { strokePattern: e.target.value as 'solid' | 'dashed' | 'dotted' })
          }
          aria-label='Stroke pattern'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='solid'>Solid</option>
          <option value='dashed'>Dashed</option>
          <option value='dotted'>Dotted</option>
        </select>
      </Field>
      <Field label='Curve'>
        <select
          value={item.curve ?? 'straight'}
          onChange={(e) => onUpdate(id, { curve: e.target.value as 'straight' | 'bezier' })}
          aria-label='Curve'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='straight'>Straight</option>
          <option value='bezier'>Bezier</option>
        </select>
      </Field>
      <Field label='Cap'>
        <select
          value={cap}
          onChange={(e) => onUpdate(id, { lineCap: e.target.value as LineCap })}
          aria-label='Line cap'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='round'>Round</option>
          <option value='butt'>Butt</option>
          <option value='square'>Square</option>
        </select>
      </Field>
      <p className='mb-1 text-[10px] uppercase tracking-wide text-gray-500'>Label</p>
      <input
        ref={blurRef}
        value={draft}
        onChange={(e) => {
          const next = e.target.value
          setDraft(next)
          draftRef.current = next
          dirtyRef.current = true
          // Live transient patch so the on-canvas chip updates as the
          // user types.
          onTransientUpdate(id, {
            label: { text: next, at: item.label?.at ?? 'middle' }
          })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            dirtyRef.current = false
            const reverted = lastSeenRef.current
            setDraft(reverted)
            draftRef.current = reverted
            onTransientUpdate(id, {
              label: reverted ? { text: reverted, at: item.label?.at ?? 'middle' } : undefined
            })
            e.currentTarget.blur()
          }
        }}
        placeholder='e.g. pass'
        aria-label='Connector label text'
        className='mb-2 h-7 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
      />
      <Field label='Position'>
        <select
          value={item.label?.at ?? 'middle'}
          onChange={(e) => {
            const at = e.target.value as 'start' | 'middle' | 'end'
            const text = item.label?.text ?? draft
            onUpdate(id, text ? { label: { text, at } } : { label: undefined })
          }}
          aria-label='Label position'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='start'>Start</option>
          <option value='middle'>Middle</option>
          <option value='end'>End</option>
        </select>
      </Field>
    </div>
  )
}

// `<input type="color">` only accepts #rrggbb. The default fill is
// rgba(...) which we'd otherwise reject. We coerce any rgba/hex to a
// safe 6-digit hex for the picker; the value is saved back verbatim
// otherwise.
function normaliseColor(value: string | undefined): string {
  if (!value) return '#000000'
  if (value.startsWith('#') && value.length === 7) return value
  // For rgba(...) values, fall back to a transparent placeholder so
  // the picker doesn't error. The real value is preserved in state.
  return '#000000'
}
