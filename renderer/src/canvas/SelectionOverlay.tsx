// Dashed bounding-box overlay drawn over a selected shape. The overlay
// ignores pointer events so it never intercepts clicks meant for the
// shape underneath. `pointerEvents="none"` is critical — without it the
// overlay would steal drag activation.
//
// For connectors (line/arrow) the bbox spans the resolved endpoints,
// so a line that snaps to two distant rectangles still gets a single
// selection overlay covering both endpoints.

import type { BoardScopedItem } from './types'
import { SELECT_STROKE, computeBoundingBox } from './types'

interface SelectionOverlayProps {
  item: BoardScopedItem
  itemsById: Record<string, BoardScopedItem>
  // Optional snap-target highlight drawn when this shape is the current
  // snap candidate during a connector-endpoint drag.
  snapTarget?: boolean
}

export function SelectionOverlay({ item, itemsById, snapTarget }: SelectionOverlayProps) {
  const b = computeBoundingBox(item, itemsById)
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      fill='none'
      stroke={SELECT_STROKE}
      strokeWidth={snapTarget ? 2 : 1.5}
      strokeDasharray={snapTarget ? '6 4' : '4 3'}
      pointerEvents='none'
      className={snapTarget ? 'animate-pulse' : undefined}
    />
  )
}
