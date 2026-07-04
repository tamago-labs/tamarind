// RightDrawer — 3-tab container shown in the PropertiesDrawer's
// "empty selection" slot. Left to right:
//
//   • Workspace  — invite code, peers, AI source picker (SetupTab)
//   • Team chat  — P2P chat (GroupChatPanel)
//   • AI chat    — local model + relay-to-peer chat (AIChatTab)
//
// Workspace sits first because it's the "configure your session"
// surface and the entry point for first-time users. The chat tabs
// follow.
//
// Layout:
//   - The aside is a single flex column that fills its container
//     height. The tab strip is a sticky-feeling header (flex-shrink-0).
//   - The active tabpanel is the only flex-grow child; the chat and
//     AI panels take the remaining height and manage their own
//     scrolling. The Workspace tab is short and auto-sizes.
//
// Tab state lives here so the Workspace tab's "Chat with this peer"
// button can hand control to the AI chat tab, and the AI chat tab
// can hand control back to Workspace when the user needs to (re)pick
// an AI source. Option 3 — explicit choice, no fallback — requires
// both directions.

import { useState } from 'react'
import { AIChatTab } from './AIChatTab'
import { GroupChatPanel } from './GroupChatPanel'
import { SetupTab } from './SetupTab'
import { useRoom } from '../hooks/useRoom'

type RightTab = 'workspace' | 'team' | 'ai'

export function RightDrawer() {
  const room = useRoom()
  const [active, setActive] = useState<RightTab>('workspace')
  // The "Chat with this peer" button on Workspace calls this to hand
  // control to the AI chat tab after the user picks a source.
  const switchToAiChat = () => setActive('ai')
  // The AI chat tab calls this when the user needs to (re)pick a
  // source — the empty state and the relay-error banner both surface
  // a "Switch source" affordance that lands on Workspace.
  const switchToWorkspace = () => setActive('workspace')

  // Hide the chat-heavy tabs when the room isn't ready yet — the
  // invite / peer list on Workspace also depends on room status.
  const roomReady = room.status === 'ready'

  return (
    <aside
      aria-label='Right panel'
      className='flex h-full min-h-0 w-72 shrink-0 flex-col gap-3 overflow-hidden border-l border-gray-200 bg-gray-50 p-3'
    >
      {/* Tabs — fixed at the top, doesn't grow or scroll. */}
      <div
        role='tablist'
        aria-label='Right panel tabs'
        className='inline-flex w-full shrink-0 overflow-hidden rounded-md border border-gray-300 bg-white'
      >
        {(
          [
            { v: 'workspace', label: 'Workspace' },
            { v: 'team', label: 'Team chat' },
            { v: 'ai', label: 'AI assistant' }
          ] as const
        ).map((opt) => (
          <button
            key={opt.v}
            type='button'
            role='tab'
            aria-selected={active === opt.v}
            onClick={() => setActive(opt.v)}
            className={
              active === opt.v
                ? 'flex-1 border-r border-gray-300 bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-800 last:border-r-0'
                : 'flex-1 border-r border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 last:border-r-0'
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Active panel — fills the remaining height. The chat and AI
          panels use their own internal scrolling; the Workspace tab
          auto-sizes (it's small enough to fit without scroll). */}
      {active === 'workspace' && (
        <div role='tabpanel' className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
          <SetupTab onSwitchToChat={switchToAiChat} />
        </div>
      )}
      {active === 'team' && (
        <div role='tabpanel' className='flex min-h-0 flex-1 flex-col'>
          {roomReady ? (
            <GroupChatPanel
              invite={room.invite}
              peers={room.peers}
              messages={room.chat}
              role={room.role}
              writable={room.writable}
              me={room.me}
              onSendChat={room.sendChat}
              onRemoveChat={(id) => room.removeChats([id])}
              onClearChat={room.clearChat}
              onCopyInvite={() => {
                if (!room.invite) return
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(room.invite).catch(() => {})
                }
              }}
            />
          ) : (
            <p className='text-xs text-gray-500'>Starting room…</p>
          )}
        </div>
      )}
      {active === 'ai' && (
        <div role='tabpanel' className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <AIChatTab onSwitchToSetup={switchToWorkspace} />
        </div>
      )}
    </aside>
  )
}
