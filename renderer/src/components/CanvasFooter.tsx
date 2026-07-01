import { useWorkerStatus, type WorkerStatus } from '../hooks/useWorkerStatus'

const STATUS_META = {
  starting: { label: 'Starting…', dot: 'bg-yellow-300' },
  running: { label: 'Worker online', dot: 'bg-tamarind-500' },
  exited: { label: 'Worker stopped', dot: 'bg-gray-300' },
  error: { label: 'Worker error', dot: 'bg-red-400' }
} as const satisfies Record<WorkerStatus, { label: string; dot: string }>

export function CanvasFooter() {
  const status = useWorkerStatus()
  const { label, dot } = STATUS_META[status]
  return (
    <footer className='flex h-8 w-full items-center justify-end border-t border-gray-200 bg-gray-100 px-4'>
      <div className='flex items-center gap-2 text-xs text-gray-600' aria-live='polite'>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden='true' />
        <span>{label}</span>
      </div>
    </footer>
  )
}
