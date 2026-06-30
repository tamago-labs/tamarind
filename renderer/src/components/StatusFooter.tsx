import { motion } from 'framer-motion'
import { useWorkerStatus, type WorkerStatus } from '../hooks/useWorkerStatus'
import { usePkg } from '../hooks/usePkg'

export type FooterTheme = 'dark' | 'light'

const STATUS_META = {
  starting: { label: 'Starting…', dot: 'bg-yellow-300' },
  running: { label: 'Worker online', dot: 'bg-tamarind-300' },
  exited: { label: 'Worker stopped', dot: 'bg-white/40' },
  error: { label: 'Worker error', dot: 'bg-red-400' }
} as const satisfies Record<WorkerStatus, { label: string; dot: string }>

interface StatusFooterProps {
  theme?: FooterTheme
}

export function StatusFooter({ theme = 'dark' }: StatusFooterProps) {
  const status = useWorkerStatus()
  const pkg = usePkg()
  const { label, dot } = STATUS_META[status]
  const isLight = theme === 'light'
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8, duration: 0.4 }}
      className={`flex w-full items-center justify-between px-8 py-3 text-xs ${
        isLight ? 'text-tamarind-700/70' : 'text-white/60'
      }`}
    >
      <div className='flex items-center gap-2' aria-live='polite'>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden='true' />
        <span>{label}</span>
      </div>
      <span>
        {pkg.productName} &middot; v{pkg.version}
      </span>
    </motion.footer>
  )
}
