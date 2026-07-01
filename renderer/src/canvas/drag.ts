// Drag-patch helpers shared between the single-shape drag (DraggableShape)
// and the multi-shape drag (CanvasPage orchestration). Live-position
// conversion is the same math either way: viewport pixels → world
// coordinates via `delta / zoom`.

import type { BoardScopedItem, ConnectorEnd } from './types'
import { effectiveOrigin, isConnector, resolveEnd } from './types'

export interface DragInputs {
  item: BoardScopedItem
  dx: number // viewport pixels
  dy: number
  zoom: number
  itemsById: Record<string, BoardScopedItem>
}

// Compute the `update-item` patch for committing a drag translation.
// Rect/ellipse/note just shift x,y. Lines/arrows shift both endpoints
// (resolved through any attached-host positions) and detach any
// `attached` endpoints so the line becomes free-floating at the new
// position. (Re-snapping is left to the next endpoint-drag gesture.)
export function computeDragPatch(inputs: DragInputs): Partial<BoardScopedItem> {
  const { item, dx, dy, zoom, itemsById } = inputs
  const ddx = dx / zoom
  const ddy = dy / zoom
  if (isConnector(item.type) && item.start && item.end) {
    const startPos = effectiveOrigin(item, itemsById)
    const endPos = resolveEnd(item.end, itemsById)
    const newStart: ConnectorEnd = {
      kind: 'free',
      x: startPos.x + ddx,
      y: startPos.y + ddy
    }
    const newEnd: ConnectorEnd = {
      kind: 'free',
      x: endPos.x + ddx,
      y: endPos.y + ddy
    }
    return {
      x: startPos.x + ddx,
      y: startPos.y + ddy,
      start: newStart,
      end: newEnd
    }
  }
  return { x: item.x + ddx, y: item.y + ddy }
}

// Compute the patch for one item in a multi-shape drag, given the
// group's pre-drag positions. Used by the multi-drag orchestrator
// when snapshotting all selected items at pointerdown.
export function computeMultiDragPatch(
  startPos: { x: number; y: number },
  item: BoardScopedItem,
  dx: number,
  dy: number,
  zoom: number,
  itemsById: Record<string, BoardScopedItem>
): Partial<BoardScopedItem> {
  const ddx = dx / zoom
  const ddy = dy / zoom
  if (isConnector(item.type) && item.start && item.end) {
    const newStart: ConnectorEnd = {
      kind: 'free',
      x: startPos.x + ddx,
      y: startPos.y + ddy
    }
    const endStart = resolveEnd(item.end, itemsById)
    const newEnd: ConnectorEnd = {
      kind: 'free',
      x: endStart.x + ddx,
      y: endStart.y + ddy
    }
    return { x: newStart.x, y: newStart.y, start: newStart, end: newEnd }
  }
  return { x: startPos.x + ddx, y: startPos.y + ddy }
}
