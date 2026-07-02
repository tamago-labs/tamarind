// Phase 3 — the Figma-style "in-flight" overlay for the connector tool.
// Renders two layers above the rendered shapes but below the selection
// overlay:
//
//   1. ConnectorPorts — small dots at the 5 ports of the shape under
//      the cursor (and a highlighted dot at the nearest snap target).
//   2. DraftConnectorPreview — the ghost line + cursor dot for the
//      connector being drawn (only present between pointerdown and
//      pointerup).
//
// The component renders its own SVG (mirroring `CanvasItems`'s
// structure) rather than sitting inside `<CanvasItems>` for two
// reasons:
//   • It keeps the overlay a self-contained presentational unit —
//     `CanvasPage` stays the only place that composes the world.
//   • DOM order inside the `worldTransform` div is the z-stack: items
//     first, then overlay, so the preview always sits above the
//     committed shapes but still inside the transformed coordinate
//     system. No need for explicit z-index gymnastics.
//
// The marker def is duplicated from `CanvasItems` so that
// `markerEnd="url(#tamarind-arrowhead)"` on the draft preview
// resolves regardless of the surrounding SVG context. Pointer events
// are explicitly disabled on the wrapper — the surface's own pan /
// connector-draw handlers must see every pointer event.

import type { CSSProperties } from 'react'
import type { BoardScopedItem, Port } from './types'
import { getPortWorld } from './types'
import type { NearestPort } from './findPort'

const PORTS: Port[] = ['top', 'right', 'bottom', 'left', 'center']

// 20k × 20k mirror of `CanvasItems` so the world coordinates that
// `DraftConnectorPreview` and `PortsForShape` emit align with the
// SVG's centered viewport.
const WORLD_SIZE = 20000
const WORLD_HALF = WORLD_SIZE / 2

const svgStyle: CSSProperties = {
  position: 'absolute',
  left: -WORLD_HALF,
  top: -WORLD_HALF,
  width: WORLD_SIZE,
  height: WORLD_SIZE,
  overflow: 'visible',
  pointerEvents: 'none'
}

export interface DraftConnector {
  start: { x: number; y: number }
  end: { x: number; y: number }
  startSnap: NearestPort | null
  endSnap: NearestPort | null
}

export interface CanvasOverlayProps {
  // When the connector tool is armed, show ports on the shape under the
  // cursor. The shape id is provided by CanvasPage (it does the hit-test
  // on each pointermove so this component stays dumb).
  showPorts: boolean
  hoverShape: BoardScopedItem | null
  zoom: number
  // The in-flight connector. null when the user isn't currently drawing.
  draft: DraftConnector | null
}

export function CanvasOverlay({ showPorts, hoverShape, zoom, draft }: CanvasOverlayProps) {
  if (!showPorts && !draft) return null
  return (
    <svg style={svgStyle} xmlns='http://www.w3.org/2000/svg'>
      <defs>
        {/* Mirrored from `CanvasItems`. Kept local so the preview's
            `markerEnd` resolves without depending on the items SVG
            being mounted first. */}
        <marker
          id='tamarind-arrowhead'
          viewBox='0 0 10 10'
          refX='9'
          refY='5'
          markerUnits='strokeWidth'
          markerWidth='8'
          markerHeight='8'
          orient='auto-start-reverse'
        >
          <path d='M 0 0 L 10 5 L 0 10 z' fill='context-stroke' />
        </marker>
      </defs>
      <g transform={`translate(${WORLD_HALF} ${WORLD_HALF})`}>
        {showPorts && hoverShape && (
          <PortsForShape item={hoverShape} zoom={zoom} snap={draft?.endSnap ?? null} />
        )}
        {draft && <DraftConnectorPreview draft={draft} />}
      </g>
    </svg>
  )
}

function PortsForShape({
  item,
  zoom,
  snap
}: {
  item: BoardScopedItem
  zoom: number
  snap: NearestPort | null
}) {
  if (item.w === undefined || item.h === undefined) return null
  // `vectorEffect='non-scaling-stroke'` keeps the dot stroke at 1.5
  // device pixels regardless of zoom. The radius is in world units
  // so it scales with the shape (matches the rest of the world-space
  // visual language); the snap target stays at the same world radius
  // but reads larger because the surrounding context shrinks.
  const r = 4 / zoom
  const rSnap = 6 / zoom
  return (
    <g>
      {PORTS.map((port) => {
        const p = getPortWorld(item, port)
        const isSnap = snap !== null && snap.itemId === item.id && snap.port === port
        return (
          <circle
            key={port}
            cx={p.x}
            cy={p.y}
            r={isSnap ? rSnap : r}
            fill={isSnap ? '#3b82f6' : 'white'}
            stroke='#3b82f6'
            strokeWidth={1.5}
            vectorEffect='non-scaling-stroke'
          />
        )
      })}
    </g>
  )
}

function DraftConnectorPreview({ draft }: { draft: DraftConnector }) {
  // The preview always renders an arrow at the end so the user can
  // see the "I'm about to draw an arrow" affordance, even if the
  // committed connector ends up with no arrowhead (default for the
  // toolbar is "arrowEnd: 'arrow'" so the preview matches the
  // commit).
  return (
    <g>
      <line
        x1={draft.start.x}
        y1={draft.start.y}
        x2={draft.end.x}
        y2={draft.end.y}
        stroke='#3b82f6'
        strokeWidth={2}
        strokeDasharray='4 4'
        strokeLinecap='round'
        markerEnd='url(#tamarind-arrowhead)'
      />
      {/* Snap indicator rings at both ends — only when attached — give
          the user a clear "this is locked to that port" cue. */}
      {draft.startSnap && (
        <circle
          cx={draft.start.x}
          cy={draft.start.y}
          r={6}
          fill='none'
          stroke='#3b82f6'
          strokeWidth={1.5}
          vectorEffect='non-scaling-stroke'
        />
      )}
      {draft.endSnap && (
        <circle
          cx={draft.end.x}
          cy={draft.end.y}
          r={6}
          fill='none'
          stroke='#3b82f6'
          strokeWidth={1.5}
          vectorEffect='non-scaling-stroke'
        />
      )}
      {/* Ghost cursor dot at the end (always — gives the user a clear
          visual of where the line's tip is even when no snap target). */}
      <circle
        cx={draft.end.x}
        cy={draft.end.y}
        r={4}
        fill='white'
        stroke='#3b82f6'
        strokeWidth={1.5}
        vectorEffect='non-scaling-stroke'
      />
    </g>
  )
}
