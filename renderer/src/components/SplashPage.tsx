import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Loader2, Sparkles } from 'lucide-react'
import type { RoomRole } from '../hooks/useRoom'

interface SplashPageProps {
  role: RoomRole | null
  invite: string | null
  writable: boolean
  error: string | null
  onOpenCanvas: () => void
}

export function SplashPage({ role, invite, writable, error, onOpenCanvas }: SplashPageProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    if (!invite) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(invite)
        .then(() => setCopied(true))
        .catch(() => {})
    }
  }

  const ready = role !== null && writable

  return (
    <motion.div
      key='splash'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className='flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-tamarind-500 via-tamarind-700 to-tamarind-900 text-white'
      role='status'
      aria-live='polite'
      aria-label='Starting Tamarind'
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.5, ease: 'easeOut' }}
        className='flex items-center gap-3'
      >
        <Sparkles className='h-10 w-10 text-tamarind-300' aria-hidden='true' />
        <span className='bg-gradient-to-r from-tamarind-300 via-white to-tamarind-50 bg-clip-text text-5xl font-extrabold tracking-tight text-transparent'>
          Tamarind
        </span>
      </motion.div>

      {!ready && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className='mt-10 flex items-center gap-3 text-sm text-white/80'
        >
          <Loader2 className='h-4 w-4 animate-spin text-tamarind-300' aria-hidden='true' />
          <span>
            {error
              ? `Failed to start Tamarind: ${error}`
              : role === null
                ? 'Connecting to local peers\u2026'
                : 'Starting Tamarind\u2026'}
          </span>
        </motion.div>
      )}

      {ready && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className='mt-10 flex flex-col items-center gap-4 px-6 text-center'
        >
          {role === 'host' && invite ? (
            <>
              <p className='text-sm text-white/80'>
                Share this invite to bring peers into this board
              </p>
              <div className='flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 backdrop-blur'>
                <code className='max-w-xs truncate font-mono text-xs text-white' title={invite}>
                  {invite}
                </code>
                <button
                  type='button'
                  onClick={handleCopy}
                  aria-label='Copy invite code'
                  className='inline-flex h-6 w-6 items-center justify-center rounded text-white/80 transition hover:bg-white/10'
                >
                  {copied ? (
                    <Check className='h-3.5 w-3.5 text-green-400' aria-hidden='true' />
                  ) : (
                    <Copy className='h-3.5 w-3.5' aria-hidden='true' />
                  )}
                </button>
              </div>
              <button
                type='button'
                onClick={onOpenCanvas}
                className='mt-2 inline-flex h-9 items-center rounded-md bg-white px-5 text-sm font-semibold text-tamarind-700 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/40'
              >
                Open whiteboard
              </button>
            </>
          ) : (
            <p className='text-sm text-white/80'>Joined. Loading canvas\u2026</p>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}
