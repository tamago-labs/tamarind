import { ReactNode, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'

// Shared animated dialog primitive. Wraps the framer-motion backdrop +
// scale-in card, header (icon + title + close), optional hint, body, and
// footer slots. Concrete modals (InviteJoinModal, NameEditModal, future
// confirm dialogs) compose this rather than re-implementing the
// AnimatePresence / focus / escape / busy plumbing. `busy` is the only
// stateful knob — when true, the close button is disabled and the Escape
// handler no-ops so the user can't dismiss mid-submit.

export interface BaseModalProps {
  open: boolean
  onClose: () => void
  title: string
  hint?: string
  // Small icon rendered next to the title (e.g. <LogIn />).
  icon?: ReactNode
  // Disables the close button and the Escape-to-close handler so the
  // dialog can't be dismissed mid-submit. Backdrop click still closes
  // unless callers want to guard that at the call site.
  busy?: boolean
  children: ReactNode
  // Footer content (typically Cancel + Submit buttons). Rendered in a
  // right-aligned row.
  footer?: ReactNode
  // Extra classes for the inner dialog card.
  className?: string
  ariaLabel?: string
}

export function BaseModal({
  open,
  onClose,
  title,
  hint,
  icon,
  busy = false,
  children,
  footer,
  className = '',
  ariaLabel
}: BaseModalProps) {
  // Escape closes the modal (unless busy). Window-level listener because
  // the input inside the modal might not have focus when the user mashes
  // Escape at e.g. an empty backdrop.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key='backdrop'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          onClick={busy ? undefined : onClose}
          className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm'
          role='dialog'
          aria-modal='true'
          aria-label={ariaLabel ?? title}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-lg border border-white/10 bg-gradient-to-br from-tamarind-700 to-tamarind-900 p-6 shadow-2xl ${className}`}
          >
            <div className='flex items-start justify-between gap-4'>
              <div className='flex items-center gap-2'>
                {icon}
                <h2 className='text-lg font-semibold text-white'>{title}</h2>
              </div>
              <button
                type='button'
                onClick={onClose}
                disabled={busy}
                aria-label='Close'
                className='inline-flex h-7 w-7 items-center justify-center rounded text-white/70 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>

            {hint && <p className='mt-2 text-sm text-white/70'>{hint}</p>}

            <div className='mt-4'>{children}</div>

            {footer && <div className='mt-5 flex items-center justify-end gap-2'>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
