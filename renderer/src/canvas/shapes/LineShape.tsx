import type { BoardScopedItem } from '../types'
import { CONNECTOR_HIT_RADIUS, resolveEnd } from '../types'

// World-space half-thickness of the invisible hit stroke. Doubles as
// the click tolerance when picking a line/arrow. 12 world units
// (~24px on screen at default zoom) is comfortable without making
// the hit area feel imprecise.

export function LineShape({
  item,
  itemsById
}: {
  item: BoardScopedItem
  itemsById: Record<string, BoardScopedItem>
}) {
  if (item.type !== 'line' || !item.start || !item.end) return null
  const s = resolveEnd(item.start, itemsById)
  const e = resolveEnd(item.end, itemsById)
  return (
    <g>
      <line
        x1={s.x}
        y1={s.y}
        x2={e.x}
        y2={e.y}
        stroke={item.stroke}
        strokeWidth={item.strokeWidth}
        strokeLinecap={item.lineCap ?? 'round'}
      />
      {/* Hit area — a wider transparent stroke on top of the visible
          one so clicks within ±CONNECTOR_HIT_RADIUS of the line still
          pick it. The visible stroke sits under the hit stroke so the
          wider topmost element is the click target. */}
      <line
        x1={s.x}
        y1={s.y}
        x2={e.x}
        y2={e.y}
        stroke='transparent'
        strokeWidth={CONNECTOR_HIT_RADIUS * 2}
        strokeLinecap='round'
        style={{ cursor: 'pointer' }}
      />
    </g>
  )
}
