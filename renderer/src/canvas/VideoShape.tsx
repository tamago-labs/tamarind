// Video shape component for displaying uploaded videos on the canvas.
// Shows a video player with controls when the video URL is available.

import type { BoardScopedItem } from './types'

interface VideoShapeProps {
  item: BoardScopedItem
  onUpdate?: (patch: Partial<BoardScopedItem>) => void
}

export function VideoShape({ item, onUpdate }: VideoShapeProps) {
  const w = item.w ?? 320
  const h = item.h ?? 240

  // If no video URL yet, show a placeholder
  if (!item.videoUrl) {
    return (
      <g>
        <rect
          x={item.x}
          y={item.y}
          width={w}
          height={h}
          fill='#1f2937'
          stroke={item.stroke}
          strokeWidth={item.strokeWidth}
          rx={4}
        />
        <text
          x={item.x + w / 2}
          y={item.y + h / 2}
          textAnchor='middle'
          dominantBaseline='middle'
          fill='#9ca3af'
          fontSize={12}
        >
          {item.videoFileName || 'Uploading...'}
        </text>
      </g>
    )
  }

  // If video URL is available, show video player
  return (
    <g>
      <foreignObject x={item.x} y={item.y} width={w} height={h}>
        <video
          controls
          width={w}
          height={h}
          style={{ borderRadius: 4, border: `1px solid ${item.stroke}` }}
          preload='metadata'
        >
          <source src={item.videoUrl} type={item.videoMimeType} />
          Your browser does not support the video tag.
        </video>
      </foreignObject>
    </g>
  )
}
