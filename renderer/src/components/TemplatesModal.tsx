// Templates modal. Shows a single horizontal row of pre-built layouts
// the user can drop into the current board. Each card has a hand-rolled
// SVG thumbnail (see `data/templatesThumbnails.tsx`) + a name + short
// description + an Insert button.
//
// Insert is optimistic: builds the items, calls `onInsert(items)`, and
// closes the modal. `CanvasPage.handleInsertTemplate` does the
// `dispatchAction({type:'add-items', ...})` + selection update.

import { LayoutTemplate } from 'lucide-react'
import { BaseModal } from './BaseModal'
import type { BoardScopedItem } from '../canvas/types'
import { TEMPLATES } from '../data/templates'
import { TemplateThumbnail } from '../data/templatesThumbnails'

export interface TemplatesModalProps {
  open: boolean
  onClose: () => void
  // Receives the freshly-built items (already stamped with boardId +
  // updatedAt + fresh ids by the caller). Caller is responsible for
  // dispatching the `add-items` action and closing the modal.
  onInsert: (items: BoardScopedItem[]) => void
}

export function TemplatesModal({ open, onClose, onInsert }: TemplatesModalProps) {
  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='Templates'
      hint='Pick a starting layout — every shape stays draggable and editable.'
      icon={<LayoutTemplate className='h-5 w-5 text-tamarind-300' aria-hidden='true' />}
      className='max-w-5xl'
      footer={
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md border border-white/20 bg-white/5 px-4 text-sm font-medium text-white/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30'
        >
          Close
        </button>
      }
    >
      <div className='-mx-1 flex flex-row gap-3 overflow-x-auto px-1 pb-1'>
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className='flex w-56 shrink-0 flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3'
          >
            <TemplateThumbnail id={tpl.id} style={{ aspectRatio: '8 / 5' }} />
            <div className='flex flex-col gap-0.5'>
              <h3 className='text-sm font-semibold text-white'>{tpl.name}</h3>
              <p className='text-xs text-white/70'>{tpl.description}</p>
            </div>
            <button
              type='button'
              onClick={() => onInsert(tpl.build('', Date.now()))}
              className='inline-flex h-8 items-center justify-center rounded-md bg-white px-3 text-xs font-semibold text-tamarind-700 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/40'
            >
              Insert
            </button>
          </div>
        ))}
      </div>
    </BaseModal>
  )
}
