// Marquee selector. Lives as a transparent overlay above the canvas
// surface; capture-phase `pointerdown` handler takes over when the
// marquee is armed (`enabled` prop) and the user clicks an empty area,
// drawing a dashed rectangle and converting it to a selection on release.
//
// The overlay is `pointer-events: none` by default so the surface pan
// (and shape drag) keep working. We add a capture-phase pointerdown
// listener at the window level that fires for *every* pointerdown and
// decides based on `enabled` (or the legacy `e.shiftKey` shortcut)
// whether to claim the gesture. If the marquee is armed and the user
// clicked the surface (or the SVG background), we stopPropagation so
// the surface pan bails out and we install our own window-level
// move/up listeners. Plain clicks fall through untouched.
//
// Selection rule: marquee *replaces* the current selection. Shift-
// marquee isn't a thing in this iteration; shift remains the legacy
// shortcut (kept for muscle-memory users) and `enabled` is the primary
// path via the toolbar momentary button. The user can re-add the prior
// selection with shift-click on each missed item.

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BoardScopedItem } from './types'
import { aabbIntersects, computeBoundingBox } from './types'

interface MarqueeProps {
  surfaceRef: React.RefObject<HTMLDivElement | null>
  zoom: number
  items: BoardScopedItem[]
  itemsById: Record<string, BoardScopedItem>
  enabled: boolean
  onCommit: (ids: string[]) => void
}

export function Marquee({ surfaceRef, zoom, items, itemsById, enabled, onCommit }: MarqueeProps) {
  // Rect in viewport coordinates. Only set while a marquee is being
  // drawn; the JSX renders nothing when null.
  const [rect, setRect] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const dragRef = useRef<{ x0: number; y0: number } | null>(null)

  useEffect(() => {
    const surfaceEl = surfaceRef.current
    if (!surfaceEl) return
    const surface: HTMLDivElement = surfaceEl

    function onPointerDown(e: PointerEvent) {
      // Marquee arms via two paths: the toolbar momentary button
      // (`enabled`) or the legacy shift-held shortcut. Either arms
      // the gesture for this pointerdown.
      if (!enabled && !e.shiftKey) return
      if (e.button !== 0) return
      const target = e.target as Node | null
      // If the click hit a shape (or any element inside the SVG that
      // isn't the bare surface), let the shape handle the gesture.
      if (!target || !surface.contains(target)) return
      // Only start a marquee when the click hit the surface itself or
      // the SVG background — not a shape.
      const isSurface = target === surface
      const isSvg = target instanceof SVGSVGElement
      if (!isSurface && !isSvg) return
      e.stopPropagation()
      e.preventDefault()
      dragRef.current = { x0: e.clientX, y0: e.clientY }
      setRect({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY })

      function onMove(ev: PointerEvent) {
        if (!dragRef.current) return
        setRect({
          x0: dragRef.current.x0,
          y0: dragRef.current.y0,
          x1: ev.clientX,
          y1: ev.clientY
        })
      }

      function onUp() {
        const final = dragRef.current
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (!final) {
          setRect(null)
          return
        }
        const start = { x: final.x0, y: final.y0 }
        // Read the live rect from the latest move and compute the
        // hit-test in one pass.
        setRect((current) => {
          if (!current) {
            onCommit([])
            return null
          }
          const ids = computeMarqueeHits(
            start,
            { x: current.x1, y: current.y1 },
            surface,
            zoom,
            items,
            itemsById
          )
          onCommit(ids)
          return null
        })
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    // Capture phase so we run before the surface pan listener. The
    // surface pan already bails on shift, but capturing ensures the
    // surface's own stopPropagation doesn't beat us to the punch.
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [surfaceRef, zoom, items, itemsById, enabled, onCommit])

  if (!rect) return null
  const x = Math.min(rect.x0, rect.x1)
  const y = Math.min(rect.y0, rect.y1)
  const w = Math.abs(rect.x1 - rect.x0)
  const h = Math.abs(rect.y1 - rect.y0)
  const style: CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    width: w,
    height: h,
    border: '1px dashed #3b82f6',
    background: 'rgba(59,130,246,0.08)',
    pointerEvents: 'none',
    zIndex: 50
  }
  return <div style={style} aria-hidden='true' />
}

// Convert a viewport-pixel rect (from the marquee) into a world-space
// AABB and test every visible item. Returns the ids of items whose
// bbox intersects the marquee. The surface's `getBoundingClientRect`
// gives the canvas origin; the world transform is `translate(pan)
// scale(zoom)` so world = (viewport - surface.origin - pan) / zoom.
function computeMarqueeHits(
  start: { x: number; y: number },
  end: { x: number; y: number },
  surface: HTMLDivElement,
  zoom: number,
  items: BoardScopedItem[],
  itemsById: Record<string, BoardScopedItem>
): string[] {
  const rect = surface.getBoundingClientRect()
  const minVx = Math.min(start.x, end.x) - rect.left
  const minVy = Math.min(start.y, end.y) - rect.top
  const maxVx = Math.max(start.x, end.x) - rect.left
  const maxVy = Math.max(start.y, end.y) - rect.top
  // World rect — no pan offset in the visible items, since the pan
  // lives on the transform and our world coords are in the un-panned
  // space. (We treat surface origin as (0, 0) for the world.)
  const world: { x: number; y: number; w: number; h: number } = {
    x: minVx / zoom,
    y: minVy / zoom,
    w: (maxVx - minVx) / zoom,
    h: (maxVy - minVy) / zoom
  }
  const hits: string[] = []
  for (const item of items) {
    const b = computeBoundingBox(item, itemsById)
    if (aabbIntersects(b, world)) hits.push(item.id)
  }
  return hits
}
