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
import { AnimatePresence, motion } from 'framer-motion'
import { useCanvasViewport } from '../hooks/useCanvasViewport'
import { useRoom } from '../hooks/useRoom'
import { canvasReducer } from '../canvas/canvasReducer'
import type { Action, CanvasState } from '../canvas/canvasReducer'
import { withHistory, type HistoryState } from '../canvas/history'
import {
  DEFAULT_BOARD_NAME,
  DEFAULT_FILL,
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_NOTE_TEXT,
  DEFAULT_SHAPE_SIZE,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_TEXT_SIZE,
  computeBoundingBox,
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
import { CanvasOverlay, type DraftConnector } from '../canvas/CanvasOverlay'
import { findNearestPort } from '../canvas/findPort'
import { Marquee } from '../canvas/Marquee'
import { CanvasFooter } from './CanvasFooter'
import { CanvasToolbar, type SelectedTool } from './CanvasToolbar'
import { PropertiesDrawer } from './PropertiesDrawer'
import { TemplatesModal } from './TemplatesModal'
import { SlideInPanel } from './SlideInPanel'
import { FloatingChatButton } from './FloatingChatButton'
import { AIChatTab } from './AIChatTab'
import { GroupChatPanel } from './GroupChatPanel'
import { BoardBackupError, buildBackupFilename, parseBackup, serializeBoard } from '../data/boardIO'
import {
  buildExportFilename,
  buildExportSvg,
  rasterizeSvgToPng,
  selectionRect,
  viewportRect,
  type ExportLayout
} from '../canvas/svgExport'

const MIN_SHAPE_SIZE = 20

// Snap radius for the connector draw flow. Same screen-pixel value as
// the existing `ConnectorHandles` so the two paths feel identical;
// `clientToWorld` divides by zoom to convert to world units.
const CONNECTOR_SNAP_RADIUS_PX = 30
// Minimum distance (world units) the cursor must travel between
// pointerdown and pointerup to count as a "draw" rather than a click.
// Clicks without movement drop the draft without committing — keeps
// the canvas free of 0-length connectors from accidental clicks.
const CONNECTOR_MIN_DRAG_DISTANCE = 8

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
    pan,
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
    // Active-board selection is per-renderer UI state — the worker
    // intentionally doesn't track it (it would force every peer onto
    // the same board). Preserve the renderer's local `state.activeBoardId`
    // when it's still a valid id in the snapshot's boards list, even if
    // a transient snapshot arrives. Only fall back to the worker's
    // suggestion when our current active board no longer exists (deleted)
    // or we don't yet have one (first snapshot after boot).
    const workerActive = room.snapshot.activeBoardId
    const localActive = state.activeBoardId
    const boardsHaveLocal =
      localActive !== null && room.snapshot.boards.some((b) => b.id === localActive)
    const effectiveActive = boardsHaveLocal ? localActive : workerActive
    const activeBoard: ActiveBoard | null = effectiveActive
      ? { key: 'current', boardId: effectiveActive }
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
  }, [room.snapshot, state.activeBoardId, dispatch])

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

  // Templates modal open/close. Insert closes the modal as a side effect
  // of the optimistic dispatch in `handleInsertTemplate`.
  const [templatesOpen, setTemplatesOpen] = useState(false)

  // Toggle marquee mode. Clicking the toolbar button arms the marquee;
  // clicking it again (or pressing Escape) disarms it. The toggle stays
  // armed across many drags — the user can paint several marquees in
  // a row without re-clicking the button, mirroring how Adobe / Figma
  // handle the marquee tool.
  const [marqueeMode, setMarqueeMode] = useState(false)
  const marqueeModeRef = useRef(false)

  // Floating chat panels — AI (left) and Team (right)
  const [showAiChat, setShowAiChat] = useState(false)
  const [showTeamChat, setShowTeamChat] = useState(false)

  // Phase 3: connector draw mode. The toolbar's Connector button flips
  // this; the canvas surface then intercepts pointerdown to start a
  // drag-to-create flow with snap-to-port. The local state is purely
  // UI — nothing here is dispatched to the worker until pointerup
  // commits a real `add-item` action.
  const [selectedTool, setSelectedTool] = useState<SelectedTool>(null)
  // Shape under the cursor in connector mode (drives the visible ports
  // overlay). `null` when the cursor is over empty canvas.
  const [hoverShapeId, setHoverShapeId] = useState<string | null>(null)
  // In-flight connector — present only between pointerdown and
  // pointerup of a draw gesture.
  const [draft, setDraft] = useState<DraftConnector | null>(null)
  // Refs mirror the above so window-level pointermove / pointerup
  // listeners always see the latest values without forcing a re-bind
  // on every state change.
  const draftRef = useRef<DraftConnector | null>(null)
  draftRef.current = draft
  const selectedToolRef = useRef<SelectedTool>(null)
  selectedToolRef.current = selectedTool
  marqueeModeRef.current = marqueeMode
  // Pan ref mirrors the viewport hook's `pan` so the window-level
  // pointer listeners (draft draw flow) always convert with the latest
  // viewport offset without forcing a re-bind on every pan change.
  const panRef = useRef(pan)
  panRef.current = pan

  const handleMarqueePressStart = useCallback(() => {
    setMarqueeMode(true)
  }, [])
  const handleMarqueePressEnd = useCallback(() => {
    setMarqueeMode(false)
  }, [])

  // ── Connector draw mode (Phase 3) ──────────────────────────────
  //
  // The connector tool follows a Figma-style dot-to-dot flow:
  //
  //   • Toolbar button arms the mode (sets `selectedTool` to 'connector').
  //   • On pointerdown over the canvas, snap to the nearest port within
  //     the screen-scaled radius; otherwise anchor at the cursor. Set
  //     the in-flight draft to start = end (zero-length).
  //   • On pointermove, track the cursor and snap the moving end to
  //     the nearest port. Update the draft state.
  //   • On pointerup, if the cursor travelled at least
  //     CONNECTOR_MIN_DRAG_DISTANCE world units, commit a new
  //     connector via `add-item`. Otherwise drop the draft as an
  //     accidental click.
  //
  // The draft state is purely local — nothing reaches the worker until
  // pointerup commits the connector, so a cancelled draw (Escape or
  // sub-minimum drag) leaves no history or network trace.

  // Convert client coords to world coords. Pan is the viewport's pixel
  // offset of world (0, 0) on screen — see `useCanvasViewport.worldTransform`
  // (`translate(pan) scale(zoom)`), so world = (client - surface.origin - pan) / zoom.
  // The wheel handler in `useCanvasViewport` uses the same formula; keep them in sync.
  function clientToWorld(
    clientX: number,
    clientY: number,
    zoomVal: number,
    panX: number,
    panY: number
  ) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (clientX - rect.left - panX) / zoomVal,
      y: (clientY - rect.top - panY) / zoomVal
    }
  }

  // Find the topmost shape under the cursor (highest `order`). Used to
  // decide which shape's ports to render in the overlay. Skips
  // connectors (they have no ports). Returns null if nothing's under
  // the cursor.
  function hitTestShape(cursor: { x: number; y: number }): string | null {
    let topId: string | null = null
    let topOrder = -Infinity
    for (const item of Object.values(state.items)) {
      if (item.type === 'connector') continue
      if (item.w === undefined || item.h === undefined) continue
      const bb = computeBoundingBox(item, state.items)
      if (
        cursor.x >= bb.x &&
        cursor.x <= bb.x + bb.w &&
        cursor.y >= bb.y &&
        cursor.y <= bb.y + bb.h
      ) {
        if (item.order > topOrder) {
          topId = item.id
          topOrder = item.order
        }
      }
    }
    return topId
  }

  // Surface pointerdown — branches on connector mode. Wraps the
  // viewport hook's `onSurfacePointerDown` so the pan handler still
  // runs for the other tools.
  const handleSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (selectedToolRef.current === 'connector' && e.button === 0) {
        e.preventDefault()
        e.stopPropagation()
        const w = clientToWorld(e.clientX, e.clientY, zoom, pan.x, pan.y)
        const snap = findNearestPort(w, null, state.items, CONNECTOR_SNAP_RADIUS_PX / zoom)
        const start = snap ? getPortWorld(state.items[snap.itemId], snap.port) : w
        setDraft({
          start,
          end: start,
          startSnap: snap,
          endSnap: null
        })
        return
      }
      onSurfacePointerDown(e)
    },
    [zoom, pan.x, pan.y, state.items, onSurfacePointerDown]
  )

  // Window-level pointermove / pointerup while a draft is in flight.
  // The handlers read from refs so they always see the latest zoom +
  // items without forcing a re-bind on every render.
  useEffect(() => {
    if (!draft) return

    function onMove(e: PointerEvent) {
      const d = draftRef.current
      if (!d) return
      const p = panRef.current
      const w = clientToWorld(e.clientX, e.clientY, zoom, p.x, p.y)
      const snap = findNearestPort(w, null, state.items, CONNECTOR_SNAP_RADIUS_PX / zoom)
      const end = snap ? getPortWorld(state.items[snap.itemId], snap.port) : w
      setDraft({ start: d.start, end, startSnap: d.startSnap, endSnap: snap })
    }

    function onUp() {
      const d = draftRef.current
      draftRef.current = null
      setDraft(null)
      if (!d) return
      const dx = d.end.x - d.start.x
      const dy = d.end.y - d.start.y
      if (Math.hypot(dx, dy) < CONNECTOR_MIN_DRAG_DISTANCE) {
        // Sub-threshold click — drop the draft without committing.
        return
      }
      const start: ConnectorEnd = d.startSnap
        ? { kind: 'attached', itemId: d.startSnap.itemId, port: d.startSnap.port }
        : { kind: 'free', x: d.start.x, y: d.start.y }
      const end: ConnectorEnd = d.endSnap
        ? { kind: 'attached', itemId: d.endSnap.itemId, port: d.endSnap.port }
        : { kind: 'free', x: d.end.x, y: d.end.y }
      if (!state.activeBoardId) return
      const id = uid()
      const now = Date.now()
      dispatchAction({
        type: 'add-item',
        item: {
          id,
          boardId: state.activeBoardId,
          type: 'connector',
          x: d.start.x,
          y: d.start.y,
          stroke: DEFAULT_STROKE,
          strokeWidth: DEFAULT_STROKE_WIDTH,
          lineCap: 'round',
          arrowStart: 'none',
          arrowEnd: 'arrow',
          strokePattern: 'solid',
          curve: 'straight',
          start,
          end,
          order: 0,
          updatedAt: now
        }
      })
      setSelectedIds(new Set([id]))
      setSelectedTool(null)
      setHoverShapeId(null)
    }

    function onCancel() {
      draftRef.current = null
      setDraft(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [draft, zoom, state.items, state.activeBoardId, dispatchAction])

  // Pointermove on the surface (no button) drives the hover-ports
  // overlay. Only active when the connector tool is armed and no
  // draft is in flight. Installed at the surface level so it shares
  // the same coordinate space as the surface.
  const handleSurfacePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (selectedToolRef.current !== 'connector') return
      if (draftRef.current !== null) return
      const w = clientToWorld(e.clientX, e.clientY, zoom, pan.x, pan.y)
      setHoverShapeId(hitTestShape(w))
    },
    [zoom, pan.x, pan.y]
  )

  const handleSurfacePointerLeave = useCallback(() => {
    // Pointer leaves the surface — clear hover so the ports overlay
    // doesn't linger at the last known location.
    if (selectedToolRef.current !== 'connector') return
    setHoverShapeId(null)
  }, [])

  // When the user switches off the connector tool, drop any in-flight
  // draft and clear the hover. (Escape already handles this; this is
  // a belt-and-suspenders for clicks on the toolbar button.)
  useEffect(() => {
    if (selectedTool !== 'connector') {
      setDraft(null)
      setHoverShapeId(null)
    }
  }, [selectedTool])

  // Disarm marquee on Escape so the user has a single-key way out
  // without hunting for the toolbar button. Connector draw mode also
  // gets cleared — the in-flight draft is dropped without committing.
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
      if (selectedToolRef.current !== null) {
        e.preventDefault()
        setSelectedTool(null)
        setDraft(null)
        setHoverShapeId(null)
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
            text: '',
            fontSize: DEFAULT_NOTE_FONT_SIZE,
            order: 0,
            updatedAt: now
          }
          break
        case 'connector': {
          // Phase 3 unified connector — default to a 200-unit horizontal
          // arrow (arrowhead at end). The toolbar's primary path is the
          // drag-to-create flow (`selectedTool === 'connector'`); this
          // branch is a fallback for any direct call to `addShape` (test
          // hooks, future programmatic use).
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
            arrowStart: 'none',
            arrowEnd: 'arrow',
            strokePattern: 'solid',
            curve: 'straight',
            start,
            end,
            order: 0,
            updatedAt: now
          }
          break
        }
        case 'text':
          item = {
            id,
            boardId: state.activeBoardId,
            type,
            x,
            y,
            w: DEFAULT_TEXT_SIZE.w,
            h: DEFAULT_TEXT_SIZE.h,
            stroke: DEFAULT_STROKE,
            strokeWidth: DEFAULT_STROKE_WIDTH,
            text: '',
            fontSize: DEFAULT_TEXT_FONT_SIZE,
            order: 0,
            updatedAt: now
          }
          break
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

  // Insert a pre-built template. Items come from `data/templates.ts`
  // with placeholder ids/boardId — we stamp them with the active board
  // + fresh uids + updatedAt here, then dispatch through the existing
  // `add-items` bulk action (which goes through `useRoom.sendAction` so
  // peers echo the same items via the Autobase snapshot).
  const handleInsertTemplate = useCallback(
    (templateItems: BoardScopedItem[]) => {
      if (!state.activeBoardId) return
      const now = Date.now()
      const stamped = templateItems.map((it) => ({
        ...it,
        id: uid(),
        boardId: state.activeBoardId!,
        updatedAt: now,
        order: 0
      }))
      dispatchAction({ type: 'add-items', items: stamped, at: now })
      setSelectedIds(new Set(stamped.map((it) => it.id)))
      setTemplatesOpen(false)
    },
    [state.activeBoardId, dispatchAction]
  )

  // ── Backup / Restore (board file v1, JSON) ─────────────────────
  //
  // Backup writes the active board's items to a `Tamarind board file
  // v1` JSON document and triggers a download via the renderer Blob
  // + anchor dance. Restore opens a file picker, reads the file,
  // parses + validates it, and dispatches a single `add-items` for
  // the recovered shapes with fresh ids + the active boardId.
  //
  // Restore re-stamps every item (ids + boardId) before dispatch, so
  // a backup from a different room doesn't collide with the local
  // item namespace. The restored shapes land on the active board;
  // the backup's original board metadata is preserved in the file
  // but not applied as a rename — auto-rename would surprise users
  // who expect Restore to be additive. (The `parsed.name` is still
  // available for a future "Restore as new board" button.)
  // Renamed from `restoreBanner` in Phase 4 — the same banner now
  // surfaces success/error for the Backup, Restore, and Export flows.
  const [feedbackBanner, setFeedbackBanner] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)

  const handleBackup = useCallback(() => {
    if (!state.activeBoardId) return
    const board = state.boards.find((b) => b.id === state.activeBoardId)
    if (!board) return
    const items = itemsArray.filter((it) => it.boardId === state.activeBoardId)
    const text = serializeBoard(board, items, Date.now())
    const filename = buildBackupFilename(board)
    // Renders the Blob + anchor download. `URL.createObjectURL` is
    // paired with `revokeObjectURL` on the next macrotask to avoid
    // revoking before the browser reads the URL.
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 0)
    setFeedbackBanner({
      kind: 'success',
      message: `Backed up "${board.name}" (${items.length} item${items.length === 1 ? '' : 's'})`
    })
  }, [state.activeBoardId, state.boards, itemsArray])

  const handleRestore = useCallback(() => {
    // Hidden <input> + `.click()` is the only cross-platform way to
    // open a native file picker from a button onClick. The input is
    // detached after the user picks (or cancels) so it doesn't
    // accumulate in the DOM.
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.tamarind.json,application/json'
    input.style.display = 'none'
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        try {
          const parsed = parseBackup(text)
          if (!state.activeBoardId) {
            setFeedbackBanner({ kind: 'error', message: 'No active board to restore into' })
            return
          }
          if (parsed.items.length === 0) {
            setFeedbackBanner({
              kind: 'error',
              message: `Backup "${parsed.name}" has no items to restore`
            })
            return
          }
          const now = Date.now()
          const stamped = parsed.items.map((it) => ({
            ...it,
            id: uid(),
            boardId: state.activeBoardId!,
            updatedAt: now,
            order: 0
          }))
          dispatchAction({ type: 'add-items', items: stamped, at: now })
          setSelectedIds(new Set(stamped.map((it) => it.id)))
          setFeedbackBanner({
            kind: 'success',
            message: `Restored ${stamped.length} item${stamped.length === 1 ? '' : 's'} from "${parsed.name}"`
          })
        } catch (e) {
          const message =
            e instanceof BoardBackupError
              ? e.message
              : e instanceof Error
                ? `Failed to restore: ${e.message}`
                : 'Failed to restore backup'
          setFeedbackBanner({ kind: 'error', message })
        }
      }
      reader.onerror = () => {
        input.remove()
        setFeedbackBanner({ kind: 'error', message: 'Could not read the selected file' })
      }
      reader.readAsText(file)
    }
    document.body.appendChild(input)
    input.click()
  }, [state.activeBoardId, dispatchAction])

  // ── Visual export (Phase 4) ─────────────────────────────────────
  //
  // Selection-aware area: if the user has any items selected, export
  // the bbox union of the selection (padded). Otherwise fall back to
  // the visible viewport in world coordinates. Both paths feed the
  // same `buildExportSvg` so the SVG output is byte-identical apart
  // from the rect / mode label.
  //
  // SVG exports the document string directly. PNG rasterizes through
  // a `<canvas>` (no choice — that's where `toBlob('image/png')`
  // lives). Both share the same Blob+anchor download dance as Backup.
  //
  // Errors surface in the same `feedbackBanner` row as Backup/Restore
  // so the user gets one consistent notification surface.

  const exportBoard = useCallback(
    async (kind: 'svg' | 'png') => {
      if (!state.activeBoardId) return
      const board = state.boards.find((b) => b.id === state.activeBoardId)
      if (!board) return
      const items = itemsArray.filter((it) => it.boardId === state.activeBoardId)
      // Selection bbox if anything's selected; otherwise the visible
      // viewport in world coords. `selectionRect` returns null when
      // nothing matches the active board (defensive — `selectedIds`
      // may contain stale ids from a different board).
      let rect =
        selectedIds.size > 0 ? selectionRect(items, selectedIds, state.activeBoardId) : null
      if (!rect) {
        const surfaceRect = surfaceRef.current?.getBoundingClientRect()
        if (!surfaceRect) {
          setFeedbackBanner({ kind: 'error', message: 'Could not measure canvas surface' })
          return
        }
        rect = viewportRect(surfaceRect, pan, zoom)
      }
      const layout: ExportLayout = {
        board: { name: board.name, createdAt: board.createdAt },
        rect,
        items,
        itemsById: state.items,
        mode: selectedIds.size > 0 ? 'selection' : 'viewport'
      }
      const svg = buildExportSvg(layout)
      const filename = buildExportFilename(board, kind)
      try {
        const blob =
          kind === 'svg'
            ? new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
            : await rasterizeSvgToPng(svg)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 0)
        const fmt = kind.toUpperCase()
        const area =
          layout.mode === 'selection'
            ? `${items.filter((it) => selectedIds.has(it.id)).length} selected item${selectedIds.size === 1 ? '' : 's'}`
            : 'visible viewport'
        setFeedbackBanner({
          kind: 'success',
          message: `Exported ${area} of "${board.name}" as ${fmt}`
        })
      } catch (e) {
        const message =
          e instanceof Error
            ? `Failed to export ${kind.toUpperCase()}: ${e.message}`
            : 'Failed to export'
        setFeedbackBanner({ kind: 'error', message })
      }
    },
    [state.activeBoardId, state.boards, state.items, itemsArray, selectedIds, surfaceRef, pan, zoom]
  )

  const handleExportSvg = useCallback(() => {
    void exportBoard('svg')
  }, [exportBoard])

  const handleExportPng = useCallback(() => {
    void exportBoard('png')
  }, [exportBoard])

  // Auto-dismiss the banner after 4s. Cleared on unmount + when a new
  // banner replaces it (the effect re-arms for each `feedbackBanner`
  // identity change).
  useEffect(() => {
    if (!feedbackBanner) return
    const t = setTimeout(() => setFeedbackBanner(null), 4000)
    return () => clearTimeout(t)
  }, [feedbackBanner])

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
        selectedTool={selectedTool}
        onSelectTool={setSelectedTool}
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
        onOpenTemplates={() => setTemplatesOpen(true)}
        canBackup={state.activeBoardId !== null}
        canRestore={state.activeBoardId !== null}
        onBackup={handleBackup}
        onRestore={handleRestore}
        canExport={state.activeBoardId !== null}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        invite={room.invite}
        role={room.role}
        peers={room.peers}
      />
      {feedbackBanner && (
        <div
          role='status'
          className={
            feedbackBanner.kind === 'success'
              ? 'flex items-center justify-center border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800'
              : 'flex items-center justify-center border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800'
          }
        >
          <span>{feedbackBanner.message}</span>
          <button
            type='button'
            onClick={() => setFeedbackBanner(null)}
            aria-label='Dismiss'
            className='ml-3 rounded-md px-2 py-0.5 text-xs font-medium hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            ×
          </button>
        </div>
      )}
      <div className='relative flex flex-1 flex-row overflow-hidden'>
        <AnimatePresence>
          {showAiChat && (
            <SlideInPanel
              key='ai-chat'
              onClose={() => setShowAiChat(false)}
              side='left'
              title='AI Assistant'
            >
              <AIChatTab />
            </SlideInPanel>
          )}
          {showTeamChat && (
            <SlideInPanel
              key='team-chat'
              onClose={() => setShowTeamChat(false)}
              side='left'
              title='Team Chat'
            >
              <GroupChatPanel
                invite={room.invite}
                peers={room.peers}
                messages={room.chat}
                role={room.role}
                writable={room.writable}
                me={room.me}
                onSendChat={room.sendChat}
                onRemoveChat={(id) => room.removeChats([id])}
                onClearChat={room.clearChat}
                onCopyInvite={() => {
                  if (!room.invite) return
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(room.invite).catch(() => {})
                  }
                }}
              />
            </SlideInPanel>
          )}
        </AnimatePresence>
        <main
          ref={surfaceRef}
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerLeave={handleSurfacePointerLeave}
          onContextMenu={(e) => e.preventDefault()}
          data-active-board-id={state.activeBoardId ?? ''}
          className='canvas-grid relative flex-1 select-none overflow-hidden'
          style={{
            cursor: selectedTool === 'connector' ? 'crosshair' : isPanning ? 'grabbing' : 'grab',
            touchAction: 'none'
          }}
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
            <CanvasOverlay
              showPorts={selectedTool === 'connector'}
              hoverShape={hoverShapeId ? (itemsById[hoverShapeId] ?? null) : null}
              zoom={zoom}
              draft={draft}
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
        {selectedIds.size > 0 && (
          <PropertiesDrawer
            selectedItem={singleSelected}
            selectedCount={selectedIds.size}
            selectedIds={Array.from(selectedIds)}
            itemsById={itemsById}
            onUpdate={handleUpdate}
            onTransientUpdate={handleTransientUpdate}
            onBringToFront={handleBringToFront}
            onSendToBack={handleSendToBack}
          />
        )}
      </div>
      <CanvasFooter />

      {/* ── Floating chat buttons (stacked on left) ─────────────── */}
      {!showAiChat && !showTeamChat && (
        <div className='fixed bottom-12 left-4 z-30 flex flex-col gap-2'>
          <FloatingChatButton onClick={() => setShowTeamChat(true)} label='Team Chat'>
            <svg
              className='h-5 w-5'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
            >
              <path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
            </svg>
          </FloatingChatButton>
          <FloatingChatButton onClick={() => setShowAiChat(true)} label='AI Assistant'>
            <svg
              className='h-5 w-5'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <rect x='3' y='11' width='18' height='10' rx='2' />
              <circle cx='12' cy='5' r='2' />
              <path d='M12 7v4' />
              <line x1='8' y1='16' x2='8' y2='16' />
              <line x1='16' y1='16' x2='16' y2='16' />
            </svg>
          </FloatingChatButton>
        </div>
      )}

      <TemplatesModal
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onInsert={handleInsertTemplate}
      />
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
