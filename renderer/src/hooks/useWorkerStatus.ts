import { useEffect, useState } from 'react'
import { bridge } from '../lib/bridge'

const MAIN_WORKER = '/workers/main.js'

export type WorkerStatus = 'starting' | 'running' | 'exited' | 'error'

// The main worker is an app-lifetime process; start it at most once and let
// every component re-register its own exit listener independently. Module-scope
// state keeps the start idempotent under React StrictMode's mount/unmount/mount.
let startPromise: Promise<boolean> | null = null

function ensureWorkerStarted(): Promise<boolean> {
  if (startPromise) return startPromise
  const promise = bridge.startWorker(MAIN_WORKER).catch((err: unknown) => {
    console.error('Failed to start worker:', err)
    startPromise = null
    throw err
  })
  startPromise = promise
  return promise
}

export function useWorkerStatus(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>('starting')

  useEffect(() => {
    let cancelled = false
    let offExit: (() => void) | null = null

    ensureWorkerStarted()
      .then(() => {
        if (cancelled) return
        offExit = bridge.onWorkerExit(MAIN_WORKER, (code) => {
          if (cancelled) return
          setStatus(code === 0 ? 'exited' : 'error')
        })
        setStatus('running')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => {
      cancelled = true
      offExit?.()
    }
  }, [])

  return status
}
