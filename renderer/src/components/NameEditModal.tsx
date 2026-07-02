import { useEffect, useRef, useState } from 'react'
import { Loader2, User } from 'lucide-react'
import { BaseModal } from './BaseModal'

// Per-session display name editor. Names are kept in memory on the
// worker (and persisted to identity.json in the worker itself), so a
// host → guest swap via restartRoomWorker won't lose the chosen name
// — but a full Tamarind relaunch resets to the writer-pubkey-derived
// default. Editing routes through `useRoom.renameSelf` which calls
// `bridge.writeRoom({type:'rename-self', name})`.

export interface NameEditModalProps {
  open: boolean
  // The current display name. Used as the initial value when the modal
  // opens and to gate the Save button (disabled when the trimmed input
  // matches the current name).
  currentName: string
  onClose: () => void
  onSubmit: (name: string) => void
  busy?: boolean
}

export function NameEditModal({
  open,
  currentName,
  onClose,
  onSubmit,
  busy = false
}: NameEditModalProps) {
  const [name, setName] = useState(currentName)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset on open and select-all the existing name so typing replaces
  // it (matches macOS / Windows rename-in-place conventions).
  useEffect(() => {
    if (!open) return
    setName(currentName)
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(id)
  }, [open, currentName])

  const trimmed = name.trim()
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy

  function handleSubmit() {
    if (!canSubmit) return
    onSubmit(trimmed)
  }

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title='Change display name'
      hint='Per-session — resets when Tamarind restarts. Visible to peers in chat.'
      busy={busy}
      icon={<User className='h-5 w-5 text-tamarind-300' aria-hidden='true' />}
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
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label htmlFor='name-edit-modal-input' className='sr-only'>
        Display name
      </label>
      <input
        id='name-edit-modal-input'
        ref={inputRef}
        type='text'
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSubmit()
          }
        }}
        placeholder='e.g. Alice'
        spellCheck={false}
        autoComplete='off'
        disabled={busy}
        maxLength={32}
        className='h-9 w-full rounded border border-white/20 bg-white/10 px-3 text-sm text-white placeholder-white/40 focus:border-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 disabled:cursor-not-allowed disabled:opacity-60'
      />
    </BaseModal>
  )
}
