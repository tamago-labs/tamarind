import type { BoardScopedItem } from '../types'

export function LineShape({ item }: { item: BoardScopedItem }) {
  if (item.type !== 'line') return null
  return (
    <line
      x1={item.x}
      y1={item.y}
      x2={item.x2 ?? 0}
      y2={item.y2 ?? 0}
      stroke={item.stroke}
      strokeWidth={item.strokeWidth}
      strokeLinecap={item.lineCap ?? 'round'}
    />
  )
}
