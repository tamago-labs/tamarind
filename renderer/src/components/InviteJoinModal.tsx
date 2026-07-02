import { useEffect, useRef, useState } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { BaseModal } from './BaseModal'

// "Paste-a-code-and-join" modal. Originally lived inline in
// SplashPage; lifted here so other surfaces (CanvasToolbar quick-join,
// future deep-link landing) can reuse the same animated dialog without
// duplicating the focus / escape / busy-state plumbing. The submit
// callback receives the trimmed code; the parent owns the actual join
// (e.g. `bridge.joinWithInvite`) so this stays pure UI.

export interface InviteJoinModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (code: string) => void
  // Disable inputs + submit while the parent is mid-join (worker restart,
  // async invite lookup, etc.). Shows a spinner in place of the submit
  // label.
  busy?: boolean
  // Short helper text above the input. Defaults to the splash's voice.
  hint?: string
  // Optional pre-fill — useful when wiring clipboard-read on open.
  initialValue?: string
  title?: string
  submitLabel?: string
}

export function InviteJoinModal({
  open,
  onClose,
  onSubmit,
  busy = false,
  hint = 'Paste the invite code shared by your peer to join their board.',
  initialValue = '',
  title = 'Join existing board',
  submitLabel = 'Join'
}: InviteJoinModalProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset value when reopened; auto-focus the input on the next tick so
  // the dialog has actually painted before we steal focus.
  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open, initialValue])

  const trimmed = value.trim()
  const canSubmit = trimmed.length > 0 && !busy

  function handleSubmit() {
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={title}
      hint={hint}
      busy={busy}
      icon={<LogIn className='h-5 w-5 text-tamarind-300' aria-hidden='true' />}
      footer={
        <>
          <button
            type='button'
            onClick={onClose}
            disabled={busy}
            className='inline-flex h-9 items-center rounded-md border border-white/20 bg-white/5 px-4 text-sm font-medium text-white/80 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-50'
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={handleSubmit}
            disabled={!canSubmit}
            className='inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-4 text-sm font-semibold text-tamarind-700 transition hover:bg-white/90 focus:outline-none focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {busy && <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden='true' />}
            {busy ? 'Joining…' : submitLabel}
          </button>
        </>
      }
    >
      <label htmlFor='invite-join-modal-input' className='sr-only'>
        Invite code
      </label>
      <input
        id='invite-join-modal-input'
        ref={inputRef}
        type='text'
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder='e.g. yrya…'
        spellCheck={false}
        autoComplete='off'
        disabled={busy}
        className='h-9 w-full rounded border border-white/20 bg-white/10 px-3 font-mono text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-60'
      />
    </BaseModal>
  )
}
