// The canvas page — wires the toolbar, viewport, items tree, footer, and
// properties drawer together. Holds the canvas reducer state (P2P-ready
// shape) and the ephemeral selection state (UI-only, not synced).
//
// Phase 1 keeps everything in-process. Phase 3 will replace the
// reducer's per-action dispatches with a single `snapshot` action
// pushed by the worker; the reducer shape and CanvasState type stay
// identical so the swap is local to this file.

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { motion } from 'framer-motion'
import { useCanvasViewport } from '../hooks/useCanvasViewport'
import { canvasReducer } from '../canvas/canvasReducer'
import type { BoardScopedItem, GenericShapeType } from '../canvas/types'
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_FILL,
  DEFAULT_NOTE_TEXT,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH
} from '../canvas/types'
import { uid } from '../canvas/id'
import { CanvasItems } from '../canvas/CanvasItems'
import { CanvasFooter } from './CanvasFooter'
import { CanvasToolbar } from './CanvasToolbar'
import { PropertiesDrawer } from './PropertiesDrawer'

function makeInitialState() {
  const now = Date.now()
  const id = uid()
  const board = {
    id,
    name: DEFAULT_BOARD_NAME,
    createdAt: now,
    updatedAt: now,
    order: 0
  }
  return {
    boards: [board],
    items: {} as Record<string, BoardScopedItem>,
    activeBoardId: id
  }
}

const MIN_SHAPE_SIZE = 20

export function CanvasPage() {
  const {
    zoom,
    isPanning,
    surfaceRef,
    worldTransform,
    onSurfacePointerDown,
    zoomIn,
    zoomOut,
    resetView,
    canZoomIn,
    canZoomOut
  } = useCanvasViewport()

  const [state, dispatch] = useReducer(canvasReducer, undefined, makeInitialState)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const itemsArray = useMemo(() => Object.values(state.items), [state.items])
  const selectedItem = selectedId ? (state.items[selectedId] ?? null) : null

  // Spawn shapes at a pan-invariant world position with a 40px stacking
  // offset per item on the active board. Avoids the "shapes spawn at
  // viewport centre and disappear when I pan" trap in Phase 1, where
  // there's no click-to-place UX yet. The first shape lands at world
  // (100, 100) — visible at the default view (pan 0,0 / zoom 1).
  const computeSpawnWorld = useCallback((): { x: number; y: number } => {
    const itemsOnBoard = Object.values(state.items).filter(
      (i) => i.boardId === state.activeBoardId
    ).length
    const offset = itemsOnBoard * 40
    return { x: 100 + offset, y: 100 + offset }
  }, [state.items, state.activeBoardId])

  const addShape = useCallback(
    (type: GenericShapeType) => {
      if (!state.activeBoardId) return
      const { x, y } = computeSpawnWorld()
      const now = Date.now()
      const id = uid()
      let item: BoardScopedItem
      switch (type) {
        case 'rect':
        case 'ellipse':
          item = {
            id,
            boardId: state.activeBoardId,
            type,
            x,
            y,
            w: DEFAULT_SHAPE_SIZE.w,
            h: DEFAULT_SHAPE_SIZE.h,
            fill: DEFAULT_FILL,
            stroke: DEFAULT_STROKE,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            updatedAt: now
          }
          break
        case 'line':
        case 'arrow':
          item = {
            id,
            boardId: state.activeBoardId,
            type,
            x,
            y,
            x2: x + 200,
            y2: y,
            stroke: DEFAULT_STROKE,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            updatedAt: now
          }
          break
        case 'note':
          item = {
            id,
            boardId: state.activeBoardId,
            type,
            x,
            y,
            w: DEFAULT_SHAPE_SIZE.w,
            h: DEFAULT_SHAPE_SIZE.h,
            text: DEFAULT_NOTE_TEXT,
            stroke: DEFAULT_STROKE,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            updatedAt: now
          }
          break
      }
      dispatch({ type: 'add-item', item })
      setSelectedId(id)
    },
    [state.activeBoardId, computeSpawnWorld]
  )

  const handleDragEnd = useCallback((id: string, x: number, y: number) => {
    dispatch({ type: 'move-item', id, x, y, at: Date.now() })
  }, [])

  // Single seam for every property edit (fill, stroke, strokeWidth,
  // text, fontSize, lineCap, x/y/w/h/x2/y2). Used by the properties
  // drawer, resize handles, and note text editing.
  const handleUpdate = useCallback((id: string, patch: Partial<BoardScopedItem>) => {
    dispatch({ type: 'update-item', id, patch, at: Date.now() })
  }, [])

  // Resize math for the 4 corner handles. `dx, dy` are viewport-pixel
  // deltas from drag start (cumulative). `origin` is the snapshot of
  // the item at resize-start, captured by ResizeHandles, so we can
  // compute the new x/y/w/h from the original geometry every tick
  // (avoids React-stale-closure drift on rapid drags).
  const handleResize = useCallback(
    (
      id: string,
      handle: 'nw' | 'ne' | 'sw' | 'se',
      origin: BoardScopedItem,
      dx: number,
      dy: number
    ) => {
      const w0 = origin.w ?? DEFAULT_SHAPE_SIZE.w
      const h0 = origin.h ?? DEFAULT_SHAPE_SIZE.h
      const ddx = dx / zoom
      const ddy = dy / zoom
      let x = origin.x
      let y = origin.y
      let w = w0
      let h = h0
      switch (handle) {
        case 'nw':
          x = origin.x + ddx
          y = origin.y + ddy
          w = w0 - ddx
          h = h0 - ddy
          break
        case 'ne':
          y = origin.y + ddy
          w = w0 + ddx
          h = h0 - ddy
          break
        case 'sw':
          x = origin.x + ddx
          w = w0 - ddx
          h = h0 + ddy
          break
        case 'se':
          w = w0 + ddx
          h = h0 + ddy
          break
      }
      // Clamp so width/height stay positive. If shrinking past the
      // minimum would invert the drag direction (e.g. dragging the SE
      // handle up-left past the NW corner), freeze the opposite edge.
      if (w < MIN_SHAPE_SIZE) {
        const overshoot = MIN_SHAPE_SIZE - w
        w = MIN_SHAPE_SIZE
        if (handle === 'nw' || handle === 'sw') x -= overshoot
      }
      if (h < MIN_SHAPE_SIZE) {
        const overshoot = MIN_SHAPE_SIZE - h
        h = MIN_SHAPE_SIZE
        if (handle === 'nw' || handle === 'ne') y -= overshoot
      }
      handleUpdate(id, { x, y, w, h })
    },
    [zoom, handleUpdate]
  )

  const handleDelete = useCallback(() => {
    if (!selectedId) return
    dispatch({ type: 'remove-item', id: selectedId })
    setSelectedId(null)
  }, [selectedId])

  // Keyboard shortcuts: Delete / Backspace removes the selected shape.
  // Skip when the user is typing in an input/textarea/contenteditable
  // (mirrors the tamaflow Canvas.tsx pattern).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!selectedId) return
      const target = e.target as HTMLElement | null
      if (!target) {
        e.preventDefault()
        dispatch({ type: 'remove-item', id: selectedId })
        setSelectedId(null)
        return
      }
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      dispatch({ type: 'remove-item', id: selectedId })
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId])

  return (
    <motion.div
      key='canvas'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className='flex h-full w-full flex-col bg-white text-gray-800'
    >
      <CanvasToolbar
        zoom={zoom}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetView}
        onAddShape={addShape}
        onDelete={handleDelete}
        hasSelection={selectedId !== null}
      />
      <div className='flex flex-1 flex-row overflow-hidden'>
        <main
          ref={surfaceRef}
          onPointerDown={onSurfacePointerDown}
          onContextMenu={(e) => e.preventDefault()}
          className='canvas-grid relative flex-1 select-none overflow-hidden'
          style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
        >
          <div className='absolute inset-0 origin-top-left' style={{ transform: worldTransform }}>
            <CanvasItems
              items={itemsArray}
              activeBoardId={state.activeBoardId}
              selectedId={selectedId}
              zoom={zoom}
              onSelect={setSelectedId}
              onDragEnd={handleDragEnd}
              onUpdate={handleUpdate}
              onResize={handleResize}
            />
          </div>
        </main>
        <PropertiesDrawer selectedItem={selectedItem} onUpdate={handleUpdate} />
      </div>
      <CanvasFooter />
    </motion.div>
  )
}
