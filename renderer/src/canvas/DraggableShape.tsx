// Renders one canvas item and wires it to drag → `onDragEnd`. The shape
// itself is a SVG `<g>` (dnd-kit is DOM-only, so we use native pointer
// events). Pointerdown calls `stopPropagation` so the surface-level pan
// listener doesn't fire, and selects the shape before any drag threshold
// is crossed. Drag end converts viewport-pixel deltas back to world
// coordinates via `delta / zoom` (matches `useCanvasViewport`).
//
// During a drag we apply a transient `translate(dx/zoom dy/zoom)` to an
// inner `<g>` so the shape (plus its selection overlay and resize
// handles) follows the cursor live. Only on `pointerup` do we dispatch
// `move-item` and clear the ghost — avoids the "shape teleports on
// release" feel of commit-only drags and keeps the reducer quiet during
// the gesture.
//
// `onUpdate` is threaded down so NoteShape can persist inline text edits
// without a full drag cycle.

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardScopedItem, ResizeHandle } from './types'
import { RectShape } from './shapes/RectShape'
import { EllipseShape } from './shapes/EllipseShape'
import { LineShape } from './shapes/LineShape'
import { ArrowShape } from './shapes/ArrowShape'
import { NoteShape } from './shapes/NoteShape'
import { SelectionOverlay } from './SelectionOverlay'
import { ResizeHandles } from './ResizeHandles'
import { isResizable } from './types'

interface DraggableShapeProps {
  item: BoardScopedItem
  selected: boolean
  zoom: number
  onSelect: (id: string) => void
  onDragEnd: (id: string, x: number, y: number) => void
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
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
  onUpdate
}: {
  item: BoardScopedItem
  onUpdate: DraggableShapeProps['onUpdate']
}) {
  switch (item.type) {
    case 'rect':
      return <RectShape item={item} />
    case 'ellipse':
      return <EllipseShape item={item} />
    case 'line':
      return <LineShape item={item} />
    case 'arrow':
      return <ArrowShape item={item} />
    case 'note':
      return <NoteShape item={item} onUpdate={(patch) => onUpdate(item.id, patch)} />
  }
}

export function DraggableShape({
  item,
  selected,
  zoom,
  onSelect,
  onDragEnd,
  onUpdate,
  onResize
}: DraggableShapeProps) {
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  // Live drag offset in viewport pixels. Dividing by `zoom` gives the
  // world-space translation we apply to the inner <g>.
  const [dragDelta, setDragDelta] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })

  function handlePointerDown(e: ReactPointerEvent<SVGGElement>) {
    if (e.button !== 0) return
    // Stop the surface pan from activating on a shape click. Both this
    // handler and the surface pan now use pointerdown (Fix 1), so a
    // single stopPropagation covers both event families.
    e.stopPropagation()
    onSelect(item.id)
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
      onDragEnd(item.id, item.x + dx / zoom, item.y + dy / zoom)
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

  return (
    <g onPointerDown={handlePointerDown} style={{ cursor: 'move' }}>
      <g transform={ghostTransform}>
        <ShapeForItem item={item} onUpdate={onUpdate} />
        {selected && <SelectionOverlay item={item} />}
        {selected && isResizable(item.type) && (
          <ResizeHandles
            item={item}
            onResize={(handle, origin, dx, dy) => onResize(item.id, handle, origin, dx, dy)}
          />
        )}
      </g>
    </g>
  )
}
