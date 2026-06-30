import { motion } from 'framer-motion'
import { Loader2, Sparkles } from 'lucide-react'

export function SplashPage() {
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

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        className='mt-10 flex items-center gap-3 text-sm text-white/80'
      >
        <Loader2 className='h-4 w-4 animate-spin text-tamarind-300' aria-hidden='true' />
        <span>Starting Tamarind&hellip;</span>
      </motion.div>
    </motion.div>
  )
}
