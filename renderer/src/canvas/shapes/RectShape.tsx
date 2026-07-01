import type { BoardScopedItem } from '../types'

export function RectShape({ item }: { item: BoardScopedItem }) {
  if (item.type !== 'rect') return null
  return (
    <rect
      x={item.x}
      y={item.y}
      width={item.w ?? 0}
      height={item.h ?? 0}
      fill={item.fill ?? 'none'}
      stroke={item.stroke}
      strokeWidth={item.strokeWidth}
    />
  )
}
