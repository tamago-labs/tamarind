// Renders one canvas item and wires it to:
//
//   • Single-shape drag   — local ghost translate on pointermove,
//                           `onCommitDrag(id, dx, dy)` on pointerup.
//   • Multi-shape drag    — `onMaybeMultiDrag(primaryId, e)` early-
//                           hand-off so the parent's window-level
//                           orchestrator can move every selected item.
//
// `ShapeForItem` threads `itemsById` so `LineShape` and `ArrowShape`
// can resolve connector endpoints to world positions via `resolveEnd`.
//
// Resize handles only render when this is the sole selected shape —
// resizing a multi-selection isn't supported (matches Figma's
// behaviour and avoids ambiguous geometry updates).

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardScopedItem, ResizeHandle } from './types'
import { isConnector, isResizable } from './types'
import { RectShape } from './shapes/RectShape'
import { EllipseShape } from './shapes/EllipseShape'
import { ConnectorShape } from './shapes/ConnectorShape'
import { TextShape } from './shapes/TextShape'
import { SelectionOverlay } from './SelectionOverlay'
import { ResizeHandles } from './ResizeHandles'
import { ConnectorHandles } from './ConnectorHandles'

interface DraggableShapeProps {
  item: BoardScopedItem
  selected: boolean
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

function ShapeForItem({
  item,
  itemsById,
  onUpdate
}: {
  item: BoardScopedItem
  itemsById: Record<string, BoardScopedItem>
  // Rect / Ellipse use this for in-place text editing via TextOverlay.
  // Connectors ignore it.
  onUpdate: (patch: Partial<BoardScopedItem>) => void
}) {
  switch (item.type) {
    case 'rect':
      return <RectShape item={item} onUpdate={onUpdate} />
    case 'ellipse':
      return <EllipseShape item={item} onUpdate={onUpdate} />
    case 'connector':
      return <ConnectorShape item={item} itemsById={itemsById} />
    case 'text':
      return <TextShape item={item} onUpdate={onUpdate} />
  }
}

export function DraggableShape({
  item,
  selected,
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
}: DraggableShapeProps) {
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  // Live drag offset in viewport pixels. Dividing by `zoom` gives the
  // world-space translation we apply to the inner <g>.
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0
  })

  function handlePointerDown(e: ReactPointerEvent<SVGGElement>) {
    if (e.button !== 0) return
    // Stop the surface pan from activating on a shape click. Both this
    // handler and the surface pan use pointerdown (Fix 1), so a single
    // stopPropagation covers both event families.
    e.stopPropagation()
    // Selection rules:
    //   • Plain click on an unselected item → replace.
    //   • Plain click on the only selected item → no-op (preserve sel).
    //   • Plain click on a member of a multi-selection → no-op (preserve sel).
    //   • Shift-click → toggle membership.
    if (e.shiftKey) {
      onSelect(item.id, 'toggle')
    } else if (selected) {
      // Clicking an already-selected item keeps the selection so the
      // user can immediately drag the whole group.
    } else {
      onSelect(item.id, 'replace')
    }
    // If this item is part of a multi-selection, hand off to the
    // parent's window-level orchestrator. The orchestrator installs
    // its own pointer listeners and returns true; we bail out of
    // our own single-drag setup.
    if (selectedIds.has(item.id) && selectedIds.size > 1) {
      const handled = onMaybeMultiDrag(item.id, e)
      if (handled) return
    }
    dragStart.current = { x: e.clientX, y: e.clientY }
    setDragDelta({ dx: 0, dy: 0 })

    function handleMove(ev: PointerEvent) {
      const start = dragStart.current
      if (!start) return
      setDragDelta({ dx: ev.clientX - start.x, dy: ev.clientY - start.y })
    }

    function handleUp(ev: PointerEvent) {
      const start = dragStart.current
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      setDragDelta({ dx: 0, dy: 0 })
      if (!start) return
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      // Ignore sub-pixel movement so a click never drifts the shape.
      if (Math.abs(dx) + Math.abs(dy) < 2) return
      onCommitDrag(item.id, dx, dy)
    }

    function handleCancel() {
      dragStart.current = null
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      setDragDelta({ dx: 0, dy: 0 })
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
  }

  // The inner <g> ghosts the shape during drag. Selection overlay and
  // resize handles sit inside it too, so the whole selection tracks
  // the cursor. When `dragDelta` is (0,0) we omit the transform so the
  // DOM stays clean for unselected / resting shapes.
  const isDragging = dragDelta.dx !== 0 || dragDelta.dy !== 0
  const ghostTransform = isDragging
    ? `translate(${dragDelta.dx / zoom} ${dragDelta.dy / zoom})`
    : undefined

  // Resize handles only when this is the sole selected shape — sizing
  // a multi-selection isn't part of this iteration.
  const showResize = selected && selectedIds.size === 1 && isResizable(item.type)

  return (
    <g onPointerDown={handlePointerDown} style={{ cursor: 'move' }}>
      <g transform={ghostTransform}>
        <ShapeForItem
          item={item}
          itemsById={itemsById}
          onUpdate={(patch) =>
            isDragging ? onTransientUpdate(item.id, patch) : onUpdate(item.id, patch)
          }
        />
        {selected && <SelectionOverlay item={item} itemsById={itemsById} />}
        {showResize && (
          <ResizeHandles
            item={item}
            onResize={(handle, origin, dx, dy) => onResize(item.id, handle, origin, dx, dy)}
          />
        )}
        {selected && isConnector(item.type) && surfaceRef.current && (
          <ConnectorHandles
            item={item}
            zoom={zoom}
            surfaceRect={surfaceRef.current.getBoundingClientRect()}
            itemsById={itemsById}
            onUpdate={onUpdate}
            onTransientUpdate={onTransientUpdate}
          />
        )}
      </g>
    </g>
  )
}
