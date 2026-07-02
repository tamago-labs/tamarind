// useRoom — subscribes to the room worker IPC and exposes a reactive
// view of its current state plus idempotent mutators. The reducer
// integration lives in `CanvasPage.tsx`; this hook is the data-
// fetching seam.
//
// Singleton design: every `useRoom()` call shares one module-level
// `roomStore`. Without the singleton, mounting this hook twice (e.g.
// once in `App.tsx` for the splash and again in `CanvasPage` after
// the splash dismisses) yields two independent React states; if a
// worker event arrives between the two mounts, the later instance
// starts at `'starting' / peers=0` and never catches up. The
// singleton stores the latest value once and replays it to every
// subscriber.

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { bridge, ROOM_WORKER } from '../lib/bridge'
import { onRoomEvent, writeRoom, type SnapshotState } from '../lib/room'
import type { Action } from '../canvas/canvasReducer'
import type { ChatMessage } from '../lib/chat'

export type RoomStatus = 'starting' | 'ready' | 'error'
export type RoomRole = 'host' | 'guest'
export type Me = { key: string; name: string }

export interface RoomState {
  status: RoomStatus
  role: RoomRole | null
  writable: boolean
  invite: string | null
  peers: number
  me: Me | null
  snapshot: SnapshotState | null
  chat: ChatMessage[]
  error: string | null
}

const initialState: RoomState = {
  status: 'starting',
  role: null,
  writable: false,
  invite: null,
  peers: 0,
  me: null,
  snapshot: null,
  chat: [],
  error: null
}

// Room-event union (subset of `room.ts.RoomEvent`). Inlined here so
// this module is the sole owner of the store's mutation surface.
type RoomEvent =
  | { type: 'status'; phase: 'starting' | 'ready' | 'error'; error?: string }
  | { type: 'role'; role: 'host' | 'guest'; writable: boolean }
  | { type: 'invite'; invite: string }
  | { type: 'snapshot'; state: SnapshotState }
  | { type: 'chat'; messages: ChatMessage[] }
  | { type: 'peers'; count: number }
  | { type: 'me'; key: string; name: string }

// Module-level singleton. `version` is what `useSyncExternalStore`
// reads as the snapshot — bumping it is how we tell React "the store
// changed, please re-render".
const store: RoomState & { version: number } = { ...initialState, version: 0 }
const listeners = new Set<() => void>()

let startPromise: Promise<boolean> | null = null
let unsubscribe: (() => void) | null = null

function bumpAndEmit() {
  store.version++
  for (const l of listeners) l()
}

function apply(event: RoomEvent) {
  switch (event.type) {
    case 'status':
      store.status =
        event.phase === 'starting' ? 'starting' : event.phase === 'ready' ? 'ready' : 'error'
      store.error = event.error ?? null
      break
    case 'role':
      store.role = event.role
      store.writable = Boolean(event.writable)
      break
    case 'invite':
      store.invite = event.invite
      break
    case 'peers':
      store.peers = event.count
      break
    case 'me':
      store.me = { key: event.key, name: event.name }
      break
    case 'snapshot':
      store.snapshot = event.state
      break
    case 'chat':
      store.chat = event.messages
      break
  }
  bumpAndEmit()
}

function reset() {
  // The worker either crashed or was intentionally restarted (host →
  // guest swap). Wipe stale state so the new worker's first
  // `status:starting` event lands on a clean slate.
  Object.assign(store, initialState)
  bumpAndEmit()
}

function ensureStarted(): Promise<boolean> {
  if (startPromise) return startPromise
  startPromise = bridge
    .startWorker(ROOM_WORKER)
    .then(() => {
      if (!unsubscribe) {
        unsubscribe = onRoomEvent((event) => apply(event as RoomEvent))
        // `pear:joinWithInvite` kills + respawns the room worker in
        // main.js; the renderer needs to forget everything from the
        // previous boot before the new worker's events arrive.
        bridge.onWorkerExit(ROOM_WORKER, () => reset())
      }
      return true
    })
    .catch((err: unknown) => {
      console.error('[tamarind] failed to start room worker:', err)
      startPromise = null
      throw err
    })
  return startPromise
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const getSnapshot = () => store.version

// Test hook — let CDP-driven smoke tests fire actions directly past the
// UI guards. Mirrors the filter in `sendAction` so we send exactly the
// same wire frames React does.
export function dispatchActionForTest(action: Action): void {
  if (
    action.type === 'undo' ||
    action.type === 'redo' ||
    action.type === 'snapshot' ||
    action.type === 'set-active' ||
    action.type === 'reorder-boards'
  ) {
    return
  }
  if (action.type === 'update-item' && action.meta?.transient) return
  writeRoom({ type: 'state-action', action }).catch((err) => {
    console.error('[tamarind] dispatchActionForTest failed:', err)
  })
}

export function useRoom(): RoomState & {
  sendAction: (action: Action) => void
  sendChat: (text: string) => void
  removeChats: (ids: string[]) => void
  clearChat: () => void
  joinInvite: (invite: string) => void
  createInvite: () => void
  renameSelf: (name: string) => void
} {
  useEffect(() => {
    let cancelled = false
    ensureStarted().then(() => {
      if (cancelled) return
      // Replay any events that arrived between worker boot and
      // listener attachment. apply() was already called for those by
      // the (already-attached) onRoomEvent listener above; we just
      // need to make sure subsequent events fire.
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Tells React to re-render whenever `store.version` changes. The
  // store object's fields above are mutated in place, but React only
  // sees them via useSyncExternalStore(..., getSnapshot) returning a
  // fresh value.
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // ── Mutators ────────────────────────────────────────────────────
  // Filter out local-only / transient actions so we never spam the
  // wire. `undo` / `redo` / `snapshot` are renderer-internal;
  // `update-item` with `meta.transient` is per-pointermove preview;
  // `set-active` / `reorder-boards` are device-local UI state.
  const sendAction = useCallback((action: Action) => {
    if (!store.writable) return
    if (
      action.type === 'undo' ||
      action.type === 'redo' ||
      action.type === 'snapshot' ||
      action.type === 'set-active' ||
      action.type === 'reorder-boards'
    ) {
      return
    }
    if (action.type === 'update-item' && action.meta?.transient) return
    writeRoom({ type: 'state-action', action }).catch((err) => {
      console.error('[tamarind] sendAction failed:', err)
    })
  }, [])

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    writeRoom({ type: 'send-chat', text: trimmed }).catch((err) => {
      console.error('[tamarind] sendChat failed:', err)
    })
  }, [])

  // Per-message delete (ids = [one]) and bulk clear (ids = []). Both
  // round-trip through the same `@tamarind/remove-chats` route; the
  // worker interprets an empty `ids` array as "delete every chat row".
  // Permission model mirrors `sendChat`: only writable peers can fire
  // the frame (the worker enforces writability via `_onFrame` order — it
  // never sees this frame when `writable` is false because the
  // renderer's `useRoom` is the gate).
  const removeChats = useCallback((ids: string[]) => {
    if (!store.writable) return
    writeRoom({ type: 'remove-chats', ids: ids.slice() }).catch((err) => {
      console.error('[tamarind] removeChats failed:', err)
    })
  }, [])
  const clearChat = useCallback(() => {
    if (!store.writable) return
    writeRoom({ type: 'remove-chats', ids: [] }).catch((err) => {
      console.error('[tamarind] clearChat failed:', err)
    })
  }, [])

  const joinInvite = useCallback((invite: string) => {
    // Tells main.js to kill + respawn the room worker with `--invite
    // <code>`. The renderer doesn't wait — the worker exit / restart
    // drives a fresh status → role → invite cycle through `useRoom`'s
    // existing IPC subscription.
    bridge.joinWithInvite(invite).catch((err) => {
      console.error('[tamarind] joinInvite failed:', err)
    })
  }, [])

  const createInvite = useCallback(() => {
    writeRoom({ type: 'create-invite' }).catch((err) => {
      console.error('[tamarind] createInvite failed:', err)
    })
  }, [])

  const renameSelf = useCallback((name: string) => {
    writeRoom({ type: 'rename-self', name }).catch((err) => {
      console.error('[tamarind] renameSelf failed:', err)
    })
  }, [])

  return {
    status: store.status,
    role: store.role,
    writable: store.writable,
    invite: store.invite,
    peers: store.peers,
    me: store.me,
    snapshot: store.snapshot,
    chat: store.chat,
    error: store.error,
    sendAction,
    sendChat,
    removeChats,
    clearChat,
    joinInvite,
    createInvite,
    renameSelf
  }
}

// Test hook — exposed only for smoke tests. Lets the harness probe
// the live store without depending on UI text.
export function __tamarindRoomStoreForTest(): {
  peek: () => RoomState
} {
  return {
    peek: () => ({
      status: store.status,
      role: store.role,
      writable: store.writable,
      invite: store.invite,
      peers: store.peers,
      me: store.me ? { ...store.me } : null,
      snapshot: store.snapshot,
      chat: store.chat,
      error: store.error
    })
  }
}
