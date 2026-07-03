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
//
// `variant` picks the card theme:
//   • 'splash' (default) — tamarind gradient + white text. Used for
//     modals that appear over the splash page (InviteJoinModal,
//     NameEditModal) where the green/white look matches the page.
//   • 'canvas' — solid white card + gray text. Used for modals that
//     appear over the canvas (TemplatesModal) where the green gradient
//     would clash with the white workspace.

export type BaseModalVariant = 'splash' | 'canvas'

export interface BaseModalProps {
  open: boolean
  onClose: () => void
  title: string
  // Fixed sub-title rendered under the title (e.g. "Set up AI so your
  // team can chat…"). Distinct from `hint`, which is reserved for
  // dynamic status (loading %, error, etc.).
  subtitle?: string
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
  variant?: BaseModalVariant
}

const VARIANT_CLASSES: Record<BaseModalVariant, string> = {
  splash:
    'border-white/10 bg-gradient-to-br from-tamarind-700 to-tamarind-900 [&_h2]:text-white [&_p]:text-white/70 [&_button[aria-label="Close"]]:text-white/70 [&_button[aria-label="Close"]]:hover:bg-white/10 [&_button[aria-label="Close"]]:focus:ring-white/30',
  canvas:
    'border-gray-200 bg-white [&_h2]:text-gray-800 [&_p]:text-gray-600 [&_button[aria-label="Close"]]:text-gray-500 [&_button[aria-label="Close"]]:hover:bg-gray-100 [&_button[aria-label="Close"]]:focus:ring-tamarind-300'
}

export function BaseModal({
  open,
  onClose,
  title,
  subtitle,
  hint,
  icon,
  busy = false,
  children,
  footer,
  className = '',
  ariaLabel,
  variant = 'splash'
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

  const variantClass = VARIANT_CLASSES[variant]

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
            className={`w-full max-w-md rounded-lg border p-6 shadow-2xl ${variantClass} ${className}`}
          >
            <div className='flex items-start justify-between gap-4'>
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <div className='flex items-center gap-2'>
                  {icon}
                  <h2 className='text-lg font-semibold'>{title}</h2>
                </div>
                {subtitle && <p className='mt-0.5 text-xs opacity-80'>{subtitle}</p>}
              </div>
              <button
                type='button'
                onClick={onClose}
                disabled={busy}
                aria-label='Close'
                className='inline-flex h-7 w-7 items-center justify-center rounded transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50'
              >
                <X className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>

            {hint && <p className='mt-2 text-sm'>{hint}</p>}

            <div className='mt-4 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1'>{children}</div>

            {footer && <div className='mt-5 flex items-center justify-end gap-2'>{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
