// P2P-ready data model for Tamarind's canvas. The shape is identical
// across Phase 1 (local useReducer) and Phase 3 (Autobase / HyperDB):
// only the storage layer changes. Phase 3 will mirror this union into
// a hyperschema/hyperdb/hyperdispatch spec.

export type GenericShapeType = 'rect' | 'ellipse' | 'connector' | 'text' | 'note'
export type ShapeType = GenericShapeType

// ── Boards ───────────────────────────────────────────────────────
export interface Board {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  order: number
}

// ── Connector model ──────────────────────────────────────────────
// A line/arrow has two ends (`start`, `end`), each resolving to world
// coordinates at render time. `attached` ends track a host shape's
// port and move with it. `orphan` ends remember the deleted shape's
// port position so the line stays visually in place after the host is
// removed. `free` ends carry explicit world coordinates.
export type Port = 'top' | 'right' | 'bottom' | 'left'

export type ConnectorEnd =
  | { kind: 'free'; x: number; y: number }
  | { kind: 'attached'; itemId: string; port: Port }
  | { kind: 'orphan'; x: number; y: number; deletedItemId: string }

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
  text?: string
  fontSize?: number
}

export interface EllipseItem extends ShapeBase {
  type: 'ellipse'
  w: number
  h: number
  fill?: string
  text?: string
  fontSize?: number
}

// Free-floating text shape. Resizable bbox, no visible border (the bbox
// exists only for hit-testing + selection overlay + resize handles).
// `fill` is absent because text has no body — only the glyphs.
export interface TextItem extends ShapeBase {
  type: 'text'
  w: number
  h: number
  text?: string
  fontSize?: number
}

// Sticky note with folded corner effect. Yellow default, always has text.
// Used for tactical planning notes, reminders, and annotations.
export interface NoteItem extends ShapeBase {
  type: 'note'
  w: number
  h: number
  fill?: string
  text?: string
  fontSize?: number
}

// Connector (Phase 3 — replaces the old separate LineItem and ArrowItem).
// Endpoints live in `start` / `end`. `x` and `y` mirror the effective
// start so the item still has a stable position for sorting and marquee
// hit-testing. Optional styling fields: arrowhead at either end, stroke
// pattern (solid/dashed/dotted), curve (straight/bezier), and an inline
// label (great for "pass" / "won" annotations on tactical diagrams).
export interface ConnectorLabel {
  text: string
  at: 'start' | 'middle' | 'end'
  fontSize?: number
}

export interface ConnectorItem extends ShapeBase {
  type: 'connector'
  lineCap?: LineCap
  start: ConnectorEnd
  end: ConnectorEnd
  arrowStart?: 'none' | 'arrow'
  arrowEnd?: 'none' | 'arrow'
  strokePattern?: 'solid' | 'dashed' | 'dotted'
  curve?: 'straight' | 'bezier'
  label?: ConnectorLabel
}

// Flat item on the canvas. boardId foreign-keys to a Board. Phase 3
// will serialise this exact shape through `@tamarind/item` in the
// HyperDB view; the optional fields collapse to absent-vs-present on
// the wire via hyperschema's `?` optional encoding.
export interface BoardScopedItem {
  id: string
  boardId: string
  type: ShapeType
  // Always present — primary world position. For connectors, mirrors
  // the effective start point (or kept current if start is attached).
  x: number
  y: number
  w?: number
  h?: number
  // Connector endpoints — only set when type is 'connector'.
  start?: ConnectorEnd
  end?: ConnectorEnd
  text?: string
  stroke: string
  strokeWidth: number
  fill?: string
  lineCap?: LineCap
  fontSize?: number
  textAlign?: 'left' | 'center' | 'right'
  textAlignVertical?: 'top' | 'middle' | 'bottom'
  // Phase 3 connector-only styling. Optional; absent decodes to the
  // visual default (no arrowheads at either end, solid stroke, straight
  // curve, no label).
  arrowStart?: 'none' | 'arrow'
  arrowEnd?: 'none' | 'arrow'
  strokePattern?: 'solid' | 'dashed' | 'dotted'
  curve?: 'straight' | 'bezier'
  label?: ConnectorLabel
  // Z-order — assigned at construction by the reducer's monotonic
  // `orderCounter` field on `CanvasState`.
  order: number
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
export const DEFAULT_STROKE = '#000000'
export const DEFAULT_STROKE_WIDTH = 2
export const DEFAULT_FILL = '#ffffff'
export const SELECT_STROKE = '#3b82f6' // tailwind blue-500; matches the marquee overlay

export const DEFAULT_SHAPE_SIZE = { w: 160, h: 100 }
export const DEFAULT_NOTE_SIZE = { w: 120, h: 80 }
export const DEFAULT_NOTE_FILL = '#fef3c7'
export const DEFAULT_NOTE_TEXT = ''
export const DEFAULT_NOTE_FONT_SIZE = 12
export const DEFAULT_TEXT_SIZE = { w: 220, h: 60 }
// Text shapes usually hold titles/labels, so start at a larger readable size.
export const DEFAULT_TEXT_FONT_SIZE = 18
export const CONNECTOR_HIT_RADIUS = 8 // world units, half-thickness of the invisible hit stroke

// ── Helpers ──────────────────────────────────────────────────────
export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'
export type LineCap = 'round' | 'butt' | 'square'

export function isResizable(type: ShapeType): boolean {
  return type === 'rect' || type === 'ellipse' || type === 'text' || type === 'note'
}

export function isConnector(type: ShapeType): boolean {
  return type === 'connector'
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

// World-coords for a single port of a shape. Used by connector
// endpoint resolution and by the snap-target hit test.
export function getPortWorld(item: BoardScopedItem, port: Port): { x: number; y: number } {
  const w = item.w ?? DEFAULT_SHAPE_SIZE.w
  const h = item.h ?? DEFAULT_SHAPE_SIZE.h
  switch (port) {
    case 'top':
      return { x: item.x + w / 2, y: item.y }
    case 'right':
      return { x: item.x + w, y: item.y + h / 2 }
    case 'bottom':
      return { x: item.x + w / 2, y: item.y + h }
    case 'left':
      return { x: item.x, y: item.y + h / 2 }
  }
}

// Resolve a ConnectorEnd to world coordinates. `attached` resolves via
// the live item in `itemsById`; `free` and `orphan` return the stored
// x,y. If the host item is missing for an `attached` end, we fall
// back to (0,0) — orphan cascade in the reducer is the canonical fix.
export function resolveEnd(
  end: ConnectorEnd,
  itemsById: Record<string, BoardScopedItem>
): { x: number; y: number } {
  if (end.kind === 'free' || end.kind === 'orphan') return { x: end.x, y: end.y }
  const target = itemsById[end.itemId]
  if (!target) return { x: 0, y: 0 }
  return getPortWorld(target, end.port)
}

// Effective x,y for a line/arrow item (used for sorting, hit-testing,
// and computing the spawn offset for paste/duplicate). Mirrors the
// resolved start when start is free or orphan; for attached start we
// resolve through the live item.
export function effectiveOrigin(
  item: BoardScopedItem,
  itemsById: Record<string, BoardScopedItem>
): { x: number; y: number } {
  if (isConnector(item.type) && item.start) {
    if (item.start.kind === 'free' || item.start.kind === 'orphan') {
      return { x: item.start.x, y: item.start.y }
    }
    if (item.start.kind === 'attached') {
      const target = itemsById[item.start.itemId]
      if (target) return getPortWorld(target, item.start.port)
    }
  }
  return { x: item.x, y: item.y }
}

// World-axis-aligned bounding box for one item. Used by the selection
// overlay, the multi-selection box, and the marquee hit-test. For
// connectors it expands to the union of the resolved start/end
// coordinates; for everything else the shape's own {x, y, w, h} is
// sufficient.
export function computeBoundingBox(
  item: BoardScopedItem,
  itemsById: Record<string, BoardScopedItem>
): BBox {
  if (isConnector(item.type) && item.start && item.end) {
    const s = resolveEnd(item.start, itemsById)
    const e = resolveEnd(item.end, itemsById)
    const x = Math.min(s.x, e.x)
    const y = Math.min(s.y, e.y)
    const w = Math.abs(s.x - e.x)
    const h = Math.abs(s.y - e.y)
    // Degenerate connector (zero-length) — give it a 1-unit footprint
    // so the marquee hit-test has something to intersect with.
    if (w === 0 && h === 0) return { x: x - 0.5, y: y - 0.5, w: 1, h: 1 }
    return { x, y, w, h }
  }
  const w = item.w ?? DEFAULT_SHAPE_SIZE.w
  const h = item.h ?? DEFAULT_SHAPE_SIZE.h
  return { x: item.x, y: item.y, w, h }
}

// Rectangle intersection used by the marquee hit-test. AABB-on-AABB;
// returns true if the two rectangles share at least one point.
export function aabbIntersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
