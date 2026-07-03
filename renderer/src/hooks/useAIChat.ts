// Module-scope singleton store for AI chat. Mirrors the `useAI`
// pattern at [hooks/useAI.ts] — pushes through useSyncExternalStore
// because chat state has more than a simple enum (messages, streaming
// deltas, session list, AI source).
//
// Critical implementation rules (from the reference project review):
//
//   - Listeners are subscribed ONCE on the first useAIChat() call with
//     an empty deps `useEffect` (walrus-form-studio pattern, not
//     my-doctor-ai's). Re-subscribing per render causes stale-
//     closure bugs on the `done` handler.
//
//   - `streamingContent` / `streamingThinking` are *accumulators*,
//     not derived. The SDK fires one `contentDelta` per token; the
//     hook appends each to the in-memory string. The string is
//     committed into a finalized `ChatTurn` only on `ai:chat:done`,
//     which makes the "markdown render" boundary trivial: plain text
//     while streaming, react-markdown on the persisted turn.
//
//   - Auto-save is debounced 500ms. `done` / `error` force-flush
//     synchronously so the in-progress turn survives a quit right
//     after the response lands.
//
//   - `aiSource` always defaults to `local` on launch (per the
//     user's locked-in decision 2). No persistence.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { bridge } from '../lib/bridge'
import type {
  AiSource,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatStatsEvent,
  ChatStatusEvent,
  ChatThinkingEvent,
  ChatTokenEvent,
  ChatTurn,
  SessionMeta
} from '../ai/types'

interface AIChatState {
  sessions: SessionMeta[]
  currentSessionSlug: string
  messages: ChatTurn[]
  streamingContent: string
  streamingThinking: string
  isStreaming: boolean
  streamingRequestId: string | null
  streamingModelName: string | null
  error: { code: string; message: string; retryable: boolean } | null
  lastUserText: string | null
  aiSource: AiSource | null
}

let snapshot: AIChatState = {
  sessions: [],
  currentSessionSlug: 'main',
  messages: [],
  streamingContent: '',
  streamingThinking: '',
  isStreaming: false,
  streamingRequestId: null,
  streamingModelName: null,
  error: null,
  lastUserText: null,
  aiSource: null
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}
function set(p: Partial<AIChatState>) {
  snapshot = { ...snapshot, ...p }
  emit()
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

// ─────────────────────────── bootstrap ───────────────────────────

let bootstrapped = false
let saveDebounceHandle: ReturnType<typeof setTimeout> | null = null

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function refreshSessions() {
  try {
    const list = await bridge.sessions.list()
    set({ sessions: list })
  } catch (err) {
    console.error('[useAIChat] list sessions failed:', err)
  }
}

async function loadSession(slug: string) {
  try {
    const r = await bridge.sessions.load(slug)
    if (r.success) {
      set({ messages: r.messages, currentSessionSlug: slug })
    } else {
      set({ messages: [], currentSessionSlug: slug })
    }
  } catch (err) {
    console.error('[useAIChat] load failed:', err)
    set({ messages: [], currentSessionSlug: slug })
  }
}

function flushSaveNow() {
  if (saveDebounceHandle) {
    clearTimeout(saveDebounceHandle)
    saveDebounceHandle = null
  }
  const { currentSessionSlug, messages } = snapshot
  if (!currentSessionSlug) return
  void bridge.sessions.save(currentSessionSlug, messages).catch((err) => {
    console.error('[useAIChat] save failed:', err)
  })
}

function scheduleSave() {
  if (saveDebounceHandle) clearTimeout(saveDebounceHandle)
  saveDebounceHandle = setTimeout(() => {
    saveDebounceHandle = null
    flushSaveNow()
  }, 500)
}

async function bootstrapOnce() {
  if (bootstrapped) return
  bootstrapped = true

  // Subscribe ONCE. The handlers adopt the requestId from the first
  // event of a stream (the IPC return from `send` may not have arrived
  // yet, and the `ai:chat:status` event with `requestId: null` fires
  // BEFORE the `ai:chat:done` event when the stream settles). To avoid
  // the latter clearing `streamingRequestId` out from under the
  // `onDone` commit, the `onStatus` handler only updates `isStreaming`
  // — the requestId is owned by `send` / `onToken` / `onDone` /
  // `onError` and cleared only after the assistant message is
  // committed to `messages`.
  bridge.aiChat.onStatus((e: ChatStatusEvent) => {
    set({ isStreaming: e.isStreaming })
  })
  bridge.aiChat.onToken((e: ChatTokenEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    if (snapshot.streamingRequestId === null) {
      set({ streamingRequestId: e.requestId })
    }
    set({ streamingContent: snapshot.streamingContent + e.text })
  })
  bridge.aiChat.onThinking((e: ChatThinkingEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    if (snapshot.streamingRequestId === null) {
      set({ streamingRequestId: e.requestId })
    }
    set({ streamingThinking: snapshot.streamingThinking + e.text })
  })
  bridge.aiChat.onStats((_e: ChatStatsEvent) => {
    // Reserved for future "X tok/s" UI. Intentionally ignored for
    // now to keep the render path stable.
  })
  bridge.aiChat.onDone((e: ChatDoneEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    const finished: ChatTurn = {
      id: newId(),
      role: 'assistant',
      content: snapshot.streamingContent,
      timestamp: new Date().toISOString(),
      ...(snapshot.streamingThinking ? { thinking: snapshot.streamingThinking } : {}),
      ...(snapshot.streamingModelName ? { modelName: snapshot.streamingModelName } : {})
    }
    set({
      messages: [...snapshot.messages, finished],
      streamingContent: '',
      streamingThinking: '',
      isStreaming: false,
      streamingRequestId: null,
      streamingModelName: null,
      error: e.stopReason === 'error' ? snapshot.error : null
    })
    flushSaveNow()
    void refreshSessions()
  })
  bridge.aiChat.onError((e: ChatErrorEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    set({
      error: e.error,
      isStreaming: false,
      streamingRequestId: null
    })
    // Persist whatever we got so the user can retry without losing
    // the partial assistant text. Only commit if we have any
    // accumulated content; otherwise drop.
    if (snapshot.streamingContent) {
      const finished: ChatTurn = {
        id: newId(),
        role: 'assistant',
        content: snapshot.streamingContent,
        timestamp: new Date().toISOString(),
        ...(snapshot.streamingThinking ? { thinking: snapshot.streamingThinking } : {}),
        ...(snapshot.streamingModelName ? { modelName: snapshot.streamingModelName } : {})
      }
      set({
        messages: [...snapshot.messages, finished],
        streamingContent: '',
        streamingThinking: '',
        streamingModelName: null
      })
      flushSaveNow()
      void refreshSessions()
    }
  })

  // Phase 7: subscribe to peer AI states. Always-on, even if no
  // peers are connected — events just stay quiet.
  bridge.onPeerAiStates((states) => {
    set({ aiSource: deriveAiSource(snapshot.aiSource, states) })
  })

  // Phase 8: subscribe to relay events. The worker forwards each
  // peer's `relay-response` as a single `relay-event` push; we
  // reuse the same `onToken`/`onThinking`/`onDone`/`onError` flow
  // for routing. The `requestId` is mapped to a stable per-call id
  // generated in `send` so the user-visible streaming state stays
  // in one place.
  bridge.onRelayEvent((e) => {
    // The relay route uses a different requestId than local sends.
    // For Phase 1 we only implement local; Phase 8 wires the relay
    // path through `send` itself.
    if (!e) return
    if (e.kind === 'token' && typeof e.text === 'string') {
      set({ streamingContent: snapshot.streamingContent + e.text })
    } else if (e.kind === 'thinking' && typeof e.text === 'string') {
      set({ streamingThinking: snapshot.streamingThinking + e.text })
    } else if (e.kind === 'error') {
      set({
        error: e.error || {
          code: 'RELAY_ERROR',
          message: 'Remote error',
          retryable: true
        },
        isStreaming: false,
        streamingRequestId: null
      })
    } else if (e.kind === 'done' || e.kind === 'busy') {
      // Commit whatever we accumulated.
      if (snapshot.streamingContent || snapshot.streamingThinking) {
        const finished: ChatTurn = {
          id: newId(),
          role: 'assistant',
          content: snapshot.streamingContent,
          timestamp: new Date().toISOString(),
          ...(snapshot.streamingThinking ? { thinking: snapshot.streamingThinking } : {}),
          ...(snapshot.streamingModelName ? { modelName: snapshot.streamingModelName } : {})
        }
        set({
          messages: [...snapshot.messages, finished],
          streamingContent: '',
          streamingThinking: '',
          streamingModelName: null,
          isStreaming: false,
          streamingRequestId: null
        })
        flushSaveNow()
      } else {
        set({ isStreaming: false, streamingRequestId: null })
      }
    }
  })

  // Hydrate initial sessions list + pinned `main`. The aiSource
  // always defaults to `local` on launch (locked-in decision 2:
  // never persist the pick across launches). The modelId/modelName
  // are filled in lazily — once `useAI().activeModel` resolves, the
  // UI can promote the placeholder to the real local source.
  await refreshSessions()
  await loadSession('main')
  set({ aiSource: { kind: 'local', modelId: '', modelName: 'Local model' } })
}

// ─────────────────────────── AI source derivation ───────────────────────────

function deriveAiSource(
  current: AiSource | null,
  peers: Array<{
    writerKey: string
    modelId: string | null
    modelName: string | null
    accepting: boolean
  }>
): AiSource | null {
  // If the current source is a peer and that peer is no longer in
  // the list, drop back to null so the UI shows the empty hint.
  if (current?.kind === 'peer') {
    const still = peers.find((p) => p.writerKey === current.writerKey)
    if (!still) return null
    // Sync the model name in case the peer swapped models.
    if (still.modelId && still.modelName) {
      return { ...current, modelId: still.modelId, modelName: still.modelName }
    }
    return current
  }
  return current
}

// ─────────────────────────── public API ───────────────────────────

export interface AIChatApi {
  // session
  sessions: SessionMeta[]
  currentSessionSlug: string
  setCurrentSession(slug: string): Promise<void>
  createSession(): Promise<string>
  deleteSession(slug: string): Promise<boolean>
  clearSession(slug: string): Promise<boolean>
  // chat
  messages: ChatTurn[]
  streamingContent: string
  streamingThinking: string
  streamingModelName: string | null
  isStreaming: boolean
  error: { code: string; message: string; retryable: boolean } | null
  aiSource: AiSource | null
  send(text: string): Promise<void>
  cancel(): Promise<void>
  retry(): Promise<void>
  setAiSource(source: AiSource | null): void
  refresh(): Promise<void>
}

export function useAIChat(): AIChatApi {
  const state = useSyncExternalStore(subscribe, () => snapshot)

  // Lazy bootstrap on first call. The `void` discard is intentional;
  // we don't need to await the hydration to render the first frame.
  void bootstrapOnce()

  // Auto-save on messages change (debounced). Runs in an effect so we
  // don't fire a save on every render — only when the array reference
  // changes.
  const messagesRef = useRef(state.messages)
  useEffect(() => {
    if (state.messages === messagesRef.current) return
    messagesRef.current = state.messages
    scheduleSave()
  }, [state.messages])

  return {
    sessions: state.sessions,
    currentSessionSlug: state.currentSessionSlug,
    setCurrentSession: async (slug) => {
      await loadSession(slug)
    },
    createSession: async () => {
      const r = await bridge.sessions.create()
      await refreshSessions()
      await loadSession(r.slug)
      return r.slug
    },
    deleteSession: async (slug) => {
      if (slug === 'main') return false
      const r = await bridge.sessions.delete(slug)
      if (r.success) {
        if (snapshot.currentSessionSlug === slug) {
          await loadSession('main')
        }
        await refreshSessions()
        return true
      }
      return false
    },
    clearSession: async (slug) => {
      const r = await bridge.sessions.clear(slug)
      if (r.success && snapshot.currentSessionSlug === slug) {
        set({ messages: [] })
      }
      await refreshSessions()
      return r.success
    },
    messages: state.messages,
    streamingContent: state.streamingContent,
    streamingThinking: state.streamingThinking,
    streamingModelName: state.streamingModelName,
    isStreaming: state.isStreaming,
    error: state.error,
    aiSource: state.aiSource,
    send: async (text) => {
      const trimmed = text.trim()
      if (!trimmed) return
      if (state.isStreaming) return
      const source = snapshot.aiSource
      if (!source) {
        set({
          error: {
            code: 'NO_SOURCE',
            message: 'Pick an AI source in Setup.',
            retryable: false
          }
        })
        return
      }
      const userTurn: ChatTurn = {
        id: newId(),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString()
      }
      const history = [...state.messages, userTurn]
      set({
        messages: history,
        streamingContent: '',
        streamingThinking: '',
        streamingModelName: source.modelName,
        lastUserText: trimmed,
        error: null
      })
      flushSaveNow()

      if (source.kind === 'local') {
        const r = await bridge.aiChat.send({ messages: history })
        if (!r.success) {
          set({
            error: r.error
              ? { code: 'SEND_FAILED', message: r.error, retryable: true }
              : { code: 'SEND_FAILED', message: 'Failed to send', retryable: true },
            streamingContent: '',
            streamingThinking: '',
            streamingModelName: null,
            isStreaming: false,
            streamingRequestId: null
          })
          return
        }
        set({ streamingRequestId: r.requestId ?? null })
        return
      }

      // Phase 8: relay to a peer. We mint a fresh requestId so the
      // per-send stream stays decoupled from the SDK's local
      // requestIds. Events arrive via `onRelayEvent` above and feed
      // the same `streamingContent` / `streamingThinking` accumulators
      // as the local path.
      const requestId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      set({ streamingRequestId: requestId, isStreaming: true })
      const r = await bridge.chat.route({
        requestId,
        targetWriterKey: source.writerKey,
        messages: history,
        modelId: source.modelId
      })
      if (!r.success) {
        set({
          error: r.error
            ? { code: 'ROUTE_FAILED', message: r.error, retryable: true }
            : { code: 'ROUTE_FAILED', message: 'Failed to route', retryable: true },
          isStreaming: false,
          streamingRequestId: null
        })
      }
    },
    cancel: async () => {
      await bridge.aiChat.cancel()
    },
    retry: async () => {
      const last = snapshot.lastUserText
      if (last) await snapshot_send(last)
    },
    setAiSource: (source) => {
      set({ aiSource: source })
    },
    refresh: async () => {
      await refreshSessions()
    }
  }
}

// Local helper so `retry` can call the same code path as `send`
// without losing the `this` binding through destructuring.
async function snapshot_send(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return
  if (snapshot.isStreaming) return
  const userTurn: ChatTurn = {
    id: newId(),
    role: 'user',
    content: trimmed,
    timestamp: new Date().toISOString()
  }
  const history = [...snapshot.messages, userTurn]
  set({
    messages: history,
    streamingContent: '',
    streamingThinking: '',
    streamingModelName: snapshot.aiSource?.modelName ?? null,
    lastUserText: trimmed,
    error: null
  })
  flushSaveNow()
  const r = await bridge.aiChat.send({ messages: history })
  if (!r.success) {
    set({
      error: r.error
        ? { code: 'SEND_FAILED', message: r.error, retryable: true }
        : { code: 'SEND_FAILED', message: 'Failed to send', retryable: true },
      isStreaming: false,
      streamingRequestId: null
    })
    return
  }
  set({ streamingRequestId: r.requestId ?? null })
}
