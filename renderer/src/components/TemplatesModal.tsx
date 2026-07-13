// Templates modal. Shows templates organised by category with
// horizontal tabs. Each category has a 4-per-row grid of templates
// with thumbnails and Insert buttons.

import { useState } from 'react'
import { BaseModal } from './BaseModal'
import { TEMPLATES, CATEGORIES } from '../data/templates'
import type { Template } from '../data/templates'
import { TemplateThumbnail } from '../data/templatesThumbnails'

export interface TemplatesModalProps {
  open: boolean
  onClose: () => void
  onInsert: (template: Template) => void
}

export function TemplatesModal({ open, onClose, onInsert }: TemplatesModalProps) {
  const [selectedCategory, setSelectedCategory] = useState(CATEGORIES[0].id)

  const filteredTemplates = TEMPLATES.filter((t) => t.category === selectedCategory)

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='Templates'
      subtitle='Pre-built layouts for common scenarios.'
      className='h-[80vh] w-[80vw] max-w-none'
      variant='canvas'
    >
      <div className='flex flex-col'>
        {/* Category tabs */}
        <div className='flex gap-1 border-b border-gray-200 px-4 pb-2'>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type='button'
              onClick={() => setSelectedCategory(cat.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                selectedCategory === cat.id
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <span>{cat.icon}</span>
              <span>{cat.name}</span>
            </button>
          ))}
        </div>

        {/* Templates grid */}
        <div className='flex-1 overflow-auto p-4'>
          <div className='grid grid-cols-4 gap-4'>
            {filteredTemplates.map((tpl) => (
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
                  onClick={() => onInsert(tpl)}
                  className='inline-flex h-8 items-center justify-center rounded-md bg-gray-800 px-3 text-xs font-semibold text-white transition hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400'
                >
                  Insert
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BaseModal>
  )
}
