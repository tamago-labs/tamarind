import type { BoardScopedItem } from '../types'
import { CONNECTOR_HIT_RADIUS, resolveEnd } from '../types'

export function ArrowShape({
  item,
  itemsById
}: {
  item: BoardScopedItem
  itemsById: Record<string, BoardScopedItem>
}) {
  if (item.type !== 'arrow' || !item.start || !item.end) return null
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
        markerEnd='url(#tamarind-arrowhead)'
      />
      {/* Hit area — wider transparent stroke so the arrow is easy to
          pick even when its visible stroke is thin. The arrowhead
          itself is rendered by the marker on the visible stroke; the
          hit area extends to the same endpoint so the tip is
          clickable. */}
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
