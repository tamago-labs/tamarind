import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { CanvasPage } from './components/CanvasPage'
import { SplashPage } from './components/SplashPage'
import { useWorkerStatus } from './hooks/useWorkerStatus'

const SPLASH_MIN_MS = 2500

type Phase = 'splash' | 'canvas'

export function App() {
  const status = useWorkerStatus()
  const [phase, setPhase] = useState<Phase>('splash')

  useEffect(() => {
    if (status !== 'running') return
    const handle = setTimeout(() => setPhase('canvas'), SPLASH_MIN_MS)
    return () => clearTimeout(handle)
  }, [status])

  return (
    <AnimatePresence mode='wait'>
      {phase === 'splash' ? <SplashPage /> : <CanvasPage />}
    </AnimatePresence>
  )
}
