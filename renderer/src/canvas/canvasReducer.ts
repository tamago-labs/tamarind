// Pure reducer over `{ boards, items, activeBoardId, orderCounter }`.
//
// Phase 3 (P2P via Autobase) replaces per-action dispatches with a single
// `snapshot` action that re-derives everything from the worker view.
//
// Edit semantics:
//   • `update-item` carries an optional `meta.transient` flag for fast-path
//     per-pointermove updates (resize, multi-shape drag, snap preview).
//     Transient updates still run the reducer but skip the history push.
//   • `remove-item` / `remove-items` cascade-orphan: any line/arrow whose
//     endpoint references a deleted id is converted to `kind:'orphan'`
//     at the live port position. This must live here, not in the renderer,
//     so Phase 3 peers see identical cascades on replay.
//   • `add-item` / `add-items` consume the monotonic `orderCounter` so
//     z-order is stable and CRDT-friendly (no two peers collide on insert).

import type { ActiveBoard, Board, BoardScopedItem, ConnectorEnd } from './types'
import { DEFAULT_BOARD_NAME, getPortWorld } from './types'

export interface CanvasState {
  boards: Board[]
  items: Record<string, BoardScopedItem>
  activeBoardId: string | null
  // Monotonic counter for `order` assignment on inserts. Phase 3
  // recomputes it to `max(order)+1` on `snapshot` to avoid collisions
  // with items received over the wire.
  orderCounter: number
}

export type Action =
  | { type: 'add-board'; board: Board }
  | { type: 'rename-board'; id: string; name: string; at: number }
  | { type: 'delete-board'; id: string }
  | { type: 'reorder-boards'; order: string[] }
  | { type: 'set-active'; id: string }
  | { type: 'add-item'; item: BoardScopedItem }
  | { type: 'add-items'; items: BoardScopedItem[]; at: number }
  | {
      type: 'update-item'
      id: string
      patch: Partial<BoardScopedItem>
      at: number
      meta?: { transient?: boolean }
    }
  | { type: 'reorder'; id: string; order: number; at: number }
  | { type: 'remove-item'; id: string }
  | { type: 'remove-items'; ids: string[]; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | {
      type: 'snapshot'
      boards: Board[]
      items: BoardScopedItem[]
      activeBoard: ActiveBoard | null
    }

function sortBoards(boards: Board[]): Board[] {
  return [...boards].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.createdAt - b.createdAt
  })
}

// Resolve an endpoint through the pre-removal `items` map and convert
// any `attached` end pointing at a deleted id into `orphan` at the
// live port position. Walks every line/arrow in one pass.
function cascadeWithResolvedCoords(
  items: Record<string, BoardScopedItem>,
  deletedIds: ReadonlySet<string>
): Record<string, BoardScopedItem> {
  if (deletedIds.size === 0) return items
  let mutated = false
  const next: Record<string, BoardScopedItem> = {}
  for (const [id, item] of Object.entries(items)) {
    if (item.type !== 'connector') {
      next[id] = item
      continue
    }
    const start = cascadeEnd(items, item.start, deletedIds)
    const end = cascadeEnd(items, item.end, deletedIds)
    if (start !== item.start || end !== item.end) {
      next[id] = { ...item, start, end }
      mutated = true
    } else {
      next[id] = item
    }
  }
  return mutated ? next : items
}

function cascadeEnd(
  items: Record<string, BoardScopedItem>,
  end: ConnectorEnd | undefined,
  deletedIds: ReadonlySet<string>
): ConnectorEnd | undefined {
  if (!end) return end
  if (end.kind !== 'attached') return end
  if (!deletedIds.has(end.itemId)) return end
  // Look up the host (still present pre-removal) so we capture its
  // port world position at delete-time. If the host is missing
  // somehow (shouldn't be possible here), fall back to (0,0).
  const host = items[end.itemId]
  if (!host) {
    return { kind: 'orphan', x: 0, y: 0, deletedItemId: end.itemId }
  }
  const port = getPortWorld(host, end.port)
  return { kind: 'orphan', x: port.x, y: port.y, deletedItemId: end.itemId }
}

export function canvasReducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'add-board': {
      const boards = sortBoards([...state.boards, action.board])
      return { ...state, boards, activeBoardId: action.board.id }
    }

    case 'rename-board': {
      const trimmed = action.name.trim() || DEFAULT_BOARD_NAME
      const boards = state.boards.map((b) =>
        b.id === action.id ? { ...b, name: trimmed, updatedAt: action.at } : b
      )
      return { ...state, boards }
    }

    case 'delete-board': {
      // No-op when the board doesn't exist locally — peer-authored
      // delete-board frames that race with our own snapshot are
      // already filtered by this guard before we waste a render.
      if (!state.boards.some((b) => b.id === action.id)) return state
      // Never let the state drop below 1 board. The UI hides the
      // delete button when length<=1 (BoardsMenu), but a stale local
      // action or a peer-pushed delete-board targeting our only
      // board would still empty the boards array and leave the canvas
      // with no active board. Drop the action in that case.
      if (state.boards.length <= 1) return state
      const boards = state.boards.filter((b) => b.id !== action.id)
      const items: Record<string, BoardScopedItem> = {}
      for (const [id, item] of Object.entries(state.items)) {
        if (item.boardId !== action.id) items[id] = item
      }
      const activeBoardId =
        state.activeBoardId === action.id ? (boards[0]?.id ?? null) : state.activeBoardId
      return { ...state, boards, items, activeBoardId }
    }

    case 'reorder-boards': {
      const byId = new Map(state.boards.map((b) => [b.id, b]))
      const boards = action.order
        .map((id, i) => {
          const board = byId.get(id)
          if (!board) return null
          return { ...board, order: i }
        })
        .filter((b): b is Board => b !== null)
      return { ...state, boards: sortBoards(boards) }
    }

    case 'set-active': {
      if (!state.boards.some((b) => b.id === action.id)) return state
      return { ...state, activeBoardId: action.id }
    }

    case 'add-item': {
      const order = state.orderCounter
      const item: BoardScopedItem = { ...action.item, order }
      return {
        ...state,
        orderCounter: order + 1,
        items: { ...state.items, [item.id]: item }
      }
    }

    case 'add-items': {
      let n = state.orderCounter
      const items = { ...state.items }
      for (const incoming of action.items) {
        const item: BoardScopedItem = { ...incoming, order: n }
        items[item.id] = item
        n++
      }
      return { ...state, orderCounter: n, items }
    }

    case 'update-item': {
      const existing = state.items[action.id]
      if (!existing) return state
      return {
        ...state,
        items: {
          ...state.items,
          [action.id]: { ...existing, ...action.patch, updatedAt: action.at }
        }
      }
    }

    case 'reorder': {
      const existing = state.items[action.id]
      if (!existing) return state
      return {
        ...state,
        items: {
          ...state.items,
          [action.id]: { ...existing, order: action.order, updatedAt: action.at }
        }
      }
    }

    case 'remove-item': {
      if (!state.items[action.id]) return state
      const deleted = new Set([action.id])
      const filtered: Record<string, BoardScopedItem> = {}
      for (const [id, item] of Object.entries(state.items)) {
        if (id !== action.id) filtered[id] = item
      }
      const items = cascadeWithResolvedCoords(filtered, deleted)
      return { ...state, items }
    }

    case 'remove-items': {
      const deleted = new Set(action.ids)
      const filtered: Record<string, BoardScopedItem> = {}
      for (const [id, item] of Object.entries(state.items)) {
        if (deleted.has(id)) continue
        filtered[id] = item
      }
      const withOrphans = cascadeWithResolvedCoords(filtered, deleted)
      // Touch updatedAt on remaining items so peers see a freshness bump.
      return { ...state, items: withOrphans }
    }

    case 'snapshot': {
      const boards = sortBoards(action.boards)
      const items: Record<string, BoardScopedItem> = {}
      for (const item of action.items) items[item.id] = item
      const activeBoardId =
        action.activeBoard && boards.some((b) => b.id === action.activeBoard!.boardId)
          ? action.activeBoard.boardId
          : (boards[0]?.id ?? null)
      // `order` is required on items; fall back to 0 for any absent
      // remote-only items so sort remains stable. After ingest, the
      // counter advances past the largest observed order so local
      // inserts continue from a clean monotonic position.
      const maxOrder = action.items.reduce((acc, it) => Math.max(acc, it.order ?? 0), 0)
      return { boards, items, activeBoardId, orderCounter: maxOrder + 1 }
    }

    // 'undo' and 'redo' are intercepted by the history wrapper before
    // they reach here. They're part of the Action union so the
    // dispatch type-checks at call sites.
    default:
      return state
  }
}
