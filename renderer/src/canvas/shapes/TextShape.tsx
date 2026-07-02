// Free-floating text shape. Renders an invisible bbox for hit-testing +
// selection overlay + resize handles, then renders the actual text via
// `TextOverlay` (the same on-canvas editor rect/ellipse use). No visible
// border — the text is naked on the canvas.
//
// The bbox itself is intentionally non-stroked; the text inside handles
// its own layout via `TextOverlay`'s padding/line-height rules.

import type { BoardScopedItem } from '../types'
import { TextOverlay } from './TextOverlay'

interface TextShapeProps {
  item: BoardScopedItem
  onUpdate?: (patch: Partial<BoardScopedItem>) => void
}

export function TextShape({ item, onUpdate }: TextShapeProps) {
  if (item.type !== 'text') return null
  const w = item.w ?? 0
  const h = item.h ?? 0
  return (
    <g>
      {/* Invisible hit area. Selection overlay + marquee + drag all read
          from `computeBoundingBox` so this rect only needs to give the
          pointer something to land on when the user double-clicks to
          edit. fill='transparent' catches the click but stays invisible. */}
      <rect
        x={item.x}
        y={item.y}
        width={w}
        height={h}
        fill='transparent'
        stroke='none'
        pointerEvents='all'
      />
      {onUpdate && <TextOverlay item={item} width={w} height={h} onUpdate={onUpdate} />}
    </g>
  )
}
