// SlideInPanel — animated panel that slides in from the left or right.
// Uses framer-motion for smooth entry/exit animation. Renders a
// semi-transparent backdrop that closes the panel on click.

import { type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

interface SlideInPanelProps {
  open: boolean
  onClose: () => void
  side: 'left' | 'right'
  title: string
  children: ReactNode
}

export function SlideInPanel({ open, onClose, side, title, children }: SlideInPanelProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key='backdrop'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className='fixed inset-0 z-40 bg-black/30'
          />

          {/* Panel */}
          <motion.div
            key='panel'
            initial={{ x: side === 'left' ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'left' ? '-100%' : '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed top-0 ${side === 'left' ? 'left-0' : 'right-0'} z-50 flex h-full w-96 flex-col border-gray-200 bg-gray-50 shadow-xl ${
              side === 'left' ? 'border-r' : 'border-l'
            }`}
          >
            {/* Header */}
            <div className='flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4'>
              <h2 className='text-sm font-semibold text-gray-800'>{title}</h2>
              <button
                type='button'
                onClick={onClose}
                aria-label='Close panel'
                className='inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>

            {/* Content */}
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden p-3'>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
