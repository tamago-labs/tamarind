// 4 corner resize handles drawn over a selected resizable shape. Each
// handle is a small white `<rect>` with a tamarind-500 stroke; cursor
// flips per corner (nwse-resize / nesw-resize). Pointerdown calls
// stopPropagation so neither the shape drag nor the surface pan fires.
//
// On pointerdown we snapshot the original item (so the parent can
// apply cumulative delta without worrying about state staleness from
// React re-renders). On every pointermove we send the cumulative
// viewport-pixel delta plus that snapshot to `onResize`.
//
// `vector-effect="non-scaling-stroke"` keeps the stroke at 1.5 screen
// pixels regardless of zoom, so handles look the same at any zoom level.

import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardScopedItem, ResizeHandle } from './types'
import { DEFAULT_SHAPE_SIZE, SELECT_STROKE } from './types'

interface ResizeHandlesProps {
  item: BoardScopedItem
  onResize: (handle: ResizeHandle, origin: BoardScopedItem, dx: number, dy: number) => void
}

interface HandleSpec {
  id: ResizeHandle
  cx: number
  cy: number
  cursor: string
}

function handleSpecs(item: BoardScopedItem): HandleSpec[] {
  const w = item.w ?? DEFAULT_SHAPE_SIZE.w
  const h = item.h ?? DEFAULT_SHAPE_SIZE.h
  return [
    { id: 'nw', cx: item.x, cy: item.y, cursor: 'nwse-resize' },
    { id: 'ne', cx: item.x + w, cy: item.y, cursor: 'nesw-resize' },
    { id: 'sw', cx: item.x, cy: item.y + h, cursor: 'nesw-resize' },
    { id: 'se', cx: item.x + w, cy: item.y + h, cursor: 'nwse-resize' }
  ]
}

const HANDLE_SIZE = 8

export function ResizeHandles({ item, onResize }: ResizeHandlesProps) {
  const drag = useRef<{
    handle: ResizeHandle
    origin: BoardScopedItem
    startX: number
    startY: number
  } | null>(null)

  function handlePointerDown(handle: ResizeHandle, e: ReactPointerEvent<SVGRectElement>) {
    if (e.button !== 0) return
    e.stopPropagation()
    // Snapshot the item at the start of the resize so the parent
    // can compute new x/y/w/h relative to the original position
    // every tick, regardless of intermediate state updates.
    drag.current = {
      handle,
      origin: { ...item },
      startX: e.clientX,
      startY: e.clientY
    }

    function onMove(ev: PointerEvent) {
      const start = drag.current
      if (!start) return
      // Cumulative delta from drag start, in viewport pixels. The
      // parent divides by zoom to get world coordinates.
      const dx = ev.clientX - start.startX
      const dy = ev.clientY - start.startY
      onResize(handle, start.origin, dx, dy)
    }

    function endDrag() {
      drag.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  const specs = handleSpecs(item)
  return (
    <g>
      {specs.map((s) => (
        <rect
          key={s.id}
          x={s.cx - HANDLE_SIZE / 2}
          y={s.cy - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill='white'
          stroke={SELECT_STROKE}
          strokeWidth={1.5}
          vectorEffect='non-scaling-stroke'
          style={{ cursor: s.cursor }}
          onPointerDown={(e) => handlePointerDown(s.id, e)}
        />
      ))}
    </g>
  )
}
