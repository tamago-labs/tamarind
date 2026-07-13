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
//   - `aiSource` defaults to `null` on launch (per the user's locked-
//     in decision — explicit choice, no fallback). The user must pick
//     a source in the Setup tab before they can send. No persistence,
//     no auto-derivation from peer AI states. If a peer source
//     disappears mid-session, the source is cleared and the user
//     must pick again — never an automatic fallback to local.

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { bridge } from '../lib/bridge'
import { uid } from '../canvas/id'
import { getActiveBoardId, getRoomSnapshot } from './useRoom'
import { writeRoom } from '../lib/room'
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

// Watchdog for stuck relay requests. The relay path goes through
// main → worker → Autobase → peer → peer-worker → peer-main → peer-
// renderer. If any of those silently fails (network, pipe, schema,
// etc.) the renderer is left in `isStreaming: true` forever and the
// user sees a "frozen" chat. After 60s of no relay events for the
// current requestId, surface a clear timeout error and re-enable
// the input. The check is per-event so any token / done / error
// resets the timer.
const RELAY_WATCHDOG_MS = 60_000
let watchdogHandle: ReturnType<typeof setTimeout> | null = null
let watchedRequestId: string | null = null

function armRelayWatchdog(requestId: string) {
  cancelRelayWatchdog()
  watchedRequestId = requestId
  watchdogHandle = setTimeout(() => {
    if (watchedRequestId !== requestId) return
    if (!snapshot.isStreaming) return
    if (snapshot.streamingRequestId !== requestId) return
    set({
      error: {
        code: 'RELAY_TIMEOUT',
        message:
          'No response from host after 60s — check that the host is reachable and the model is loaded.',
        retryable: true
      },
      isStreaming: false,
      streamingRequestId: null
    })
    cancelRelayWatchdog()
  }, RELAY_WATCHDOG_MS)
}

function kickRelayWatchdog(requestId: string) {
  if (watchedRequestId === requestId) armRelayWatchdog(requestId)
}

function cancelRelayWatchdog() {
  if (watchdogHandle) {
    clearTimeout(watchdogHandle)
    watchdogHandle = null
  }
  watchedRequestId = null
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Handle tool calls from the AI. Executes the tool against the canvas
// and sends the result back to the main process for the AI to continue.
async function handleToolCall(
  requestId: string,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    let result: Record<string, unknown> = { success: true }

    if (name === 'get_items') {
      // Return current items from the room snapshot
      const snapshot = getRoomSnapshot()
      const activeBoardId = getActiveBoardId()
      const items =
        snapshot?.items?.filter((i: Record<string, unknown>) => i.boardId === activeBoardId) ?? []
      result = {
        success: true,
        count: items.length,
        items: items.map((i: Record<string, unknown>) => ({
          id: i.id,
          type: i.type,
          text: i.text || '',
          x: Math.round(i.x as number),
          y: Math.round(i.y as number)
        })),
        hint: 'Use the "id" field (hex string) when calling update_items'
      }
    } else if (name === 'add_items') {
      // Execute add-items against the canvas worker
      // AI sends partial items — fill in required fields with defaults
      const rawItems = args.items as Array<Record<string, unknown>>
      if (Array.isArray(rawItems) && rawItems.length > 0) {
        const now = Date.now()
        const activeBoardId = getActiveBoardId() ?? ''
        const items = rawItems.map((raw) => {
          const type = String(raw.type ?? 'rect')
          // Helper to safely get string value, handling undefined, null, and string "undefined"
          const safeStr = (val: unknown, fallback: string): string => {
            if (val === undefined || val === null || val === 'undefined' || val === 'null') {
              return fallback
            }
            const s = String(val).trim()
            return s || fallback
          }
          const base = {
            id: uid(),
            boardId: activeBoardId,
            type,
            x: Number(raw.x) || 0,
            y: Number(raw.y) || 0,
            w: Number(raw.w) || 160,
            h: Number(raw.h) || 100,
            text: safeStr(raw.text, ''),
            fill: safeStr(raw.fill, '#ffffff'),
            stroke: safeStr(raw.stroke, '#000000'),
            strokeWidth: Number(raw.strokeWidth) || 2,
            fontSize: Number(raw.fontSize) || 12,
            order: 0,
            updatedAt: now
          }
          // Add connector-specific fields only for connector type
          if (type === 'connector') {
            return {
              ...base,
              start: { kind: 'free', x: Number(raw.startX) || 0, y: Number(raw.startY) || 0 },
              end: { kind: 'free', x: Number(raw.endX) || 0, y: Number(raw.endY) || 0 },
              arrowStart: 'none',
              arrowEnd: 'arrow',
              strokePattern: 'solid',
              curve: 'straight',
              label: raw.label ? { text: String(raw.label), at: 'middle' } : undefined
            }
          }
          return base
        })
        await writeRoom({
          type: 'state-action',
          action: { type: 'add-items', items, at: now }
        })
        result = {
          success: true,
          count: items.length,
          items: items.map((i) => ({
            id: i.id,
            type: i.type,
            text: i.text || ''
          })),
          message: `Added ${items.length} shape(s). Use the "id" field to update.`
        }
      }
    } else if (name === 'update_items') {
      const updates = args.updates as Array<{ id: string; patch: Record<string, unknown> }>
      console.log('[useAIChat] update_items received:', JSON.stringify(updates))
      if (Array.isArray(updates)) {
        for (const update of updates) {
          console.log('[useAIChat] update-item patch:', JSON.stringify(update.patch))
          await writeRoom({
            type: 'state-action',
            action: {
              type: 'update-item',
              id: update.id,
              patch: update.patch,
              at: Date.now()
            }
          })
        }
        result = {
          success: true,
          count: updates.length,
          message: `Successfully updated ${updates.length} shape(s)`
        }
      }
    } else if (name === 'remove_items') {
      const ids = args.ids as string[]
      if (Array.isArray(ids)) {
        await writeRoom({
          type: 'state-action',
          action: { type: 'remove-items', ids }
        })
        result = {
          success: true,
          count: ids.length,
          message: `Successfully removed ${ids.length} shape(s) from the canvas`
        }
      }
    } else if (name === 'search_knowledge_base') {
      const query = args.query as string
      const topK = (args.top_k as number) ?? 5
      const searchResult = await bridge.rag.search({ query, topK })

      if (searchResult.success && searchResult.results) {
        result = {
          success: true,
          count: searchResult.results.length,
          results: searchResult.results.map((r) => ({
            content: r.content,
            score: r.score
          }))
        }
      } else {
        result = { success: false, error: searchResult.error || 'Search failed' }
      }
    } else {
      result = { success: false, error: `Unknown tool: ${name}` }
    }

    // Send result back to main process via fire-and-forget event
    // (not invoke — the main process is waiting on an ipcMain.on listener)
    bridge.aiChat.sendToolResult(requestId, result)
  } catch (err) {
    console.error('[useAIChat] Tool execution failed:', err)
    bridge.aiChat.sendToolResult(requestId, {
      success: false,
      error: err instanceof Error ? err.message : 'Tool execution failed'
    })
  }
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
    // Update streamingRequestId when a new completion starts (agentic loop)
    // This ensures tokens from subsequent completions are accepted
    set({
      isStreaming: e.isStreaming,
      ...(e.requestId ? { streamingRequestId: e.requestId } : {})
    })
  })
  bridge.aiChat.onToken((e: ChatTokenEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    if (snapshot.streamingRequestId === null) {
      set({ streamingRequestId: e.requestId })
    }
    set({ streamingContent: snapshot.streamingContent + e.text })
    kickRelayWatchdog(e.requestId)
  })
  bridge.aiChat.onThinking((e: ChatThinkingEvent) => {
    if (snapshot.streamingRequestId !== null && e.requestId !== snapshot.streamingRequestId) {
      return
    }
    if (snapshot.streamingRequestId === null) {
      set({ streamingRequestId: e.requestId })
    }
    set({ streamingThinking: snapshot.streamingThinking + e.text })
    kickRelayWatchdog(e.requestId)
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
    cancelRelayWatchdog()
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
    cancelRelayWatchdog()
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
  // peers are connected — events just stay quiet. We use this only
  // for *validation*: if the current source is a peer and that peer
  // disappears from the room (model unloaded, writer dropped, etc.)
  // we clear the source so the AI chat input disables and the user
  // is forced to pick a new one. We never auto-derive a source from
  // peer state — the user must click a row in the Setup tab.
  bridge.onPeerAiStates((states) => {
    const current = snapshot.aiSource
    if (current?.kind === 'peer') {
      const still = Array.isArray(states)
        ? states.find((s) => s.writerKey === current.writerKey)
        : null
      if (!still) {
        // Peer is gone — clear the source. No auto-fallback.
        set({ aiSource: null })
      }
    }
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
      kickRelayWatchdog(e.requestId)
    } else if (e.kind === 'thinking' && typeof e.text === 'string') {
      set({ streamingThinking: snapshot.streamingThinking + e.text })
      kickRelayWatchdog(e.requestId)
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
      cancelRelayWatchdog()
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
      cancelRelayWatchdog()
    }
  })

  // Canvas tool calling — when the AI wants to modify the canvas,
  // the main process forwards the tool call to us. We execute the
  // tool against the canvas via useRoom.sendAction and send the
  // result back to the main process for the AI to continue.
  bridge.aiChat.onToolCall(
    (e: { requestId: string; name: string; args: Record<string, unknown> }) => {
      console.log('[useAIChat] Tool call received:', e.name, e.args)
      handleToolCall(e.requestId, e.name, e.args)
    }
  )

  // Hydrate initial sessions list + pinned `main`. The `aiSource`
  // starts as `null` — the user must pick a source (local or a peer)
  // in the Setup tab before sending. Locked-in decision: explicit
  // choice, no auto-derivation, no fallback. The pick is never
  // persisted across launches.
  await refreshSessions()
  await loadSession('main')
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
      armRelayWatchdog(requestId)
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
        cancelRelayWatchdog()
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
