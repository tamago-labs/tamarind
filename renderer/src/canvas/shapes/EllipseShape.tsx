import type { BoardScopedItem } from '../types'

export function EllipseShape({ item }: { item: BoardScopedItem }) {
  if (item.type !== 'ellipse') return null
  const w = item.w ?? 0
  const h = item.h ?? 0
  return (
    <ellipse
      cx={item.x + w / 2}
      cy={item.y + h / 2}
      rx={w / 2}
      ry={h / 2}
      fill={item.fill ?? 'none'}
      stroke={item.stroke}
      strokeWidth={item.strokeWidth}
    />
  )
}
