// AI chat chokepoint. Owns the @qvac/sdk `completion()` call for the
// local Tamarind session and forwards streaming events to the renderer
// over IPC push channels.
//
// Phase 1: local-only. Streams directly from the loaded model in
// electron/qvac.js. Phase 3 will route to a peer's model via
// electron/aiChatRelay.js, but the local chokepoint stays the same
// for the requester side too (the relay just transports the request
// to a peer's identical chokepoint).
//
// Design notes (from the reference project review):
//   - `stream: true, kvCache: true, captureThinking: true` — matches
//     my-doctor-ai and walrus-form-studio.
//   - **No `tools` argument** — tool calling is out of scope for
//     Tamarind. The model itself is loaded with `tools: false` in
//     modelConfig; we additionally omit `tools` here so the SDK
//     never sees tool definitions.
//   - Single-flight: a second `sendMessage` while a stream is in
//     flight returns `{ success: false, error: 'BUSY' }`.
//   - The renderer's `useAIChat` listens for `ai:chat:done` and
//     commits the streamed content into a finalized message.

const { completion, cancel: sdkCancel } = require('@qvac/sdk')
const { mapError, getActiveModelId, setStreamingNow } = require('./qvac')

// ───────────────────────────── module state ─────────────────────────────

let mainWindowRef = /** @type {Electron.BrowserWindow|null} */ (null)
let currentRequestId = /** @type {string|null} */ (null)
let currentAbort = /** @type {AbortController|null} */ (null)
let startedAt = /** @type {number|null} */ (null)

function send(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload)
  }
}

// ───────────────────────────── public API ────────────────────────────────

function setMainWindow(window) {
  mainWindowRef = window
}

function getStatus() {
  return {
    isStreaming: currentRequestId !== null,
    requestId: currentRequestId,
    startedAt
  }
}

function isBusy() {
  return currentRequestId !== null
}

/**
 * Notify the rest of the system that local inference is currently
 * busy (`accepting: false`) or free (`accepting: true`). Called by
 * `electron/main.js` after a successful `sendMessage` start (false)
 * and on the `done` / `error` settle (true). Phase 2 + 3 mirror
 * this into a P2P-replicated `ai-state` row so peers can see
 * whether to route to us.
 */
function setAccepting(_accepting) {
  // No-op locally — the relay pushes the new ai-state to the room
  // worker, which broadcasts the `update-ai-state` dispatch.
  // (Hooked up in Step 7 — Phase 2.)
}

async function sendMessage({ messages }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: 'messages must be a non-empty array' }
  }
  if (currentRequestId !== null) {
    return { success: false, error: 'BUSY' }
  }
  const modelId = getActiveModelId()
  if (!modelId) {
    return { success: false, error: 'No model loaded. Pick one in Setup.' }
  }

  // Map our `ChatTurn` shape to the SDK's history. The SDK only
  // needs role + content; the optional `thinking` is dropped (the
  // SDK re-derives thinking from `<think>` tags via captureThinking).
  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({ role: m.role, content: m.content }))

  if (history.length === 0) {
    return { success: false, error: 'No user/assistant messages to send' }
  }

  currentAbort = new AbortController()
  startedAt = Date.now()
  setStreamingNow(true)

  // The SDK doesn't take an AbortSignal directly; we mirror via
  // cancel() in cancelMessage(). The requestId is set on the
  // returned `run` object synchronously.
  const run = completion({
    modelId,
    history,
    stream: true,
    kvCache: true,
    captureThinking: true
    // tools: undefined — explicitly omitted, never pass tool defs
  })
  currentRequestId = run.requestId
  setAccepting(false)
  send('ai:chat:status', getStatus())

  // Drive the event stream asynchronously. We don't await the loop
  // here — `sendMessage` resolves once the run is *started*. The
  // renderer's `useAIChat` subscribes to `ai:chat:done` /
  // `ai:chat:error` for completion. Errors thrown from the loop
  // are caught and forwarded; the loop never rejects unhandled.
  driveStream(run).catch((err) => {
    console.error('[aiChat] driveStream unhandled error:', err)
  })

  return { success: true, requestId: run.requestId }
}

async function cancelMessage() {
  if (currentRequestId === null) {
    return { success: true, error: 'Nothing to cancel' }
  }
  const id = currentRequestId
  try {
    await sdkCancel({ requestId: id })
  } catch (err) {
    if (err && err.name === 'InferenceCancelledError') {
      // Expected — the loop will emit its own done/error.
    } else {
      console.warn('[aiChat] cancel failed:', err)
    }
  }
  return { success: true, requestId: id }
}

// ───────────────────────────── internals ─────────────────────────────────

async function driveStream(run) {
  let settled = false
  function settle(kind, payload) {
    if (settled) return
    settled = true
    currentRequestId = null
    currentAbort = null
    startedAt = null
    setStreamingNow(false)
    setAccepting(true)
    send('ai:chat:status', getStatus())
    send(kind, { requestId: run.requestId, ...payload })
  }

  try {
    for await (const event of run.events) {
      if (event.type === 'contentDelta') {
        send('ai:chat:token', { requestId: run.requestId, text: event.text })
      } else if (event.type === 'thinkingDelta') {
        send('ai:chat:thinking', { requestId: run.requestId, text: event.text })
      } else if (event.type === 'completionStats') {
        // Useful for the renderer's "X tok/s" indicator. Cheap to
        // forward; the renderer ignores it if it doesn't care.
        send('ai:chat:stats', { requestId: run.requestId, stats: event.stats })
      } else if (event.type === 'completionDone') {
        if (event.stopReason === 'error' && event.error) {
          settle('ai:chat:error', {
            error: {
              code: 'COMPLETION_ERROR',
              message: event.error.message,
              retryable: true
            }
          })
        } else {
          settle('ai:chat:done', {
            stopReason: event.stopReason ?? 'eos'
          })
        }
      }
      // `rawDelta` and `toolCall` are intentionally ignored — raw
      // bypasses the parsed stream and we don't do tool calling.
    }
    // Stream ended without an explicit `completionDone` event. Still
    // treat as success (older SDK versions may finalize this way).
    settle('ai:chat:done', { stopReason: 'eos' })
  } catch (err) {
    const mapped = mapError(err)
    settle('ai:chat:error', { error: mapped })
  }
}

module.exports = {
  setMainWindow,
  getStatus,
  isBusy,
  setAccepting,
  sendMessage,
  cancelMessage
}
