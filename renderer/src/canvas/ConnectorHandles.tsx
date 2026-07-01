// Two endpoint handles drawn on a selected line/arrow. Each handle is
// a small white circle with a tamarind-500 stroke (vector-effect
// non-scaling so it stays 5px regardless of zoom). Dragging a handle
// repositions the corresponding endpoint; if the cursor is within the
// snap radius of any shape's port, the endpoint snaps to that port
// (`kind: 'attached'`) so the line/arrow tracks the host as it moves.
//
// Snap rules:
//   • Snap radius is screen-scaled: 30px on screen / zoom world units.
//   • Self-snapping is allowed (you can drag a connector's end from
//     one port of its host to another).
//   • A 5px world "deadband" separates `attached` from `free`: while
//     the gesture is in progress, the endpoint stays attached to its
//     original port until the cursor moves more than 5 world units
//     from that port. Past the deadband, the snap resolver takes over.
//   • On pointerup, if no port was in range, the endpoint commits as
//     `kind: 'free'` at the cursor's world coords; otherwise it
//     commits as `kind: 'attached'` to the snapped port.
//
// Live updates dispatch transient `update-item` (skip the history
// stack — dragging is one gesture, one undo step). The final commit
// is non-transient.

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { BoardScopedItem, ConnectorEnd, Port } from './types'
import { SELECT_STROKE, getPortWorld, isConnector, resolveEnd } from './types'

interface ConnectorHandlesProps {
  item: BoardScopedItem
  zoom: number
  // Surface rect for converting client coords → world coords. Pass
  // the canvas `<main>` element via `getBoundingClientRect()`.
  surfaceRect: DOMRect
  itemsById: Record<string, BoardScopedItem>
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
}

const HANDLE_RADIUS = 5
const SNAP_RADIUS_PX = 30
const DETACH_DEADBAND_PX = 5

export function ConnectorHandles({
  item,
  zoom,
  surfaceRect,
  itemsById,
  onUpdate,
  onTransientUpdate
}: ConnectorHandlesProps) {
  if (!isConnector(item.type) || !item.start || !item.end) return null

  const s = resolveEnd(item.start, itemsById)
  const e = resolveEnd(item.end, itemsById)
  return (
    <g>
      <EndpointHandle
        role='start'
        position={s}
        item={item}
        zoom={zoom}
        surfaceRect={surfaceRect}
        itemsById={itemsById}
        onUpdate={onUpdate}
        onTransientUpdate={onTransientUpdate}
      />
      <EndpointHandle
        role='end'
        position={e}
        item={item}
        zoom={zoom}
        surfaceRect={surfaceRect}
        itemsById={itemsById}
        onUpdate={onUpdate}
        onTransientUpdate={onTransientUpdate}
      />
    </g>
  )
}

function EndpointHandle({
  role,
  position,
  item,
  zoom,
  surfaceRect,
  itemsById,
  onUpdate,
  onTransientUpdate
}: {
  role: 'start' | 'end'
  position: { x: number; y: number }
  item: BoardScopedItem
  zoom: number
  surfaceRect: DOMRect
  itemsById: Record<string, BoardScopedItem>
  onUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
  onTransientUpdate: (id: string, patch: Partial<BoardScopedItem>) => void
}) {
  // While dragging, we keep the original `attached` port so we can
  // apply the deadband rule. Cleared on pointerup.
  const originalAttached = useRef<{ itemId: string; port: Port } | null>(
    item[role]?.kind === 'attached'
      ? {
          itemId: item[role]!.itemId,
          port: (item[role] as { kind: 'attached'; itemId: string; port: Port }).port
        }
      : null
  )
  // Visual cue: filled in green when the cursor is over a snap port.
  const [hoverSnap, setHoverSnap] = useState<{ itemId: string; port: Port } | null>(null)
  // Local drag position in world coords (overrides `position` when
  // set). The snap resolver runs on every pointermove to update
  // `hoverSnap` and patch the endpoint transiently.
  const dragWorld = useRef<{ x: number; y: number } | null>(null)

  function handlePointerDown(e: ReactPointerEvent<SVGCircleElement>) {
    if (e.button !== 0) return
    // Stop the underlying shape's drag from also firing.
    e.stopPropagation()
    e.preventDefault()
    // Capture the initial cursor in world coords and the original
    // attached port (for deadband).
    const initialWorld = clientToWorld(e.clientX, e.clientY, surfaceRect, zoom)
    dragWorld.current = initialWorld

    function onMove(ev: PointerEvent) {
      const w = clientToWorld(ev.clientX, ev.clientY, surfaceRect, zoom)
      dragWorld.current = w
      // Deadband: if the endpoint started attached, stay attached
      // until the cursor moves DETACH_DEADBAND_PX world units away
      // from the original port.
      const original = originalAttached.current
      if (original) {
        const port = getPortWorld(itemsById[original.itemId] ?? item, original.port)
        const ddx = w.x - port.x
        const ddy = w.y - port.y
        const distWorld = Math.hypot(ddx, ddy)
        if (distWorld * zoom < DETACH_DEADBAND_PX) {
          // Still inside deadband — keep the original attached port.
          setHoverSnap(null)
          return
        }
      }
      // Snap search.
      const snap = findNearestPort(w, item.id, itemsById, SNAP_RADIUS_PX / zoom)
      if (snap) {
        setHoverSnap(snap)
        const nextEnd: ConnectorEnd = { kind: 'attached', itemId: snap.itemId, port: snap.port }
        const patch = role === 'start' ? { start: nextEnd } : { end: nextEnd }
        onTransientUpdate(item.id, patch)
      } else {
        setHoverSnap(null)
        // No snap — show as free at the cursor's world coords.
        const nextEnd: ConnectorEnd = { kind: 'free', x: w.x, y: w.y }
        const patch = role === 'start' ? { start: nextEnd } : { end: nextEnd }
        onTransientUpdate(item.id, patch)
      }
    }

    function onUp(ev: PointerEvent) {
      const finalWorld = clientToWorld(ev.clientX, ev.clientY, surfaceRect, zoom)
      // Final snap or free commit.
      const original = originalAttached.current
      let finalEnd: ConnectorEnd
      if (original) {
        const port = getPortWorld(itemsById[original.itemId] ?? item, original.port)
        const ddx = finalWorld.x - port.x
        const ddy = finalWorld.y - port.y
        const distWorld = Math.hypot(ddx, ddy)
        if (distWorld * zoom < DETACH_DEADBAND_PX) {
          // Released inside the deadband — keep original attached.
          finalEnd = item[role] as ConnectorEnd
        } else {
          const snap = findNearestPort(finalWorld, item.id, itemsById, SNAP_RADIUS_PX / zoom)
          if (snap) {
            finalEnd = { kind: 'attached', itemId: snap.itemId, port: snap.port }
          } else {
            finalEnd = { kind: 'free', x: finalWorld.x, y: finalWorld.y }
          }
        }
      } else {
        const snap = findNearestPort(finalWorld, item.id, itemsById, SNAP_RADIUS_PX / zoom)
        if (snap) {
          finalEnd = { kind: 'attached', itemId: snap.itemId, port: snap.port }
        } else {
          finalEnd = { kind: 'free', x: finalWorld.x, y: finalWorld.y }
        }
      }
      const patch = role === 'start' ? { start: finalEnd } : { end: finalEnd }
      onUpdate(item.id, patch)
      // Reset.
      dragWorld.current = null
      setHoverSnap(null)
      originalAttached.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // The drag-world position overrides the static `position` while
  // dragging so the handle tracks the cursor.
  const drawX = dragWorld.current?.x ?? position.x
  const drawY = dragWorld.current?.y ?? position.y
  return (
    <circle
      cx={drawX}
      cy={drawY}
      r={HANDLE_RADIUS / zoom}
      fill={hoverSnap ? SELECT_STROKE : 'white'}
      stroke={SELECT_STROKE}
      strokeWidth={1.5}
      vectorEffect='non-scaling-stroke'
      style={{ cursor: 'crosshair' }}
      onPointerDown={handlePointerDown}
    />
  )
}

// Convert viewport pixel coordinates to world coordinates. The
// surface's `getBoundingClientRect` gives the canvas origin; the
// world transform is `translate(pan) scale(zoom)` so
//   world = (client - surface.origin - pan) / zoom.
// Pan is unknown here, so we treat surface origin as world (0, 0).
// (Marquee uses the same convention.)
function clientToWorld(
  clientX: number,
  clientY: number,
  surfaceRect: DOMRect,
  zoom: number
): { x: number; y: number } {
  return {
    x: (clientX - surfaceRect.left) / zoom,
    y: (clientY - surfaceRect.top) / zoom
  }
}

// Find the nearest snap port within `radiusWorld` of `cursor`. Excludes
// the connector itself; every other shape's five ports are candidates.
function findNearestPort(
  cursor: { x: number; y: number },
  selfId: string,
  itemsById: Record<string, BoardScopedItem>,
  radiusWorld: number
): { itemId: string; port: Port } | null {
  let best: { itemId: string; port: Port; d: number } | null = null
  for (const item of Object.values(itemsById)) {
    if (item.id === selfId) continue
    if (item.type === 'line' || item.type === 'arrow') continue
    if (item.w === undefined || item.h === undefined) continue
    for (const port of ['top', 'right', 'bottom', 'left', 'center'] as Port[]) {
      const p = getPortWorld(item, port)
      const d = Math.hypot(p.x - cursor.x, p.y - cursor.y)
      if (d <= radiusWorld && (best === null || d < best.d)) {
        best = { itemId: item.id, port, d }
      }
    }
  }
  if (!best) return null
  return { itemId: best.itemId, port: best.port }
}
