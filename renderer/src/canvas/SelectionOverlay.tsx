// Dashed bounding-box overlay drawn over a selected shape. The overlay
// ignores pointer events so it never intercepts clicks meant for the
// shape underneath. `pointerEvents="none"` is critical — without it the
// overlay would steal drag activation.

import type { BoardScopedItem } from './types'
import { SELECT_STROKE } from './types'

interface BBox {
  x: number
  y: number
  w: number
  h: number
}

function boundingBox(item: BoardScopedItem): BBox {
  switch (item.type) {
    case 'rect':
    case 'ellipse':
    case 'note':
      return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 }
    case 'line':
    case 'arrow': {
      const x2 = item.x2 ?? 0
      const y2 = item.y2 ?? 0
      const minX = Math.min(item.x, x2)
      const minY = Math.min(item.y, y2)
      // Pad lines so a 0-length line still shows a visible box.
      const w = Math.max(Math.abs(x2 - item.x), 4) + 4
      const h = Math.max(Math.abs(y2 - item.y), 4) + 4
      return { x: minX - 2, y: minY - 2, w, h }
    }
  }
}

export function SelectionOverlay({ item }: { item: BoardScopedItem }) {
  const b = boundingBox(item)
  return (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      fill='none'
      stroke={SELECT_STROKE}
      strokeWidth={1.5}
      strokeDasharray='4 3'
      pointerEvents='none'
    />
  )
}
