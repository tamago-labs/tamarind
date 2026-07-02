import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Loader2, LogIn, Pencil, Sparkles } from 'lucide-react'
import type { Me, RoomRole } from '../hooks/useRoom'
import { InviteJoinModal } from './InviteJoinModal'
import { NameEditModal } from './NameEditModal'

interface SplashPageProps {
  role: RoomRole | null
  invite: string | null
  writable: boolean
  error: string | null
  me: Me | null
  onOpenCanvas: () => void
  // Switch host → guest mid-session. Triggers a worker restart in
  // main.js with `--invite <code>`; the splash stays mounted while the
  // new worker boots and the role flips to 'guest'.
  onJoinInvite: (invite: string) => void
  // Per-session display-name change. Pipes to `bridge.writeRoom({type:
  // 'rename-self', name})` in the worker; the worker re-emits `me` so
  // the splash label updates without waiting for a snapshot.
  onRenameSelf: (name: string) => void
}

export function SplashPage({
  role,
  invite,
  writable,
  error,
  me,
  onOpenCanvas,
  onJoinInvite,
  onRenameSelf
}: SplashPageProps) {
  const [copied, setCopied] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [showNameEdit, setShowNameEdit] = useState(false)

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
  // "joining" reflects an in-flight join attempt (modal submitted, worker
  // not yet back). The splash spinner reads this to swap its copy.
  const joining = !ready && showJoin && role === null

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

      {/* "Signed in as <name>" — clickable to open the name-edit modal.
          Sits above the spinner / invite state so the user's identity is
          visible from the moment the worker emits the `me` frame.
          Hidden until that frame arrives (the name is unknown before
          then, and the pencil affordance would be misleading). */}
      {me && (
        <button
          type='button'
          onClick={() => setShowNameEdit(true)}
          aria-label='Change display name'
          className='mt-6 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30'
        >
          <span className='text-white/60'>Signed in as</span>
          <span className='font-semibold text-white'>{me.name}</span>
          <Pencil className='h-3 w-3 text-white/60' aria-hidden='true' />
        </button>
      )}

      {!ready && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className='mt-6 flex items-center gap-3 text-sm text-white/80'
        >
          <Loader2 className='h-4 w-4 animate-spin text-tamarind-300' aria-hidden='true' />
          <span>
            {error
              ? `Failed to start Tamarind: ${error}`
              : joining
                ? `Joining with invite\u2026`
                : role === null
                  ? 'Preparing Tamarind workspace\u2026'
                  : 'Starting Tamarind\u2026'}
          </span>
        </motion.div>
      )}

      {ready && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className='mt-6 flex flex-col items-center gap-4 px-6 text-center'
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

      {/* "Join existing board" — always available so a second Tamarind
          instance can switch from default-host to guest without needing
          to relaunch with `--invite` on the CLI. The actual paste-and-
          submit UX lives in the shared `InviteJoinModal` so other
          surfaces (toolbar quick-join, future deep-link landing) can
          reuse the same animated dialog. */}
      <button
        type='button'
        onClick={() => setShowJoin(true)}
        aria-label='Join existing board'
        className='mt-6 inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30'
      >
        <LogIn className='h-3.5 w-3.5' aria-hidden='true' />
        Join existing board
      </button>

      <InviteJoinModal
        open={showJoin}
        onClose={() => setShowJoin(false)}
        onSubmit={(code) => {
          setShowJoin(false)
          onJoinInvite(code)
        }}
        busy={joining}
      />

      <NameEditModal
        open={showNameEdit}
        currentName={me?.name ?? ''}
        onClose={() => setShowNameEdit(false)}
        onSubmit={(name) => {
          onRenameSelf(name)
          setShowNameEdit(false)
        }}
      />
    </motion.div>
  )
}
