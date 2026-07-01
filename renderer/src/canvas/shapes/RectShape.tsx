import type { BoardScopedItem } from '../types'
import { TextOverlay } from './TextOverlay'

interface RectShapeProps {
  item: BoardScopedItem
  onUpdate?: (patch: Partial<BoardScopedItem>) => void
}

export function RectShape({ item, onUpdate }: RectShapeProps) {
  if (item.type !== 'rect') return null
  const w = item.w ?? 0
  const h = item.h ?? 0
  return (
    <g>
      <rect
        x={item.x}
        y={item.y}
        width={w}
        height={h}
        fill={item.fill ?? 'none'}
        stroke={item.stroke}
        strokeWidth={item.strokeWidth}
      />
      {onUpdate && <TextOverlay item={item} width={w} height={h} onUpdate={onUpdate} />}
    </g>
  )
}
