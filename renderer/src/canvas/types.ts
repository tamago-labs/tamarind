// P2P-ready data model for Tamarind's canvas. The shape is identical
// across Phase 1 (local useReducer) and Phase 3 (Autobase / HyperDB):
// only the storage layer changes. Phase 3 will mirror this union into
// a hyperschema/hyperdb/hyperdispatch spec.

export type GenericShapeType = 'rect' | 'ellipse' | 'line' | 'arrow' | 'note'
export type ShapeType = GenericShapeType

// ── Boards ───────────────────────────────────────────────────────
export interface Board {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  order: number
}

// ── Items ────────────────────────────────────────────────────────
interface ShapeBase {
  x: number
  y: number
  stroke: string
  strokeWidth: number
}

export interface RectItem extends ShapeBase {
  type: 'rect'
  w: number
  h: number
  fill?: string
}

export interface EllipseItem extends ShapeBase {
  type: 'ellipse'
  w: number
  h: number
  fill?: string
}

export interface LineItem extends ShapeBase {
  type: 'line'
  x2: number
  y2: number
  lineCap?: 'round' | 'butt' | 'square'
}

export interface ArrowItem extends ShapeBase {
  type: 'arrow'
  x2: number
  y2: number
  lineCap?: 'round' | 'butt' | 'square'
}

export interface NoteItem extends ShapeBase {
  type: 'note'
  w: number
  h: number
  text: string
  fontSize?: number
}

// Flat item on the canvas. boardId foreign-keys to a Board. Phase 3
// will serialise this exact shape through `@tamarind/item` in the
// HyperDB view; the optional fields collapse to absent-vs-present
// on the wire via hyperschema's `?` optional encoding.
export interface BoardScopedItem {
  id: string
  boardId: string
  type: ShapeType
  x: number
  y: number
  w?: number
  h?: number
  x2?: number
  y2?: number
  text?: string
  stroke: string
  strokeWidth: number
  fill?: string
  lineCap?: 'round' | 'butt' | 'square'
  fontSize?: number
  updatedAt: number
}

// ── Active board ─────────────────────────────────────────────────
export interface ActiveBoard {
  key: 'current'
  boardId: string
}

// ── Hyperdispatch routes (Phase 3) ───────────────────────────────
export const ROUTES = {
  ADD_BOARD: '@tamarind/add-board',
  RENAME_BOARD: '@tamarind/rename-board',
  DELETE_BOARD: '@tamarind/delete-board',
  SET_ACTIVE: '@tamarind/set-active-board',
  ADD_ITEM: '@tamarind/add-item',
  MOVE_ITEM: '@tamarind/move-item',
  REMOVE_ITEM: '@tamarind/remove-item'
} as const

export type RouteName = (typeof ROUTES)[keyof typeof ROUTES]

// ── Defaults ─────────────────────────────────────────────────────
export const DEFAULT_BOARD_NAME = 'Untitled'
export const DEFAULT_STROKE = '#0e4f15' // tamarind-700
export const DEFAULT_STROKE_WIDTH = 2
export const DEFAULT_FILL = 'rgba(33,196,55,0.08)' // tamarind-500 8%
export const SELECT_STROKE = '#21c437' // tamarind-500

export const DEFAULT_SHAPE_SIZE = { w: 160, h: 100 }
export const DEFAULT_NOTE_TEXT = 'Double-click to edit'
export const DEFAULT_NOTE_FONT_SIZE = 12

// ── Helpers ──────────────────────────────────────────────────────
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
export type LineCap = 'round' | 'butt' | 'square'

export function isResizable(type: ShapeType): boolean {
  return type === 'rect' || type === 'ellipse' || type === 'note'
}
