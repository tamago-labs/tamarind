// Team chat panel — P2P chat history + send input. Rendered inside
// the RightDrawer's "Team chat" tab. The invite code + peers + AI
// source picker used to live in this component under a 2-tab
// "Team chat / Team info" segmented control; they have moved to
// SetupTab in the Setup tab of the 3-tab right drawer.
//
// The empty state fills the entire available panel height so the
// chat list area doesn't collapse to a single line when no one has
// said anything yet — same UX contract as AIChatTab's EmptyState.

// Per-message delete + Clear-all round-trip through the worker's
// `remove-chats` route. An empty `ids` array is interpreted by the
// worker as "delete every chat row".

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, Trash2 } from 'lucide-react'
import type { ChatMessage } from '../lib/chat'
import type { RoomRole } from '../hooks/useRoom'

interface GroupChatPanelProps {
  invite: string | null
  peers: number
  messages: ChatMessage[]
  role: RoomRole | null
  writable: boolean
  me: { key: string; name: string } | null
  onSendChat: (text: string) => void
  onRemoveChat: (id: string) => void
  onClearChat: () => void
  onCopyInvite: () => void
}

export function GroupChatPanel({
  invite: _invite,
  peers: _peers,
  messages,
  role: _role,
  writable,
  me,
  onSendChat,
  onRemoveChat,
  onClearChat
}: GroupChatPanelProps) {
  const [draft, setDraft] = useState('')
  // Inline confirmation for the destructive Clear-all action. Holding
  // the local state here (vs. window.confirm) keeps the trigger test-
  // able — smoke tests can click the confirm button without blocking
  // on a native dialog.
  const [confirmingClear, setConfirmingClear] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to the most recent message on new content.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Auto-dismiss the Clear-all confirmation if the user doesn't click
  // again within 4s (or the chat list empties before they commit).
  useEffect(() => {
    if (!confirmingClear) return
    const handle = setTimeout(() => setConfirmingClear(false), 4000)
    return () => clearTimeout(handle)
  }, [confirmingClear])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!writable) return
    const text = draft.trim()
    if (!text) return
    onSendChat(text)
    setDraft('')
  }

  function handleClearAll() {
    if (!writable) return
    if (messages.length === 0) return
    if (!confirmingClear) {
      setConfirmingClear(true)
      return
    }
    onClearChat()
    setConfirmingClear(false)
  }

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col gap-2'>
      <div className='flex items-center justify-between'>
        <h3 className='text-xs font-semibold uppercase tracking-wide text-gray-500'>Chat</h3>
        <button
          type='button'
          onClick={handleClearAll}
          disabled={!writable || messages.length === 0}
          aria-label={confirmingClear ? 'Confirm clear all messages' : 'Clear all messages'}
          title={
            confirmingClear
              ? 'Click again to confirm'
              : writable
                ? 'Remove every message in this room'
                : 'Joining\u2026'
          }
          className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed ${
            confirmingClear
              ? 'bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-300'
              : 'text-gray-500 hover:bg-gray-200 disabled:text-gray-300'
          }`}
        >
          <Trash2 className='h-3 w-3' aria-hidden='true' />
          {confirmingClear ? 'Confirm clear' : 'Clear all'}
        </button>
      </div>
      <div
        ref={listRef}
        className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-md border border-gray-200 bg-white p-2'
      >
        {messages.length === 0 ? (
          <div className='m-auto flex max-w-[16rem] flex-col items-center gap-2 px-2 py-6 text-center'>
            <div className='rounded-full bg-gray-100 p-2'>
              <MessageSquare className='h-4 w-4 text-gray-500' aria-hidden='true' />
            </div>
            <p className='text-xs font-medium text-gray-700'>No messages yet</p>
            <p className='text-[10px] text-gray-500'>
              Say hello to your team to get the conversation started.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = me && m.info?.key === me.key
            const label = isMe ? 'You' : (m.info?.name ?? m.info?.key?.slice(0, 6) ?? 'anonymous')
            return (
              <div key={m.id} className='group flex flex-col gap-0.5'>
                <div className='flex items-center justify-between'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-gray-500'>
                    {label}
                  </span>
                  {/* Per-message delete: only the local writer can
                      remove their own messages. The button stays
                      hidden for peer messages so we don't expose a
                      control that would silently no-op over the
                      wire (the worker's permission model is
                      "anyone writable can delete anyone else's
                      chat", but the UX contract is "you can only
                      manage your own messages"). */}
                  {isMe && writable && (
                    <button
                      type='button'
                      onClick={() => onRemoveChat(m.id)}
                      aria-label={`Remove message ${m.id}`}
                      title='Remove this message'
                      className='invisible inline-flex h-4 w-4 items-center justify-center rounded text-gray-400 transition hover:bg-gray-200 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-blue-500 group-hover:visible focus:visible'
                    >
                      <Trash2 className='h-3 w-3' aria-hidden='true' />
                    </button>
                  )}
                </div>
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
  )
}
