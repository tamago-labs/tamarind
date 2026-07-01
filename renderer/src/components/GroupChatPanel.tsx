// Group chat panel shown in the right-hand PropertiesDrawer when
// nothing is selected. Hosts:
//   • Invite code (with copy button) — visible only to host
//   • Peer count + role badge
//   • Chat history (newest at the bottom), labelled by writer pubkey
//     ("You" for messages from the local writer; otherwise the
//     writer's display name or the pubkey prefix)
//   • Send input — disabled until the room is writable

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Send } from 'lucide-react'
import type { ChatMessage } from '../lib/chat'
import type { RoomRole } from '../hooks/useRoom'

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>{children}</h3>
  )
}

interface GroupChatPanelProps {
  invite: string | null
  peers: number
  messages: ChatMessage[]
  role: RoomRole | null
  writable: boolean
  me: { key: string; name: string } | null
  onSendChat: (text: string) => void
  onCopyInvite: () => void
}

export function GroupChatPanel({
  invite,
  peers,
  messages,
  role,
  writable,
  me,
  onSendChat,
  onCopyInvite
}: GroupChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the most recent message on new content.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Reset the "Copied!" pill after a moment.
  useEffect(() => {
    if (!copied) return
    const handle = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(handle)
  }, [copied])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!writable) return
    const text = draft.trim()
    if (!text) return
    onSendChat(text)
    setDraft('')
  }

  return (
    <aside
      aria-label='Group'
      className='flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-gray-50 p-4'
    >
      <div>
        <SectionTitle>Group</SectionTitle>
        {invite && role === 'host' ? (
          <div className='flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5'>
            <code className='flex-1 truncate font-mono text-xs text-gray-800' title={invite}>
              {invite}
            </code>
            <button
              type='button'
              onClick={() => {
                onCopyInvite()
                setCopied(true)
              }}
              aria-label='Copy invite code'
              title='Copy invite code'
              className='inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              {copied ? (
                <Check className='h-3.5 w-3.5 text-green-600' aria-hidden='true' />
              ) : (
                <Copy className='h-3.5 w-3.5' aria-hidden='true' />
              )}
            </button>
          </div>
        ) : (
          <p className='text-xs text-gray-500'>
            {role === 'guest' ? 'Joined the host\u2019s room.' : 'Minting invite code\u2026'}
          </p>
        )}
        <p className='mt-1 text-xs text-gray-500'>
          {peers} {peers === 1 ? 'peer' : 'peers'} connected
          {role ? ` \u00b7 ${role === 'host' ? 'You host' : 'You joined'}` : ''}
        </p>
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-2'>
        <SectionTitle>Chat</SectionTitle>
        <div
          ref={listRef}
          className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-gray-200 bg-white p-2'
        >
          {messages.length === 0 ? (
            <p className='m-auto text-center text-xs text-gray-400'>
              No messages yet. Say hello to your team.
            </p>
          ) : (
            messages.map((m) => {
              const isMe = me && m.info?.key === me.key
              const label = isMe ? 'You' : (m.info?.name ?? m.info?.key?.slice(0, 6) ?? 'anonymous')
              return (
                <div key={m.id} className='flex flex-col gap-0.5'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-gray-500'>
                    {label}
                  </span>
                  <p className='whitespace-pre-wrap break-words text-xs text-gray-800'>{m.text}</p>
                </div>
              )
            })
          )}
        </div>
        <form
          onSubmit={handleSubmit}
          className='flex items-center gap-1'
          aria-label='Send a chat message'
        >
          <input
            type='text'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={writable ? 'Type a message\u2026' : 'Joining\u2026'}
            disabled={!writable}
            aria-label='Chat message'
            className='h-8 flex-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-100'
          />
          <button
            type='submit'
            disabled={!writable || draft.trim().length === 0}
            aria-label='Send message'
            className='inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-500 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300'
          >
            <Send className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        </form>
      </div>
    </aside>
  )
}
