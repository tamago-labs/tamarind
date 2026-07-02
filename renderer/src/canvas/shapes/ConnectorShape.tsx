import type { BoardScopedItem } from '../types'
import { CONNECTOR_HIT_RADIUS, resolveEnd } from '../types'

// Phase 3 unified connector — replaces the old LineShape + ArrowShape.
// One shape with endpoint flags (`arrowStart`, `arrowEnd`), stroke
// pattern, curve, and an optional inline label. Endpoints live in
// `start` / `end`; the props below are read-only at render time and
// (for live edits) get patched via `onUpdate` in the parent.

// `strokeDasharray` for the three supported patterns. Solid omits the
// attribute (cleanest SVG). Dashed and dotted scale roughly with the
// stroke width via the multiplier so a thicker line gets visibly
// bigger dashes / dots.
function strokeDasharray(pattern: 'solid' | 'dashed' | 'dotted', strokeWidth: number) {
  if (pattern === 'dashed') {
    const u = Math.max(1, strokeWidth * 2)
    return `${u * 4} ${u * 3}`
  }
  if (pattern === 'dotted') {
    const u = Math.max(1, strokeWidth)
    return `${u} ${u * 3}`
  }
  return undefined
}

// Quadratic Bezier path between two points with a control point offset
// perpendicular to the chord by 25% of the chord length. The single
// `Q` command keeps the file small; the marker still orients correctly
// along the tangent because the marker uses `orient='auto-start-reverse'`.
function buildBezierPath(s: { x: number; y: number }, e: { x: number; y: number }): string {
  const mx = (s.x + e.x) / 2
  const my = (s.y + e.y) / 2
  const dx = e.x - s.x
  const dy = e.y - s.y
  const len = Math.hypot(dx, dy) || 1
  // Perp offset: 25% of chord length, perpendicular to chord direction.
  const offset = len * 0.25
  const cx = mx + (-dy / len) * offset
  const cy = my + (dx / len) * offset
  return `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`
}

// Label position offset from the connector midpoint along the chord.
// `start` / `end` are visually offset from the endpoint by ~10 world
// units so the chip doesn't overlap the arrowhead (or the bare end).
function labelAnchor(
  at: 'start' | 'middle' | 'end',
  s: { x: number; y: number },
  e: { x: number; y: number }
): { x: number; y: number } {
  if (at === 'start') return s
  if (at === 'end') return e
  return { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
}

export function ConnectorShape({
  item,
  itemsById
}: {
  item: BoardScopedItem
  itemsById: Record<string, BoardScopedItem>
}) {
  if (item.type !== 'connector' || !item.start || !item.end) return null
  const s = resolveEnd(item.start, itemsById)
  const e = resolveEnd(item.end, itemsById)
  const curve = item.curve ?? 'straight'
  const strokeWidth = item.strokeWidth ?? 2
  const dash = strokeDasharray(item.strokePattern ?? 'solid', strokeWidth)
  const markerStart = item.arrowStart === 'arrow' ? 'url(#tamarind-arrowhead)' : undefined
  const markerEnd = item.arrowEnd === 'arrow' ? 'url(#tamarind-arrowhead)' : undefined
  const pathEl =
    curve === 'bezier' ? (
      <path
        d={buildBezierPath(s, e)}
        fill='none'
        stroke={item.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap={item.lineCap ?? 'round'}
        strokeDasharray={dash}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
    ) : (
      <line
        x1={s.x}
        y1={s.y}
        x2={e.x}
        y2={e.y}
        stroke={item.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap={item.lineCap ?? 'round'}
        strokeDasharray={dash}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
    )

  // Connector label — a small white-fill, blue-stroke chip with the
  // label text. Positioned at start/middle/end. The connector itself
  // is the click target so we don't intercept chips for editing; the
  // ConnectorLabelField in the right panel owns text edits (controlled
  // commit model — see TextSection in PropertiesDrawer for the
  // pattern). v1 keeps the chip read-only on the canvas.
  const label = item.label
  const labelEl = label && label.text ? <ConnectorLabelEl label={label} s={s} e={e} /> : null

  return (
    <g>
      {pathEl}
      {/* Hit area — wider transparent stroke so the connector is easy
          to pick even when its visible stroke is thin. Marker
          arrowhead extends the visible hit zone to the tip via this
          wider transparent stroke. */}
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
      {labelEl}
    </g>
  )
}

// Inline label rendered above the connector. Chip width is computed
// from text length (~7px per character at fontSize 11); chip height
// stays at ~18px so it doesn't fight the connector for visual space.
function ConnectorLabelEl({
  label,
  s,
  e
}: {
  label: NonNullable<BoardScopedItem['label']>
  s: { x: number; y: number }
  e: { x: number; y: number }
}) {
  const fontSize = label.fontSize ?? 11
  const text = label.text
  const charW = fontSize * 0.55
  const padX = 6
  const padY = 3
  const textW = Math.max(text.length, 1) * charW
  const chipW = textW + padX * 2
  const chipH = fontSize + padY * 2
  const anchor = labelAnchor(label.at, s, e)
  // Offset the chip upward so it sits above the connector without
  // overlapping it.
  const cx = anchor.x - chipW / 2
  const cy = anchor.y - chipH - 6
  return (
    <g pointerEvents='none'>
      <rect
        x={cx}
        y={cy}
        width={chipW}
        height={chipH}
        rx={4}
        ry={4}
        fill='white'
        stroke='#3b82f6'
        strokeWidth={1}
      />
      <text
        x={anchor.x}
        y={cy + padY + fontSize - 2}
        fontSize={fontSize}
        fill='#1f2937'
        textAnchor='middle'
        style={{ userSelect: 'none' }}
      >
        {text}
      </text>
    </g>
  )
}
