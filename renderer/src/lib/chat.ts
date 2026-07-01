// ChatMessage — the shape the renderer receives from the room worker
// over IPC. `info` carries the writer's stable z32 pubkey + the
// display name they had at send time. The renderer uses `info.key`
// for "You" attribution (matching the worker's own writer pubkey)
// and `info.name` as the visible label.

import type { BoardScopedChatMessage } from './room'

export interface ChatMessageInfo {
  name: string
  key: string
  at: number
}

export type ChatMessage = BoardScopedChatMessage

export function isFromMe(msg: ChatMessage, myKey: string | null): boolean {
  if (!myKey || !msg.info) return false
  return msg.info.key === myKey
}
