// The canvas page — wires the toolbar, viewport, items tree, footer, and
// properties drawer together. Holds the canvas reducer state (P2P-ready
// shape) and the ephemeral selection state (UI-only, not synced).
//
// Phase 1 keeps everything in-process. Phase 3 will replace the
// reducer's per-action dispatches with a single `snapshot` action
// pushed by the worker; the reducer shape and CanvasState type stay
// identical so the swap is local to this file.
//
// Iteration: editing table-stakes + connectors. Adds:
//   • selectedIds (Set) + ref mirror for window-level handlers
//   • withHistory wrapper for Cmd/Ctrl+Z/Y
//   • Keyboard nudge (arrows), clipboard (Cmd/Ctrl+C/X/V/D)
//   • Multi-shape group drag (delegated by DraggableShape)
//   • Z-order bring/send-to-front/back buttons
//   • Connector-endpoint construction + helper-driven drag patches

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import { useCanvasViewport } from '../hooks/useCanvasViewport'
import { useRoom } from '../hooks/useRoom'
import { canvasReducer } from '../canvas/canvasReducer'
import type { Action, CanvasState } from '../canvas/canvasReducer'
import { withHistory, type HistoryState } from '../canvas/history'
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_FILL,
  DEFAULT_NOTE_TEXT,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  getPortWorld,
  isConnector,
  type ActiveBoard,
  type Board,
  type BoardScopedItem,
  type ConnectorEnd,
  type GenericShapeType,
  type ResizeHandle
} from '../canvas/types'
import { uid } from '../canvas/id'
import { computeDragPatch, computeMultiDragPatch } from '../canvas/drag'
import { CanvasItems } from '../canvas/CanvasItems'
import { Marquee } from '../canvas/Marquee'
import { CanvasFooter } from './CanvasFooter'
import { CanvasToolbar } from './CanvasToolbar'
import { PropertiesDrawer } from './PropertiesDrawer'
import { GroupChatPanel } from './GroupChatPanel'

const MIN_SHAPE_SIZE = 20

function makeInitialCanvasState(): CanvasState {
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
    items: {},
    activeBoardId: id,
    orderCounter: 0
  }
}

function makeInitialHistoryState(): HistoryState {
  return { past: [], present: makeInitialCanvasState(), future: [] }
}

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

  const room = useRoom()

  const [historyState, dispatch] = useReducer(
    withHistory(canvasReducer),
    undefined,
    makeInitialHistoryState
  )
  const state = historyState.present

  // P2P integration: hydrate the reducer from the worker's snapshot,
  // and mirror every local dispatch through the worker. The reducer
  // shape (`snapshot` action replaces `present`) was already
  // designed for this in Phase 1; Phase 2 wires it through.
  const lastSnapshotRef = useRef<unknown>(null)
  useEffect(() => {
    if (!room.snapshot) return
    // Skip when the snapshot is byte-identical to the last one we
    // dispatched — prevents an extra history-past push when the
    // worker echoes our own writes.
    if (lastSnapshotRef.current === room.snapshot) return
    lastSnapshotRef.current = room.snapshot
    const activeBoard: ActiveBoard | null = room.snapshot.activeBoardId
      ? { key: 'current', boardId: room.snapshot.activeBoardId }
      : null
    // Worker-decoded items already match BoardScopedItem for the
    // local reducer's purposes (ids are hex strings, connector
    // endpoints are parsed back into plain objects). The double-
    // cast through `unknown` is needed because the worker's `type`
    // is a free `string` while the reducer's `ShapeType` is a
    // narrow union; we trust the worker to only emit shapes the
    // renderer ever created.
    dispatch({
      type: 'snapshot',
      boards: room.snapshot.boards,
      items: room.snapshot.items as unknown as BoardScopedItem[],
      activeBoard
    })
  }, [room.snapshot, dispatch])

  // Stable ref to `sendAction` so `dispatchAction` stays referentially
  // stable across renders (otherwise every room.snapshot would force
  // re-binding of every keyboard / drag handler).
  const sendActionRef = useRef(room.sendAction)
  sendActionRef.current = room.sendAction
  const dispatchAction = useCallback(
    (action: Action) => {
      dispatch(action)
      // Local-only actions never reach the wire; the hook filter covers
      // most of them but stay defensive here too.
      sendActionRef.current(action)
    },
    [dispatch]
  )

  // Ephemeral selection — Set for O(1) membership. Pairs with a ref
  // mirror so window-level event handlers always see the latest set
  // without forcing a listener re-bind on every selection change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedIdsRef = useRef<Set<string>>(new Set())
  selectedIdsRef.current = selectedIds

  // Ephemeral clipboard (in-memory only).
  const [clipboard, setClipboard] = useState<BoardScopedItem[] | null>(null)

  // Toggle marquee mode. Clicking the toolbar button arms the marquee;
  // clicking it again (or pressing Escape) disarms it. The toggle stays
  // armed across many drags — the user can paint several marquees in
  // a row without re-clicking the button, mirroring how Adobe / Figma
  // handle the marquee tool.
  const [marqueeMode, setMarqueeMode] = useState(false)
  const marqueeModeRef = useRef(false)
  marqueeModeRef.current = marqueeMode

  const handleMarqueePressStart = useCallback(() => {
    setMarqueeMode(true)
  }, [])
  const handleMarqueePressEnd = useCallback(() => {
    setMarqueeMode(false)
  }, [])

  // Disarm marquee on Escape so the user has a single-key way out
  // without hunting for the toolbar button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (marqueeModeRef.current) {
        e.preventDefault()
        setMarqueeMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Sort by `order` so render order is stable and matches what the
  // z-order buttons manipulate. Items without an explicit order fall
  // back to insertion order (already maintained by Record).
  const itemsArray = useMemo(
    () => Object.values(state.items).sort((a, b) => a.order - b.order),
    [state.items]
  )
  const visibleItemIds = useMemo(
    () => itemsArray.filter((it) => it.boardId === state.activeBoardId).map((it) => it.id),
    [itemsArray, state.activeBoardId]
  )
  const itemsById = state.items

  // Single selected (legacy single-selection shape — used when only
  // one item is selected and we want the rich properties drawer UI).
  const singleSelected = selectedIds.size === 1 ? (itemsById[[...selectedIds][0]] ?? null) : null

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
            text: DEFAULT_NOTE_TEXT,
            order: 0,
            updatedAt: now
          }
          break
        case 'line':
        case 'arrow': {
          // Connectors carry `start` / `end` (free-floating by default).
          const start: ConnectorEnd = { kind: 'free', x, y }
          const end: ConnectorEnd = { kind: 'free', x: x + 200, y }
          item = {
            id,
            boardId: state.activeBoardId,
            type,
            x,
            y,
            stroke: DEFAULT_STROKE,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            lineCap: 'round',
            start,
            end,
            order: 0,
            updatedAt: now
          }
          break
        }
      }
      // `order` is overridden by the reducer; the placeholder keeps
      // the type-checker happy until the reducer assigns it.
      dispatchAction({ type: 'add-item', item: { ...item, order: 0 } })
      // Selecting a newly-spawned shape keeps it visible to the user.
      setSelectedIds(new Set([id]))
    },
    [state.activeBoardId, computeSpawnWorld]
  )

  // Selection setters used by the shape tree. Three modes:
  //   replace — swap the selection to the single new id (or empty)
  //   toggle  — flip membership of the clicked id
  //   add     — union the new id into the existing set
  // Clicking an already-selected item with no modifier is a no-op
  // (so multi-drag doesn't deselect when the user grabs a member).
  const handleSelect = useCallback(
    (id: string | null, mode: 'replace' | 'toggle' | 'add' = 'replace') => {
      setSelectedIds((prev) => {
        if (id === null) {
          // Background click — clear, regardless of mode.
          return new Set()
        }
        if (mode === 'toggle') {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        }
        if (mode === 'add') {
          const next = new Set(prev)
          next.add(id)
          return next
        }
        // replace: keep multi-selection if id is already in it (no-op).
        if (prev.has(id) && prev.size > 1) return prev
        return new Set([id])
      })
    },
    []
  )

  // Single seam for every property edit. Used by the properties
  // drawer, resize handles, connector drag, and z-order bump.
  const handleUpdate = useCallback(
    (id: string, patch: Partial<BoardScopedItem>) => {
      dispatchAction({ type: 'update-item', id, patch, at: Date.now() })
    },
    [dispatchAction]
  )

  // Same as `handleUpdate` but the history wrapper won't push the
  // change onto the past stack. Used for per-pointermove updates
  // during resize, multi-drag, and connector snap preview.
  const handleTransientUpdate = useCallback(
    (id: string, patch: Partial<BoardScopedItem>) => {
      dispatchAction({
        type: 'update-item',
        id,
        patch,
        at: Date.now(),
        meta: { transient: true }
      })
    },
    [dispatchAction]
  )

  // Resize math for the 4 corner handles. `dx, dy` are viewport-pixel
  // deltas from drag start (cumulative). `origin` is the snapshot of
  // the item at resize-start, captured by ResizeHandles, so we can
  // compute the new x/y/w/h from the original geometry every tick
  // (avoids React-stale-closure drift on rapid drags).
  const handleResize = useCallback(
    (id: string, handle: ResizeHandle, origin: BoardScopedItem, dx: number, dy: number) => {
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

  // Commit a single-shape drag translation. `dx`, `dy` are viewport
  // pixels. Lines/arrows get special handling via `computeDragPatch`
  // so both endpoints (and any attached hosts) shift together.
  const handleCommitDrag = useCallback(
    (id: string, dx: number, dy: number) => {
      const item = state.items[id]
      if (!item) return
      const patch = computeDragPatch({
        item,
        dx,
        dy,
        zoom,
        itemsById: state.items
      })
      handleUpdate(id, patch)
    },
    [zoom, state.items, handleUpdate]
  )

  // Multi-shape group drag entry point. DraggableShape calls this
  // when the user pointerdowns on a shape that's part of a multi-
  // selection; we set up window-level move listeners that dispatch
  // a transient `update-item` per selected shape per pointermove,
  // and a non-transient one on pointerup to commit a single history
  // entry per gesture.
  const multiDragRef = useRef<{
    startPositions: Map<string, { x: number; y: number }>
    startClientX: number
    startClientY: number
    ids: string[]
  } | null>(null)

  const beginMultiDrag = useCallback(
    (primaryId: string, e: ReactPointerEvent<SVGGElement>) => {
      const sel = selectedIdsRef.current
      if (sel.size <= 1 || !sel.has(primaryId)) return false
      const startPositions = new Map<string, { x: number; y: number }>()
      const ids: string[] = []
      for (const id of sel) {
        const it = state.items[id]
        if (!it) continue
        startPositions.set(id, { x: it.x, y: it.y })
        ids.push(id)
      }
      multiDragRef.current = {
        startPositions,
        startClientX: e.clientX,
        startClientY: e.clientY,
        ids
      }

      function onMove(ev: PointerEvent) {
        const drag = multiDragRef.current
        if (!drag) return
        const dx = ev.clientX - drag.startClientX
        const dy = ev.clientY - drag.startClientY
        const itemsById = state.items
        for (const id of drag.ids) {
          const item = itemsById[id]
          if (!item) continue
          const start = drag.startPositions.get(id)
          if (!start) continue
          const patch = computeMultiDragPatch(start, item, dx, dy, zoom, itemsById)
          handleTransientUpdate(id, patch)
        }
      }

      function commitTransient(ev: PointerEvent) {
        const drag = multiDragRef.current
        if (!drag) return
        const dx = ev.clientX - drag.startClientX
        const dy = ev.clientY - drag.startClientY
        const itemsById = state.items
        for (const id of drag.ids) {
          const item = itemsById[id]
          if (!item) continue
          const start = drag.startPositions.get(id)
          if (!start) continue
          const patch = computeMultiDragPatch(start, item, dx, dy, zoom, itemsById)
          // Non-transient commit — one history entry per gesture.
          handleUpdate(id, patch)
        }
        multiDragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', commitTransient)
        window.removeEventListener('pointercancel', cancelDrag)
      }

      function cancelDrag() {
        multiDragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', commitTransient)
        window.removeEventListener('pointercancel', cancelDrag)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', commitTransient)
      window.addEventListener('pointercancel', cancelDrag)
      return true
    },
    [state.items, zoom, handleUpdate, handleTransientUpdate]
  )

  const handleDelete = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    const ids = Array.from(sel)
    dispatchAction({ type: 'remove-items', ids, at: Date.now() })
    setSelectedIds(new Set())
  }, [dispatchAction])

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(visibleItemIds))
  }, [visibleItemIds])

  const handleDeselect = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleUndo = useCallback(() => {
    dispatchAction({ type: 'undo' })
  }, [dispatchAction])

  const handleRedo = useCallback(() => {
    dispatchAction({ type: 'redo' })
  }, [dispatchAction])

  // Bring-to-front / send-to-back for the current selection. Multi-
  // selection preserves relative order by assigning contiguous values
  // so the group's internal z-order doesn't shuffle.
  const handleBringToFront = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    // Snapshot current order for the selection (insertion order from
    // itemsArray) so the chosen relative order is deterministic.
    const selected = itemsArray.filter((it) => sel.has(it.id))
    const maxOrder = itemsArray.reduce((acc, it) => Math.max(acc, it.order), 0)
    selected.forEach((item, i) => {
      handleUpdate(item.id, { order: maxOrder + 1 + i })
    })
  }, [itemsArray, handleUpdate])

  const handleSendToBack = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    const selected = itemsArray.filter((it) => sel.has(it.id))
    const minOrder = itemsArray.reduce((acc, it) => Math.min(acc, it.order), 0)
    selected.forEach((item, i) => {
      handleUpdate(item.id, { order: minOrder - 1 - i })
    })
  }, [itemsArray, handleUpdate])

  // ── Boards ─────────────────────────────────────────────────────
  // Add / select / rename / delete the active board. Boards lifecycle
  // is local + sync'd (set-active + reorder-boards are renderer-only
  // and not forwarded to the worker).
  const handleAddBoard = useCallback(() => {
    const now = Date.now()
    const order = state.boards.length
    const board: Board = {
      id: uid(),
      name: `${DEFAULT_BOARD_NAME} ${order + 1}`,
      createdAt: now,
      updatedAt: now,
      order
    }
    dispatchAction({ type: 'add-board', board })
    setSelectedIds(new Set())
  }, [dispatchAction, state.boards.length])

  const handleSelectBoard = useCallback(
    (id: string) => {
      dispatchAction({ type: 'set-active', id })
      setSelectedIds(new Set())
    },
    [dispatchAction]
  )

  const handleRenameBoard = useCallback(
    (id: string, name: string) => {
      dispatchAction({ type: 'rename-board', id, name, at: Date.now() })
    },
    [dispatchAction]
  )

  const handleDeleteBoard = useCallback(
    (id: string) => {
      dispatchAction({ type: 'delete-board', id })
      setSelectedIds(new Set())
    },
    [dispatchAction]
  )

  // Clipboard ops. Pasted items get fresh ids and a (20,20) offset so
  // they don't stack on top of the originals. Attached lines carrying
  // `kind:'attached'` re-target the same itemId — orphan cascade on
  // the destination board keeps things honest if the host is gone.
  const handleCopy = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    const items = itemsArray.filter((it) => sel.has(it.id)).map(deepClone)
    setClipboard(items)
  }, [itemsArray])

  const handleCut = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    const items = itemsArray.filter((it) => sel.has(it.id)).map(deepClone)
    setClipboard(items)
    const ids = Array.from(sel)
    dispatchAction({ type: 'remove-items', ids, at: Date.now() })
    setSelectedIds(new Set())
  }, [itemsArray, dispatchAction])

  const handlePaste = useCallback(() => {
    const clip = clipboard
    if (!clip || clip.length === 0) return
    const now = Date.now()
    const next = clip.map((it, i) => {
      // Deep clone, reset id, offset position by (20, 20) per index.
      const fresh = deepClone(it)
      fresh.id = uid()
      // Offset start/end (if any) by (20, 20); mirrors the item.x shift.
      const offset = (i + 1) * 20
      if (isConnector(fresh.type) && fresh.start && fresh.end) {
        if (fresh.start.kind === 'free' || fresh.start.kind === 'orphan') {
          fresh.start = { ...fresh.start, x: fresh.start.x + offset, y: fresh.start.y + offset }
        }
        if (fresh.end.kind === 'free' || fresh.end.kind === 'orphan') {
          fresh.end = { ...fresh.end, x: fresh.end.x + offset, y: fresh.end.y + offset }
        }
      }
      fresh.x = (fresh.x ?? 0) + offset
      fresh.y = (fresh.y ?? 0) + offset
      fresh.updatedAt = now
      return fresh
    })
    dispatchAction({ type: 'add-items', items: next, at: now })
    setSelectedIds(new Set(next.map((it) => it.id)))
  }, [clipboard, dispatchAction])

  const handleDuplicate = useCallback(() => {
    const sel = selectedIdsRef.current
    if (sel.size === 0) return
    const now = Date.now()
    const next = itemsArray
      .filter((it) => sel.has(it.id))
      .map((it, i) => {
        const fresh = deepClone(it)
        fresh.id = uid()
        const offset = (i + 1) * 20
        if (isConnector(fresh.type) && fresh.start && fresh.end) {
          if (fresh.start.kind === 'free' || fresh.start.kind === 'orphan') {
            fresh.start = { ...fresh.start, x: fresh.start.x + offset, y: fresh.start.y + offset }
          }
          if (fresh.end.kind === 'free' || fresh.end.kind === 'orphan') {
            fresh.end = { ...fresh.end, x: fresh.end.x + offset, y: fresh.end.y + offset }
          }
        }
        fresh.x = (fresh.x ?? 0) + offset
        fresh.y = (fresh.y ?? 0) + offset
        fresh.updatedAt = now
        return fresh
      })
    dispatchAction({ type: 'add-items', items: next, at: now })
    setSelectedIds(new Set(next.map((it) => it.id)))
  }, [itemsArray, dispatchAction])

  // Keyboard shortcuts. One window-level keydown listener. Native event
  // capture isn't used: each handler reads state via refs/memos and
  // short-circuits when focus is in an input/textarea/contentEditable
  // so the drawer's text fields don't get hijacked.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      const inEditableField =
        tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable)

      // Undo / redo work even inside inputs (standard app convention).
      const meta = e.metaKey || e.ctrlKey
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) handleRedo()
        else handleUndo()
        return
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        handleRedo()
        return
      }

      // Clipboard ops require non-editable focus.
      if (!inEditableField) {
        if (meta && (e.key === 'c' || e.key === 'C')) {
          e.preventDefault()
          handleCopy()
          return
        }
        if (meta && (e.key === 'x' || e.key === 'X')) {
          e.preventDefault()
          handleCut()
          return
        }
        if (meta && (e.key === 'v' || e.key === 'V')) {
          e.preventDefault()
          handlePaste()
          return
        }
        if (meta && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault()
          handleDuplicate()
          return
        }
        if (meta && (e.key === 'a' || e.key === 'A')) {
          e.preventDefault()
          handleSelectAll()
          return
        }
        if (e.key === 'Escape') {
          handleDeselect()
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectedIdsRef.current.size > 0) {
            e.preventDefault()
            handleDelete()
          }
          return
        }
        // Keyboard nudge: arrows move the selection by 1px (10px with Shift).
        // Skip auto-repeated events so a held arrow doesn't flood history.
        if (
          selectedIdsRef.current.size > 0 &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) &&
          !e.repeat
        ) {
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const ddx = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / zoom
          const ddy = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / zoom
          const itemsById = state.items
          for (const id of selectedIdsRef.current) {
            const item = itemsById[id]
            if (!item) continue
            if (isConnector(item.type)) {
              // For connectors, translate both endpoints. `attached` ends
              // detach to `free` at the original port world position
              // offset by the nudge; `free` and `orphan` ends shift their
              // stored x,y. This keeps the line visually tracking the
              // host's start position.
              const start = shiftEnd(item.start, ddx, ddy, itemsById)
              const end = shiftEnd(item.end, ddx, ddy, itemsById)
              handleUpdate(id, { x: item.x + ddx, y: item.y + ddy, start, end })
            } else {
              handleUpdate(id, { x: item.x + ddx, y: item.y + ddy })
            }
          }
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    zoom,
    state.items,
    handleUpdate,
    handleCopy,
    handleCut,
    handlePaste,
    handleDuplicate,
    handleSelectAll,
    handleDeselect,
    handleDelete,
    handleUndo,
    handleRedo
  ])

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
        hasSelection={selectedIds.size > 0}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        marqueeActive={marqueeMode}
        onMarqueePressStart={handleMarqueePressStart}
        onMarqueePressEnd={handleMarqueePressEnd}
        boards={state.boards}
        activeBoardId={state.activeBoardId}
        onSelectBoard={handleSelectBoard}
        onAddBoard={handleAddBoard}
        onRenameBoard={handleRenameBoard}
        onDeleteBoard={handleDeleteBoard}
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
              selectedIds={selectedIds}
              zoom={zoom}
              itemsById={itemsById}
              surfaceRef={surfaceRef}
              onSelect={handleSelect}
              onCommitDrag={handleCommitDrag}
              onMaybeMultiDrag={beginMultiDrag}
              onUpdate={handleUpdate}
              onResize={handleResize}
              onTransientUpdate={handleTransientUpdate}
            />
          </div>
          <Marquee
            surfaceRef={surfaceRef}
            zoom={zoom}
            items={itemsArray}
            itemsById={itemsById}
            enabled={marqueeMode}
            onCommit={(ids) => setSelectedIds(new Set(ids))}
          />
        </main>
        <PropertiesDrawer
          selectedItem={singleSelected}
          selectedCount={selectedIds.size}
          selectedIds={Array.from(selectedIds)}
          itemsById={itemsById}
          onUpdate={handleUpdate}
          onTransientUpdate={handleTransientUpdate}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          emptyPanel={
            <GroupChatPanel
              invite={room.invite}
              peers={room.peers}
              messages={room.chat}
              role={room.role}
              writable={room.writable}
              me={room.me}
              onSendChat={room.sendChat}
              onCopyInvite={() => {
                if (!room.invite) return
                if (navigator.clipboard?.writeText) {
                  navigator.clipboard.writeText(room.invite).catch(() => {})
                }
              }}
            />
          }
        />
      </div>
      <CanvasFooter />
    </motion.div>
  )
}

// Shift a connector endpoint by (ddx, ddy) world units. `attached`
// ends detach to `free` at the original port world position offset
// by the nudge; `free` and `orphan` ends shift their stored x,y.
// Pairs with the keyboard-nudge branch.
function shiftEnd(
  end: ConnectorEnd | undefined,
  ddx: number,
  ddy: number,
  itemsById: Record<string, BoardScopedItem>
): ConnectorEnd | undefined {
  if (!end) return end
  if (end.kind === 'attached') {
    const target = itemsById[end.itemId]
    if (!target) return { kind: 'orphan', x: 0, y: 0, deletedItemId: end.itemId }
    const port = getPortWorld(target, end.port)
    return { kind: 'free', x: port.x + ddx, y: port.y + ddy }
  }
  if (end.kind === 'free') {
    return { kind: 'free', x: end.x + ddx, y: end.y + ddy }
  }
  if (end.kind === 'orphan') {
    return {
      kind: 'orphan',
      x: end.x + ddx,
      y: end.y + ddy,
      deletedItemId: end.deletedItemId
    }
  }
  return end
}

// Deep clone a `BoardScopedItem`, including the ConnectorEnd union.
// Plain `structuredClone` works in modern Electron; we hand-write it
// so the renderer stays portable to React Native if that ever lands.
function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch {
      // fall through
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}
