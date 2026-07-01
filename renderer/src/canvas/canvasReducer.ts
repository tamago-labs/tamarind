// Pure reducer over `{ boards, items, activeBoardId }`. Identical
// shape across Phase 1 (local) and Phase 3 (worker → snapshot).
// Phase 3 replaces per-action dispatches with a single `snapshot`
// action that re-derives everything from the Autobase view.

import type { ActiveBoard, Board, BoardScopedItem } from './types'
import { DEFAULT_BOARD_NAME } from './types'

export interface CanvasState {
  boards: Board[]
  items: Record<string, BoardScopedItem>
  activeBoardId: string | null
}

export type Action =
  | { type: 'add-board'; board: Board }
  | { type: 'rename-board'; id: string; name: string; at: number }
  | { type: 'delete-board'; id: string }
  | { type: 'reorder-boards'; order: string[] }
  | { type: 'set-active'; id: string }
  | { type: 'add-item'; item: BoardScopedItem }
  | { type: 'move-item'; id: string; x: number; y: number; at: number }
  | { type: 'update-item'; id: string; patch: Partial<BoardScopedItem>; at: number }
  | { type: 'remove-item'; id: string }
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
      return { ...state, items: { ...state.items, [action.item.id]: action.item } }
    }

    case 'move-item': {
      const existing = state.items[action.id]
      if (!existing) return state
      return {
        ...state,
        items: {
          ...state.items,
          [action.id]: { ...existing, x: action.x, y: action.y, updatedAt: action.at }
        }
      }
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

    case 'remove-item': {
      if (!state.items[action.id]) return state
      const items = { ...state.items }
      delete items[action.id]
      return { ...state, items }
    }

    case 'snapshot': {
      const boards = sortBoards(action.boards)
      const items: Record<string, BoardScopedItem> = {}
      for (const item of action.items) items[item.id] = item
      const activeBoardId =
        action.activeBoard && boards.some((b) => b.id === action.activeBoard!.boardId)
          ? action.activeBoard.boardId
          : (boards[0]?.id ?? null)
      return { boards, items, activeBoardId }
    }
  }
}
