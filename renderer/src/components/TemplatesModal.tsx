// Templates modal. Shows a 2-per-row grid of pre-built layouts
// the user can drop into the current board. Each card has a hand-rolled
// SVG thumbnail (see `data/templatesThumbnails.tsx`) + a name + short
// description + an Insert button.
//
// Insert is optimistic: builds the items, calls `onInsert(items)`, and
// closes the modal. `CanvasPage.handleInsertTemplate` does the
// `dispatchAction({type:'add-items', ...})` + selection update.

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
      subtitle='Pre-built layouts for common scenarios.'
      className='max-w-5xl'
      variant='canvas'
      footer={
        <button
          type='button'
          onClick={onClose}
          className='inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-tamarind-300'
        >
          Close
        </button>
      }
    >
      <div className='grid grid-cols-2 gap-4'>
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className='flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3'
          >
            <TemplateThumbnail id={tpl.id} style={{ aspectRatio: '8 / 5' }} />
            <div className='flex flex-col gap-0.5'>
              <h3 className='text-sm font-semibold text-gray-800'>{tpl.name}</h3>
              <p className='text-xs text-gray-600'>{tpl.description}</p>
            </div>
            <button
              type='button'
              onClick={() => onInsert(tpl.build('', Date.now()))}
              className='inline-flex h-8 items-center justify-center rounded-md bg-gray-800 px-3 text-xs font-semibold text-white transition hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400'
            >
              Insert
            </button>
          </div>
        ))}
      </div>
    </BaseModal>
  )
}
