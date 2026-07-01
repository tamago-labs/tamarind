import type { BoardScopedItem } from '../types'
import { TextOverlay } from './TextOverlay'

interface EllipseShapeProps {
  item: BoardScopedItem
  onUpdate?: (patch: Partial<BoardScopedItem>) => void
}

export function EllipseShape({ item, onUpdate }: EllipseShapeProps) {
  if (item.type !== 'ellipse') return null
  const w = item.w ?? 0
  const h = item.h ?? 0
  return (
    <g>
      <ellipse
        cx={item.x + w / 2}
        cy={item.y + h / 2}
        rx={w / 2}
        ry={h / 2}
        fill={item.fill ?? 'none'}
        stroke={item.stroke}
        strokeWidth={item.strokeWidth}
      />
      {onUpdate && <TextOverlay item={item} width={w} height={h} onUpdate={onUpdate} />}
    </g>
  )
}
