// Sticky note shape with folded corner effect. Used for tactical
// planning notes, reminders, and annotations on the canvas.
//
// Visual: rounded rectangle with a folded corner triangle in the
// top-right. Yellow default fill, black stroke. Always has text.

import type { BoardScopedItem } from '../types'
import { DEFAULT_NOTE_FONT_SIZE } from '../types'
import { TextOverlay } from './TextOverlay'

interface NoteShapeProps {
  item: BoardScopedItem
  width: number
  height: number
  onUpdate?: (patch: Partial<BoardScopedItem>) => void
}

export function NoteShape({ item, width, height, onUpdate }: NoteShapeProps) {
  if (item.type !== 'note') return null

  const x = item.x
  const y = item.y
  const fill = item.fill ?? '#fef3c7'
  const stroke = item.stroke ?? '#000000'
  const foldSize = 12

  // Folded corner at top-right: main shape has 5 points with
  // a cutout where the corner folds down
  const mainPath = [
    `${x},${y}`,
    `${x + width - foldSize},${y}`,
    `${x + width},${y + foldSize}`,
    `${x + width},${y + height}`,
    `${x},${y + height}`
  ].join(' ')

  // The folded triangle piece
  const foldPath = [
    `${x + width - foldSize},${y}`,
    `${x + width},${y + foldSize}`,
    `${x + width - foldSize},${y + foldSize}`
  ].join(' ')

  return (
    <g>
      {/* Main shape with folded corner cutout */}
      <polygon points={mainPath} fill={fill} stroke={stroke} strokeWidth={item.strokeWidth} />
      {/* Folded corner (slightly darker shade) */}
      <polygon points={foldPath} fill={stroke} opacity={0.15} />
      {/* Fold line */}
      <line
        x1={x + width - foldSize}
        y1={y}
        x2={x + width}
        y2={y + foldSize}
        stroke={stroke}
        strokeWidth={item.strokeWidth * 0.5}
      />
      {onUpdate && (
        <TextOverlay
          item={item}
          width={width - foldSize}
          height={height - foldSize}
          onUpdate={onUpdate}
        />
      )}
    </g>
  )
}
