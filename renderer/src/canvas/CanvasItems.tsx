// The single SVG world inside the world-transform div. Defines the
// shared arrowhead marker, renders every item scoped to the active
// board, and handles empty-area deselect (single click clears, shift-
// click preserves — single click is the common case).
//
// Coordinate system: the SVG is sized 20k × 20k and offset by
// (-WORLD_HALF, -WORLD_HALF) so its (0, 0) sits at world (0, 0).
// The shape group applies a `translate(WORLD_HALF, WORLD_HALF)` so
// shapes authored at world (X, Y) land at SVG (X + WORLD_HALF, Y +
// WORLD_HALF). With the parent div's `translate(pan) scale(zoom)`
// transform, that maps to screen (pan.x + X*zoom, pan.y + Y*zoom) —
// i.e. world origin sits at screen origin (the surface top-left) and
// a shape at world (100, 100) appears at screen (100, 100) at
// default view. Shapes outside ±WORLD_HALF extend via
// `overflow: visible`.

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { BoardScopedItem, ResizeHandle } from './types'
import { DraggableShape } from './DraggableShape'

interface CanvasItemsProps {
  items: BoardScopedItem[]
  activeBoardId: string | null
  selectedIds: Set<string>
  zoom: number
  itemsById: Record<string, BoardScopedItem>
  surfaceRef: React.RefObject<HTMLDivElement | null>
  onSelect: (id: string | null, mode: 'replace' | 'toggle' | 'add') => void
  onCommitDrag: (id: string, dx: number, dy: number) => void
  onMaybeMultiDrag: (primaryId: string, e: ReactPointerEvent<SVGGElement>) => boolean
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onResize: (
    id: string,
    handle: ResizeHandle,
    origin: BoardScopedItem,
    dx: number,
    dy: number
  ) => void
}

// 20k × 20k gives plenty of headroom for panning into deep world
// coordinates. Bigger than typical whiteboards but cheap to render
// because we only draw the shapes the user placed.
const WORLD_SIZE = 20000
const WORLD_HALF = WORLD_SIZE / 2

const svgStyle: CSSProperties = {
  position: 'absolute',
  left: -WORLD_HALF,
  top: -WORLD_HALF,
  width: WORLD_SIZE,
  height: WORLD_SIZE,
  overflow: 'visible'
}

export function CanvasItems({
  items,
  activeBoardId,
  selectedIds,
  zoom,
  itemsById,
  surfaceRef,
  onSelect,
  onCommitDrag,
  onMaybeMultiDrag,
  onUpdate,
  onTransientUpdate,
  onResize
}: CanvasItemsProps) {
  // Only items on the active board are visible. Phase 2 will introduce
  // multi-board switching; until then we filter to the lone board.
  const visibleItems = activeBoardId ? items.filter((it) => it.boardId === activeBoardId) : []

  function handleBackgroundPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    // Only deselect when the pointer landed on the SVG itself, not on a
    // shape — DraggableShape calls stopPropagation so shape clicks never
    // bubble up here, but we double-check via target identity.
    if (e.target !== e.currentTarget) return
    onSelect(null, e.shiftKey ? 'add' : 'replace')
  }

  return (
    <svg
      style={svgStyle}
      onPointerDown={handleBackgroundPointerDown}
      xmlns='http://www.w3.org/2000/svg'
    >
      <defs>
        {/* Shared arrowhead for line/arrow shapes. `context-stroke` makes
           the marker inherit the referencing line's `stroke`, so a single
           marker serves every colour. SVG 2, supported in modern Chromium,
           Firefox, and Safari. */}
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
      {/* Translate the shape group so author-supplied world coords map
          to the SVG's centred viewport. Without this, world (0, 0)
          would sit at SVG (-WORLD_HALF, -WORLD_HALF) and shapes would
          appear off-screen at default view. */}
      <g transform={`translate(${WORLD_HALF} ${WORLD_HALF})`}>
        {visibleItems.map((item) => (
          <DraggableShape
            key={item.id}
            item={item}
            selected={selectedIds.has(item.id)}
            selectedIds={selectedIds}
            zoom={zoom}
            itemsById={itemsById}
            surfaceRef={surfaceRef}
            onSelect={onSelect}
            onCommitDrag={onCommitDrag}
            onMaybeMultiDrag={onMaybeMultiDrag}
            onUpdate={onUpdate}
            onTransientUpdate={onTransientUpdate}
            onResize={onResize}
          />
        ))}
      </g>
    </svg>
  )
}
