// Workspace tab — the right-drawer's "more stuff" tab. Renamed
// from "Setup" because it covers more than just configuration:
// it owns the invite code, the peer count, and the AI source
// picker. Two sections, top to bottom:
//
//   1. Invite code — host's z32 invite + copy button
//   2. Pick a source — exactly two options: "Local" (this
//      device's model) and "Host" (the host peer's model).
//      Clicking a row sets the AI source and switches to the
//      AI chat tab. The user can also clear the source if they
//      want to switch off (Option 3 — no auto-fallback).
//
// The "Host" option is the host peer's model, identified as the
// first non-local writer in `peerAiStates`. `useRoom` polls
// `bridge.aiSourcePeers()` every 5s (peerAiPolling) so the
// picker doesn't sit on an empty list while Hyperswarm replicates.
// A "Re-checking…" hint surfaces during the wait.

import { useEffect, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
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
    onSwitchToChat?.()
  }

  function selectHost() {
    if (!hostState) return
    chat.setAiSource({
      kind: 'peer',
      writerKey: hostState.writerKey,
      modelId: hostState.modelId ?? '',
      modelName: hostState.modelName ?? 'Host model'
    })
    onSwitchToChat?.()
  }

  function clearSource() {
    chat.setAiSource(null)
  }

  // Host = first non-local writer in `peerAiStates`. In the current
  // single-host topology, this is always the host. The renderer's
  // `useRoom` polls the cached snapshot every 5s, so the host row
  // appears as soon as Hyperswarm replication completes.
  const localKey = room.me?.key
  const hostState = room.peerAiStates.find((s) => s.writerKey !== localKey) ?? null
  const hostHasModel = !!(hostState?.modelId && hostState?.modelName)
  const hostVisible = hostState !== null

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

      {/* ── Pick a source ───────────────────────────────────────── */}
      <section>
        <div className='mb-2 flex items-center justify-between'>
          <h3 className='text-xs font-semibold uppercase tracking-wide text-gray-500'>
            Pick a source
          </h3>
          {chat.aiSource && (
            <button
              type='button'
              onClick={clearSource}
              title='Clear the current source'
              className='inline-flex items-center gap-1 rounded text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              <X className='h-3 w-3' aria-hidden='true' />
              Clear
            </button>
          )}
        </div>
        <p className='mb-2 text-[10px] text-gray-500'>
          Pick where AI chat should run. &ldquo;Local&rdquo; uses a model loaded on this device;
          &ldquo;Host&rdquo; routes every message to the host&rsquo;s model over the room. No
          automatic fallback — if the host is unreachable, the source clears and you have to pick
          again.
        </p>
        <div className='flex flex-col gap-1.5'>
          <SourceRow
            kind='local'
            label='Local'
            subtitle='This device'
            modelName={ai.activeModel?.name ?? null}
            selected={
              chat.aiSource?.kind === 'local' && chat.aiSource.modelId === ai.activeModel?.id
            }
            onSelect={selectLocal}
            disabled={!ai.activeModel}
            disabledReason={!ai.activeModel ? 'No model loaded' : undefined}
          />
          <SourceRow
            kind='host'
            label='Host'
            subtitle={hostState ? shortWriterKey(hostState.writerKey) : 'Waiting for host…'}
            modelName={hostHasModel ? (hostState?.modelName ?? null) : null}
            selected={
              chat.aiSource?.kind === 'peer' && chat.aiSource.writerKey === hostState?.writerKey
            }
            onSelect={selectHost}
            disabled={!hostHasModel}
            disabledReason={
              !hostVisible
                ? 'Re-checking…'
                : !hostHasModel
                  ? 'Host has no model loaded'
                  : !hostState?.accepting
                    ? 'Host is busy'
                    : undefined
            }
          />
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
  if (typeof key !== 'string' || key.length < 6) return 'host'
  return `host-${key.slice(0, 6)}`
}

function SourceRow({
  kind,
  label,
  subtitle,
  modelName,
  selected,
  onSelect,
  disabled,
  disabledReason
}: {
  kind: 'local' | 'host'
  label: string
  subtitle: string
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
      aria-pressed={selected}
      className={
        selected
          ? 'flex w-full items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
          : 'flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60'
      }
    >
      <div
        aria-hidden='true'
        className={
          selected
            ? 'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-500'
            : 'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-gray-300 bg-white'
        }
      >
        {selected && <span className='h-1.5 w-1.5 rounded-full bg-white' />}
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5 text-xs'>
          <span className='truncate font-medium text-gray-800'>{label}</span>
          <span className='truncate text-[10px] font-normal text-gray-500'>{subtitle}</span>
          {selected && (
            <span className='rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700'>
              Active
            </span>
          )}
        </div>
        <p className='mt-0.5 truncate text-[10px] text-gray-500'>
          {modelName ?? (kind === 'local' ? 'No model loaded' : 'No model loaded on host')}
          {disabled && disabledReason ? ` · ${disabledReason}` : ''}
        </p>
      </div>
    </button>
  )
}
