import { useState } from 'react'
import { useWorkerStatus, type WorkerStatus } from '../hooks/useWorkerStatus'
import { useAI } from '../hooks/useAI'
import { AIModelModal } from './AIModelModal'

const STATUS_META = {
  starting: { label: 'Starting…', dot: 'bg-yellow-300' },
  running: { label: 'Worker online', dot: 'bg-tamarind-500' },
  exited: { label: 'Worker stopped', dot: 'bg-gray-300' },
  error: { label: 'Worker error', dot: 'bg-red-400' }
} as const satisfies Record<WorkerStatus, { label: string; dot: string }>

export function CanvasFooter() {
  return (
    <footer className='flex h-8 w-full items-center justify-between border-t border-gray-200 bg-gray-100 px-4'>
      <AIModelPill />
      <WorkerStatusPill />
    </footer>
  )
}

// Phase 5: footer-left pill that surfaces AI status + opens the
// AIModal on click. Mirrors the worker-status pill on the right
// (driven by `useAI` instead of `useWorkerStatus`).
function AIModelPill() {
  const { isReady, activeModel, progress, error } = useAI()
  const [open, setOpen] = useState(false)

  const meta = isReady
    ? { text: `AI: ${activeModel?.name ?? 'loaded'}`, dot: 'bg-tamarind-500' }
    : error
      ? { text: 'AI: error — click to retry', dot: 'bg-red-400' }
      : progress
        ? {
            text: `AI: loading… ${Math.round(progress.percentage)}%`,
            dot: 'bg-yellow-300'
          }
        : { text: 'AI: not loaded', dot: 'bg-gray-300' }

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        title='Click to manage AI model'
        aria-label='Manage AI model'
        className='inline-flex h-6 items-center gap-2 rounded-md px-2 text-xs text-gray-700 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
      >
        <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden='true' />
        {meta.text}
      </button>
      <AIModelModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// Unchanged behavior from Phase 2 — extracted so the AI pill can sit
// on the left without restructuring the layout.
function WorkerStatusPill() {
  const status = useWorkerStatus()
  const { label, dot } = STATUS_META[status]
  return (
    <div className='flex items-center gap-2 text-xs text-gray-600' aria-live='polite'>
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden='true' />
      <span>{label}</span>
    </div>
  )
}
