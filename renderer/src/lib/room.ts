// Room worker IPC helpers. Wraps `bridge.writeWorkerIPC(ROOM_WORKER, …)`
// with JSON framing for the protocol documented in
// `C:\Users\pisut\.claude\plans\nested-beaming-reef.md`.
//
// The `ROOM_WORKER` specifier is set by `electron/main.js`'s
// `getWorker()` factory; calling `bridge.startWorker(ROOM_WORKER)` is
// idempotent — repeated calls reuse the cached worker pipe.

import { bridge, ROOM_WORKER } from './bridge'
import type { Action } from '../canvas/canvasReducer'

// Outbound frames the renderer can send to the room worker.
export type RoomFrame =
  | { type: 'join-invite'; invite: string }
  | { type: 'create-invite' }
  | { type: 'state-action'; action: Action }
  | { type: 'send-chat'; text: string }
  | { type: 'rename-self'; name: string }

// Inbound frames the worker pushes back. Discriminated by `type`.
export type RoomEvent =
  | { type: 'status'; phase: 'starting' | 'ready' | 'error'; error?: string }
  | { type: 'role'; role: 'host' | 'guest'; writable: boolean }
  | { type: 'invite'; invite: string }
  | { type: 'snapshot'; state: SnapshotState }
  | { type: 'chat'; messages: BoardScopedChatMessage[] }
  | { type: 'peers'; count: number }
  | { type: 'me'; key: string; name: string }

export interface SnapshotState {
  boards: BoardSnapshot[]
  items: BoardScopedItemSnapshot[]
  activeBoardId: string | null
  orderCounter: number
}

export interface BoardSnapshot {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  order: number
}

// Worker-decoded item: ids are hex strings (renderer-side), connector
// endpoints are decoded back into objects.
export interface BoardScopedItemSnapshot {
  id: string
  boardId: string
  type: string
  x: number
  y: number
  w?: number
  h?: number
  start?: { kind: string; [k: string]: unknown }
  end?: { kind: string; [k: string]: unknown }
  text?: string
  stroke: string
  strokeWidth: number
  fill?: string
  lineCap?: string
  fontSize?: number
  order: number
  updatedAt: number
}

export interface BoardScopedChatMessage {
  id: string
  text: string
  info: { name: string; key: string; at: number } | null
}

export function writeRoom(frame: RoomFrame): Promise<void> {
  return bridge.writeWorkerIPC(ROOM_WORKER, JSON.stringify(frame))
}

export function onRoomEvent(listener: (event: RoomEvent) => void): () => void {
  return bridge.onWorkerIPC(ROOM_WORKER, (data) => {
    const text =
      typeof data === 'string'
        ? data
        : typeof TextDecoder !== 'undefined'
          ? new TextDecoder().decode(data)
          : Buffer.from(data).toString('utf-8')
    try {
      const event = JSON.parse(text) as RoomEvent
      // eslint-disable-next-line no-console
      console.log('[tamarind] room event:', event.type, JSON.stringify(event).slice(0, 160))
      listener(event)
    } catch (err) {
      console.error('[tamarind] failed to parse room frame:', err, text)
    }
  })
}
