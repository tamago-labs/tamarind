// Right-side properties drawer. Hidden when nothing is selected;
// shows shape-conditional controls otherwise. Every control calls
// `onUpdate(item.id, { field: value })` so the changes flow through
// the same `update-item` action as resize and inline text editing.
//
// Stroke width uses `onChange` (fires on commit) rather than `onInput`
// to avoid dispatching one action per pixel during slider drag — the
// native range element commits on mouse-up, which is the right cadence.
//
// Colour pickers use the native `<input type="color">` for now. It's
// ugly but works everywhere; a swatch palette is a follow-up.

import type { BoardScopedItem, LineCap } from '../canvas/types'

interface PropertiesDrawerProps {
  selectedItem: BoardScopedItem | null
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
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

export function PropertiesDrawer({ selectedItem, onUpdate }: PropertiesDrawerProps) {
  if (!selectedItem) {
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

  const item = selectedItem
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

      {item.type === 'note' && <NoteSection item={item} onUpdate={onUpdate} id={id} />}

      {(item.type === 'line' || item.type === 'arrow') && (
        <LineSection item={item} onUpdate={onUpdate} id={id} />
      )}
    </aside>
  )
}

function NoteSection({
  item,
  onUpdate,
  id
}: {
  item: BoardScopedItem
  onUpdate: PropertiesDrawerProps['onUpdate']
  id: string
}) {
  if (item.type !== 'note') return null
  return (
    <div>
      <SectionTitle>Text</SectionTitle>
      <textarea
        value={item.text ?? ''}
        onChange={(e) => onUpdate(id, { text: e.target.value })}
        aria-label='Note text'
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

function LineSection({
  item,
  onUpdate,
  id
}: {
  item: BoardScopedItem
  onUpdate: PropertiesDrawerProps['onUpdate']
  id: string
}) {
  if (item.type !== 'line' && item.type !== 'arrow') return null
  const value: LineCap = item.lineCap ?? 'round'
  return (
    <div>
      <SectionTitle>Line</SectionTitle>
      <Field label='Cap'>
        <select
          value={value}
          onChange={(e) => onUpdate(id, { lineCap: e.target.value as LineCap })}
          aria-label='Line cap'
          className='h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none'
        >
          <option value='round'>Round</option>
          <option value='butt'>Butt</option>
          <option value='square'>Square</option>
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
