import { motion } from 'framer-motion'
import { Layout } from 'lucide-react'
import { AppHeader } from './AppHeader'
import { StatusFooter } from './StatusFooter'

export function CanvasPage() {
  return (
    <motion.div
      key='canvas'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className='flex h-full w-full flex-col bg-tamarind-50 text-tamarind-900'
    >
      <AppHeader theme='light' />
      <main className='flex flex-1 items-center justify-center px-8'>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.5, ease: 'easeOut' }}
          className='flex flex-col items-center text-center'
        >
          <div className='flex h-16 w-16 items-center justify-center rounded-2xl bg-tamarind-700 text-white shadow-lg'>
            <Layout className='h-8 w-8' aria-hidden='true' />
          </div>
          <h1 className='mt-6 text-3xl font-bold tracking-tight text-tamarind-900 sm:text-4xl'>
            Canvas
          </h1>
          <p className='mt-3 max-w-md text-sm text-tamarind-700/80'>
            Infinite canvas, sticky notes, and freehand drawing &mdash; coming in Sprint 1.
          </p>
          <p className='mt-1 text-xs uppercase tracking-widest text-tamarind-500'>
            Local-first &middot; P2P synced
          </p>
        </motion.div>
      </main>
      <StatusFooter theme='light' />
    </motion.div>
  )
}
