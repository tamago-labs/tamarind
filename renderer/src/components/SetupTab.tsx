// Workspace tab — the right-drawer's "more stuff" tab. Renamed
// from "Setup" because it covers more than just configuration:
// it owns the invite code, the peer list, and the AI source
// picker. Three sections, top to bottom:
//
//   1. Invite code — host's z32 invite + copy button
//   2. Pick a model — picker showing the local model + every
//      peer's loaded model. Each peer row has a "Chat with this
//      peer" button that sets the AI source and switches the
//      drawer to the AI chat tab. Disabled when the peer is not
//      loaded or not currently accepting requests.
//   3. Peers — the connected peer count + role badge
//
// The drawer passes `onSwitchToChat` so this tab can hand control
// back to the chat tab after the user picks a peer source.

import { useEffect, useState } from 'react'
import { Check, Copy, MessageSquare, Users } from 'lucide-react'
import { useAI } from '../hooks/useAI'
import { useAIChat } from '../hooks/useAIChat'
import { useRoom } from '../hooks/useRoom'

interface SetupTabProps {
  onSwitchToChat?: () => void
}

export function SetupTab({ onSwitchToChat }: SetupTabProps) {
  const room = useRoom()
  const ai = useAI()
  const chat = useAIChat()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  async function handleCopy() {
    if (!room.invite) return
    try {
      await navigator.clipboard.writeText(room.invite)
      setCopied(true)
    } catch (err) {
      setError('Copy failed — your browser may have blocked clipboard access.')
      console.error('[SetupTab] copy failed:', err)
    }
  }

  function selectLocal() {
    if (!ai.activeModel) return
    chat.setAiSource({
      kind: 'local',
      modelId: ai.activeModel.id,
      modelName: ai.activeModel.name
    })
  }

  function selectPeer(writerKey: string, modelId: string, modelName: string) {
    chat.setAiSource({
      kind: 'peer',
      writerKey,
      modelId,
      modelName
    })
    onSwitchToChat?.()
  }

  // Filter peer AI states — skip the local writer (the local row is
  // rendered separately as "This device"). Local writer's z32 key is
  // `room.me?.key`; we compare against the same encoding the worker
  // pushed in `ai-states`.
  const localKey = room.me?.key
  const peerAiStates = room.peerAiStates.filter((s) => s.writerKey !== localKey)

  return (
    <div className='flex flex-col gap-4'>
      {/* ── Invite code ─────────────────────────────────────────── */}
      <section>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>
          Invite code
        </h3>
        {room.invite && room.role === 'host' ? (
          <div className='flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5'>
            <code className='flex-1 truncate font-mono text-xs text-gray-800' title={room.invite}>
              {room.invite}
            </code>
            <button
              type='button'
              onClick={handleCopy}
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
            {room.role === 'guest'
              ? 'Joined the host\u2019s room.'
              : room.status === 'ready'
                ? 'Minting invite code\u2026'
                : 'Starting room\u2026'}
          </p>
        )}
        <p className='mt-2 text-[10px] text-gray-500'>
          {room.role === 'host'
            ? 'Share this code so peers can join the board.'
            : room.role === 'guest'
              ? 'You joined using a host-shared code.'
              : 'Preparing room\u2026'}
        </p>
      </section>

      {/* ── Pick a model ────────────────────────────────────────── */}
      <section>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>
          Pick a model
        </h3>
        <div className='flex flex-col gap-1.5'>
          <SourceRow
            kind='local'
            label='This device'
            modelName={ai.activeModel?.name ?? null}
            selected={
              chat.aiSource?.kind === 'local' && chat.aiSource.modelId === ai.activeModel?.id
            }
            onSelect={selectLocal}
            disabled={!ai.activeModel}
            disabledReason={!ai.activeModel ? 'No model loaded' : undefined}
          />
          {peerAiStates.length === 0 ? (
            <p className='px-1 py-1 text-[10px] italic text-gray-400'>No peers in the room yet.</p>
          ) : (
            peerAiStates.map((p) => {
              const loaded = p.modelId && p.modelName
              return (
                <SourceRow
                  key={p.writerKey}
                  kind='peer'
                  label={shortWriterKey(p.writerKey)}
                  modelName={p.modelName}
                  selected={
                    chat.aiSource?.kind === 'peer' && chat.aiSource.writerKey === p.writerKey
                  }
                  onSelect={() => loaded && selectPeer(p.writerKey, p.modelId!, p.modelName!)}
                  disabled={!loaded || !p.accepting}
                  disabledReason={
                    !loaded
                      ? 'No model loaded on this peer'
                      : !p.accepting
                        ? 'Peer is busy'
                        : undefined
                  }
                />
              )
            })
          )}
        </div>
      </section>

      {/* ── Peers ────────────────────────────────────────────────── */}
      <section>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500'>Peers</h3>
        <div className='flex items-center gap-1.5 text-xs text-gray-700'>
          <Users className='h-3.5 w-3.5 text-gray-500' aria-hidden='true' />
          <span>
            {room.peers} {room.peers === 1 ? 'peer' : 'peers'} connected
            {room.role ? ` \u00b7 ${room.role === 'host' ? 'You host' : 'You joined'}` : ''}
          </span>
        </div>
      </section>

      {error && (
        <div
          role='alert'
          className='rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-700'
        >
          {error}
        </div>
      )}
    </div>
  )
}

function shortWriterKey(key: string) {
  if (typeof key !== 'string' || key.length < 6) return 'peer'
  return `peer-${key.slice(0, 6)}`
}

function SourceRow({
  kind,
  label,
  modelName,
  selected,
  onSelect,
  disabled,
  disabledReason
}: {
  kind: 'local' | 'peer'
  label: string
  modelName: string | null
  selected: boolean
  onSelect: () => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <button
      type='button'
      onClick={onSelect}
      disabled={disabled}
      className={
        selected
          ? 'flex w-full items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
          : 'flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
      }
    >
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5 text-xs'>
          <span className='truncate font-medium text-gray-800'>{label}</span>
          {selected && (
            <span className='rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700'>
              Active
            </span>
          )}
        </div>
        <p className='mt-0.5 truncate text-[10px] text-gray-500'>
          {modelName ?? (kind === 'local' ? 'No model loaded' : 'No model loaded on this peer')}
          {disabled && disabledReason ? ` · ${disabledReason}` : ''}
        </p>
      </div>
      {kind === 'peer' && (
        <span className='inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600'>
          <MessageSquare className='h-3 w-3' aria-hidden='true' />
          Chat
        </span>
      )}
    </button>
  )
}
