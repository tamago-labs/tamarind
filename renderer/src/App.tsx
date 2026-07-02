import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { CanvasPage } from './components/CanvasPage'
import { SplashPage } from './components/SplashPage'
import { useRoom, type RoomRole } from './hooks/useRoom'
import { useWorkerStatus } from './hooks/useWorkerStatus'

type Phase = 'splash' | 'canvas'

// No fixed minimum splash duration — the splash exits as soon as the
// room worker reports `ready` (for guests) or after the host dismisses
// the invite code reveal (for hosts).
export function App() {
  const status = useWorkerStatus()
  const room = useRoom()
  const [phase, setPhase] = useState<Phase>('splash')
  const [hostDismissed, setHostDismissed] = useState(false)

  // Auto-transition once the room is writable. In a host scenario the
  // user may want to copy the invite code from the splash first, so we
  // expose a manual "Open canvas" affordance in SplashPage via the
  // `hostDismissed` flag instead of forcing a timer.
  useEffect(() => {
    if (phase !== 'splash') return
    if (status !== 'running') return
    if (room.status !== 'ready') return
    if (room.role === 'host' && !hostDismissed) return
    setPhase('canvas')
  }, [phase, status, room.status, room.role, hostDismissed])

  return (
    <AnimatePresence mode='wait'>
      {phase === 'splash' ? (
        <SplashPage
          role={room.role as RoomRole | null}
          invite={room.invite}
          writable={room.writable}
          me={room.me}
          error={room.error ?? (status === 'error' ? 'Updater worker exited unexpectedly.' : null)}
          onOpenCanvas={() => {
            setHostDismissed(true)
            setPhase('canvas')
          }}
          onJoinInvite={room.joinInvite}
          onRenameSelf={room.renameSelf}
        />
      ) : (
        <CanvasPage />
      )}
    </AnimatePresence>
  )
}
