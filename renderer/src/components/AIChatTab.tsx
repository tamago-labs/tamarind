// AI chat tab — shown in the right drawer (the "empty selection"
// slot) under the "AI chat" tab. Composes the message list, the
// session bar, and the send input. Streaming tokens stay as plain
// text; finalized assistant messages render through `react-markdown`
// + `remark-gfm` with a trimmed-down `markdownComponents` map.
//
// Markdown plugin choice + streaming-vs-finalize boundary is locked
// in by the user's decisions 5 + 6 (raw markdown during stream is
// OK; react-markdown on the finalised message).
//
// Thinking: collapsible card, default collapsed when the message is
// persisted, auto-expanded while streaming (walrus-form-studio
// pattern).
//
// Source selection: explicit, no fallback. The user picks a source
// in the Workspace tab before the input enables. If the source is a
// peer and that peer drops from the room, the source is cleared and
// the user has to pick again — no auto-fallback. `onSwitchToSetup`
// is the hand-off into the Workspace tab.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, Plus, Send, Square, Trash2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAI } from '../hooks/useAI'
import { useAIChat } from '../hooks/useAIChat'
import { useRoom } from '../hooks/useRoom'
import type { ChatTurn } from '../ai/types'

interface AIChatTabProps {}

export function AIChatTab(_props: AIChatTabProps) {
  const ai = useAI()
  const chat = useAIChat()
  const room = useRoom()
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [showSessionMenu, setShowSessionMenu] = useState(false)
  const [showSourceMenu, setShowSourceMenu] = useState(false)

  // Auto-scroll to the bottom of the message list on new content.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat.messages.length, chat.streamingContent, chat.streamingThinking])

  // Auto-dismiss the destructive confirms after 4s.
  useEffect(() => {
    if (!confirmingClear) return
    const t = setTimeout(() => setConfirmingClear(false), 4000)
    return () => clearTimeout(t)
  }, [confirmingClear])

  const currentSession = useMemo(
    () => chat.sessions.find((s) => s.slug === chat.currentSessionSlug) ?? null,
    [chat.sessions, chat.currentSessionSlug]
  )
  const sessionLabel =
    currentSession?.slug === 'main' ? 'Main (default)' : (currentSession?.slug ?? '…')

  // Source picker logic (moved from SetupTab)
  const localKey = room.me?.key
  const hostState = room.peerAiStates.find((s) => s.writerKey !== localKey) ?? null
  const hostHasModel = !!(hostState?.modelId && hostState?.modelName)

  function selectLocalSource() {
    if (!ai.activeModel) return
    chat.setAiSource({
      kind: 'local',
      modelId: ai.activeModel.id,
      modelName: ai.activeModel.name
    })
  }

  function selectHostSource() {
    if (!hostState) return
    chat.setAiSource({
      kind: 'peer',
      writerKey: hostState.writerKey,
      modelId: hostState.modelId ?? '',
      modelName: hostState.modelName ?? 'Host model'
    })
  }

  function clearSource() {
    chat.setAiSource(null)
  }

  function handleSend() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void chat.send(text)
  }

  function handleClear() {
    if (confirmingClear) {
      setConfirmingClear(false)
      void chat.clearSession(chat.currentSessionSlug)
      return
    }
    setConfirmingClear(true)
  }

  async function handleDeleteSession(slug: string) {
    if (slug === 'main') return
    const ok = await chat.deleteSession(slug)
    void ok
  }

  async function handleNewSession() {
    const slug = await chat.createSession()
    setShowSessionMenu(false)
    // Slug is in the session bar; no further action needed.
    void slug
  }

  async function handleSwitchSession(slug: string) {
    setShowSessionMenu(false)
    await chat.setCurrentSession(slug)
  }

  const isInputDisabled =
    chat.isStreaming || !chat.aiSource || (chat.aiSource.kind === 'local' && !ai.isReady)

  const inputPlaceholder = isInputDisabled
    ? !chat.aiSource
      ? 'Pick an AI source above.'
      : chat.aiSource.kind === 'local' && !ai.isReady
        ? 'No model loaded on this device.'
        : 'Type a message…'
    : 'Type a message…'

  return (
    <div className='flex h-full flex-col gap-2'>
      {/* ── Session bar + Source button ─────────────────────────── */}
      <div className='flex items-center gap-1.5'>
        <div className='relative flex-1'>
          <button
            type='button'
            onClick={() => setShowSessionMenu((v) => !v)}
            className='flex w-full items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left text-xs font-medium text-gray-800 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            <FileText className='h-3.5 w-3.5 text-gray-500' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate'>{sessionLabel}</span>
            {currentSession && currentSession.messageCount > 0 && (
              <span className='rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-500'>
                {currentSession.messageCount}
              </span>
            )}
            <ChevronDown className='h-3 w-3 text-gray-500' aria-hidden='true' />
          </button>
          {showSessionMenu && (
            <SessionMenu
              current={chat.currentSessionSlug}
              sessions={chat.sessions}
              onSelect={handleSwitchSession}
              onCreate={handleNewSession}
              onDelete={handleDeleteSession}
              onClose={() => setShowSessionMenu(false)}
            />
          )}
        </div>

        {/* ── Source button + popover ────────────────────────────── */}
        <div className='relative'>
          <button
            type='button'
            onClick={() => setShowSourceMenu((v) => !v)}
            aria-label='Select AI source'
            title='Select AI source'
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[10px] font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              chat.aiSource
                ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {chat.aiSource ? (chat.aiSource.kind === 'local' ? 'Local' : 'Host') : 'Source'}
            <ChevronDown className='h-3 w-3' />
          </button>
          {showSourceMenu && (
            <div className='absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-md border border-gray-200 bg-white shadow-md'>
              <div className='p-2'>
                <div className='mb-1.5 flex items-center justify-between'>
                  <span className='text-[10px] font-semibold uppercase tracking-wide text-gray-500'>
                    AI Source
                  </span>
                  {chat.aiSource && (
                    <button
                      type='button'
                      onClick={() => {
                        clearSource()
                        setShowSourceMenu(false)
                      }}
                      className='text-[10px] font-semibold uppercase tracking-wide text-gray-500 transition hover:text-red-600'
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className='flex flex-col gap-1'>
                  <button
                    type='button'
                    onClick={() => {
                      selectLocalSource()
                      setShowSourceMenu(false)
                    }}
                    disabled={!ai.activeModel}
                    aria-pressed={chat.aiSource?.kind === 'local'}
                    className={
                      chat.aiSource?.kind === 'local'
                        ? 'flex w-full items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60'
                        : 'flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
                    }
                  >
                    <span
                      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 ${
                        chat.aiSource?.kind === 'local'
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {chat.aiSource?.kind === 'local' && (
                        <span className='h-1.5 w-1.5 rounded-full bg-white' />
                      )}
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='font-medium'>Local</span>
                      <span className='ml-1 text-gray-500'>— This device</span>
                    </span>
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      selectHostSource()
                      setShowSourceMenu(false)
                    }}
                    disabled={!hostHasModel}
                    aria-pressed={chat.aiSource?.kind === 'peer'}
                    className={
                      chat.aiSource?.kind === 'peer'
                        ? 'flex w-full items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-2 py-1.5 text-left text-xs transition disabled:cursor-not-allowed disabled:opacity-60'
                        : 'flex w-full items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-left text-xs transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60'
                    }
                  >
                    <span
                      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 ${
                        chat.aiSource?.kind === 'peer'
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {chat.aiSource?.kind === 'peer' && (
                        <span className='h-1.5 w-1.5 rounded-full bg-white' />
                      )}
                    </span>
                    <span className='min-w-0 flex-1'>
                      <span className='font-medium'>Host</span>
                      <span className='ml-1 text-gray-500'>
                        — {hostHasModel ? (hostState?.modelName ?? 'Model') : 'No model loaded'}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type='button'
          onClick={handleClear}
          disabled={!currentSession || currentSession.messageCount === 0 || chat.isStreaming}
          aria-label={confirmingClear ? 'Confirm clear messages' : 'Clear messages'}
          title={
            confirmingClear
              ? 'Click again to confirm'
              : currentSession && currentSession.messageCount > 0
                ? 'Clear all messages in this session'
                : 'No messages to clear'
          }
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed ${
            confirmingClear
              ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:text-gray-300'
          }`}
        >
          <Trash2 className='h-3.5 w-3.5' aria-hidden='true' />
        </button>
      </div>

      {/* ── Status hint (current source) ────────────────────────── */}
      {chat.aiSource && (
        <p className='text-[10px] text-gray-500'>
          Connected to{' '}
          <span className='font-medium text-gray-700'>
            {chat.aiSource.kind === 'local'
              ? `This device — ${chat.aiSource.modelName || 'No model'}`
              : `${chat.aiSource.modelName || 'Peer model'} (peer)`}
          </span>
        </p>
      )}

      {/* ── Message list ───────────────────────────────────────── */}
      <div
        ref={listRef}
        className='flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-md border border-gray-200 bg-white p-2'
      >
        {chat.messages.length === 0 && !chat.isStreaming ? (
          <EmptyState
            hasModel={ai.isReady}
            hasSource={!!chat.aiSource}
            sourceIsLocal={chat.aiSource?.kind === 'local'}
          />
        ) : (
          <>
            {chat.messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {chat.isStreaming && (
              <StreamingBubble content={chat.streamingContent} thinking={chat.streamingThinking} />
            )}
          </>
        )}
        {chat.error && (
          <div
            role='alert'
            className='flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'
          >
            <div className='flex items-start gap-2'>
              <span className='font-mono uppercase tracking-wide'>{chat.error.code}</span>
              <span className='flex-1'>{chat.error.message}</span>
            </div>
            <div className='flex items-center gap-1.5'>
              <button
                type='button'
                onClick={() => chat.retry()}
                className='rounded-md border border-red-300 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-300'
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Input ──────────────────────────────────────────────── */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
        className='flex items-end gap-1'
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={inputPlaceholder}
          disabled={isInputDisabled}
          className='h-8 flex-1 resize-none rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-800 focus:border-tamarind-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50'
        />
        {chat.isStreaming ? (
          <button
            type='button'
            onClick={() => void chat.cancel()}
            aria-label='Stop generation'
            className='inline-flex h-8 w-8 items-center justify-center rounded-md bg-red-500 text-white transition hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500'
          >
            <Square className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        ) : (
          <button
            type='submit'
            disabled={isInputDisabled || draft.trim().length === 0}
            aria-label='Send message'
            className='inline-flex h-8 w-8 items-center justify-center rounded-md bg-tamarind-700 text-white transition hover:bg-tamarind-800 disabled:cursor-not-allowed disabled:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            <Send className='h-3.5 w-3.5' aria-hidden='true' />
          </button>
        )}
      </form>
    </div>
  )
}

function SessionMenu({
  current,
  sessions,
  onSelect,
  onCreate,
  onDelete,
  onClose
}: {
  current: string
  sessions: { slug: string; pinned: boolean; messageCount: number }[]
  onSelect: (slug: string) => void
  onCreate: () => void
  onDelete: (slug: string) => void
  onClose: () => void
}) {
  // Per-row delete confirm state. The X button needs a two-step
  // confirm because the action is destructive and irreversible. The
  // confirm auto-resets after 4s of inactivity.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as HTMLElement | null
      if (!t || !t.closest('[data-session-menu]')) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
    }
  }, [])

  function handleDeleteClick(slug: string) {
    if (confirmingDelete === slug) {
      // Second click — actually delete
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
      setConfirmingDelete(null)
      onDelete(slug)
      return
    }
    setConfirmingDelete(slug)
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null
      setConfirmingDelete(null)
    }, 4000)
  }

  return (
    <div
      data-session-menu
      className='absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-md'
    >
      {sessions.map((s) => {
        const isCurrent = s.slug === current
        const isConfirming = confirmingDelete === s.slug
        return (
          <div
            key={s.slug}
            className={`flex items-center gap-1.5 px-2 py-1.5 text-xs ${
              isCurrent ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <button
              type='button'
              onClick={() => onSelect(s.slug)}
              className={`min-w-0 flex-1 truncate text-left ${
                isCurrent ? 'text-gray-900' : 'text-gray-700'
              }`}
            >
              {s.pinned ? 'Main (default)' : s.slug}
            </button>
            {s.messageCount > 0 && (
              <span className='shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600'>
                {s.messageCount}
              </span>
            )}
            {!s.pinned && (
              <button
                type='button'
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteClick(s.slug)
                }}
                aria-label={isConfirming ? 'Confirm delete session' : 'Delete session'}
                title={isConfirming ? 'Click again to confirm' : 'Delete session'}
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isConfirming
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'text-gray-400 hover:bg-red-50 hover:text-red-600'
                }`}
              >
                <X className='h-3 w-3' aria-hidden='true' />
              </button>
            )}
          </div>
        )
      })}
      <button
        type='button'
        onClick={onCreate}
        className='flex w-full items-center gap-1.5 border-t border-gray-100 px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50'
      >
        <Plus className='h-3 w-3' aria-hidden='true' />
        New session
      </button>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatTurn }) {
  const isUser = message.role === 'user'
  const isAssistant = !isUser
  const [showThinking, setShowThinking] = useState(false)
  const hasThinking =
    isAssistant && typeof message.thinking === 'string' && message.thinking.length > 0

  if (isUser) {
    return (
      <div className='flex flex-col items-end gap-0.5'>
        <div className='max-w-[90%] whitespace-pre-wrap break-words rounded-md bg-blue-500 px-3 py-1.5 text-xs text-white'>
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1'>
      <div className='text-[10px] font-semibold uppercase tracking-wide text-gray-500'>
        Assistant
      </div>
      {hasThinking && (
        <button
          type='button'
          onClick={() => setShowThinking((v) => !v)}
          className='flex items-center gap-1 self-start rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-gray-600 transition hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
        >
          {showThinking ? (
            <ChevronDown className='h-3 w-3' aria-hidden='true' />
          ) : (
            <ChevronRight className='h-3 w-3' aria-hidden='true' />
          )}
          Thinking
        </button>
      )}
      {hasThinking && showThinking && (
        <div className='rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap break-words text-blue-900'>
          {message.thinking}
        </div>
      )}
      <div className='prose prose-xs max-w-none text-xs text-gray-800'>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content.trimStart()}
        </ReactMarkdown>
      </div>
    </div>
  )
}

function StreamingBubble({ content, thinking }: { content: string; thinking: string }) {
  const [showThinking, setShowThinking] = useState(true)
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500'>
        <span>Assistant</span>
        <span className='ml-1 inline-flex items-center gap-1 text-amber-600'>
          <span
            className='h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500'
            aria-hidden='true'
          />
          streaming
        </span>
      </div>
      {thinking && (
        <>
          <button
            type='button'
            onClick={() => setShowThinking((v) => !v)}
            className='flex items-center gap-1 self-start rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-blue-800 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            {showThinking ? (
              <ChevronDown className='h-3 w-3' aria-hidden='true' />
            ) : (
              <ChevronRight className='h-3 w-3' aria-hidden='true' />
            )}
            Thinking
          </button>
          {showThinking && (
            <div className='rounded-md border border-blue-100 bg-blue-50 px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap break-words text-blue-900'>
              {thinking}
            </div>
          )}
        </>
      )}
      {content ? (
        <p className='whitespace-pre-wrap break-words text-xs text-gray-800'>{content}</p>
      ) : (
        !thinking && <p className='text-[10px] italic text-gray-400'>Thinking…</p>
      )}
    </div>
  )
}

function EmptyState({
  hasModel,
  hasSource,
  sourceIsLocal
}: {
  hasModel: boolean
  hasSource: boolean
  sourceIsLocal: boolean
}) {
  // Three distinct empty states:
  //   1. No source at all — prompt the user to pick a source above.
  //   2. Source is local but no model is loaded — guide the user
  //      through loading a model (via the AI model picker in the
  //      footer) and then picking "Local" in the source picker.
  //   3. Source is set and a model is loaded — generic "start a
  //      conversation" prompt.
  let body: React.ReactNode
  if (!hasSource) {
    body = <p className='text-[10px] text-gray-500'>Pick an AI source above to get started.</p>
  } else if (sourceIsLocal && !hasModel) {
    body = (
      <>
        <p className='text-[10px] text-gray-500'>
          Your source is &ldquo;Local&rdquo; but no model is loaded.
        </p>
        <p className='text-[10px] text-gray-500'>
          Open the AI model picker (footer) to load a model.
        </p>
      </>
    )
  } else {
    body = <p className='text-[10px] text-gray-500'>Start a conversation with your AI.</p>
  }

  return (
    <div className='m-auto flex max-w-[16rem] flex-col items-center gap-2 px-2 py-6 text-center'>
      <div className='rounded-full bg-gray-100 p-2'>
        <FileText className='h-4 w-4 text-gray-500' aria-hidden='true' />
      </div>
      <p className='text-xs font-medium text-gray-700'>No messages yet</p>
      {body}
    </div>
  )
}

// Codes that mean "the peer source is no longer reachable — pick a
// new one". A local SEND_FAILED or completion error doesn't qualify:
// Minimal markdown component map. No syntax highlighting, no math, no
// link previews — keep the bundle lean. The full reference is
// my-doctor-ai/src/renderer/src/pages/Chat.tsx:21-152; we ship the
// subset that materially helps the chat UX (code distinction,
// tables, headings, links with target=_blank).
const markdownComponents = {
  a({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) {
    return (
      <a
        href={href}
        target='_blank'
        rel='noreferrer'
        className='text-blue-600 underline hover:text-blue-700'
        {...rest}
      >
        {children}
      </a>
    )
  },
  code({
    className,
    children,
    ...rest
  }: {
    className?: string
    children?: React.ReactNode
  } & React.HTMLAttributes<HTMLElement>) {
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    if (isBlock) {
      return (
        <pre className='my-1 overflow-x-auto rounded-md bg-gray-900 p-2 text-[11px] text-gray-100'>
          <code className={className} {...rest}>
            {children}
          </code>
        </pre>
      )
    }
    return (
      <code
        className='rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-800'
        {...rest}
      >
        {children}
      </code>
    )
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>
  },
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className='mb-1 text-sm font-semibold text-gray-900'>{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className='mb-1 text-sm font-semibold text-gray-900'>{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className='mb-1 text-xs font-semibold text-gray-900'>{children}</h3>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className='my-1 list-disc pl-4'>{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className='my-1 list-decimal pl-4'>{children}</ol>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className='my-1 border-l-2 border-gray-300 pl-2 text-gray-600'>
      {children}
    </blockquote>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <table className='my-1 w-full border-collapse text-[11px]'>{children}</table>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className='border border-gray-200 bg-gray-50 px-1 py-0.5 text-left font-medium text-gray-700'>
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className='border border-gray-200 px-1 py-0.5 text-gray-800'>{children}</td>
  )
}
