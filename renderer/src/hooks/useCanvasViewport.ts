import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 4
export const ZOOM_STEP = 0.25
const WHEEL_SENSITIVITY = 0.0015

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
}

export function useCanvasViewport() {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const panStart = useRef({ panX: 0, panY: 0, mouseX: 0, mouseY: 0 })

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => clampZoom(z + delta))
  }, [])

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const onSurfacePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Shape children call stopPropagation on pointerdown (see
      // DraggableShape.handlePointerDown), so this handler only fires
      // for clicks on the bare surface area. We deliberately don't
      // check `e.target !== e.currentTarget` because the world SVG
      // (CanvasItems) always sits between the cursor and <main>,
      // making that check reject every empty-area click.
      // Shift+drag is owned by the marquee overlay — bail before the pan
      // gets a chance to fire. The marquee listens at capture phase and
      // stopPropagation prevents the pan from ever seeing the gesture.
      if (e.shiftKey) return
      // Left (0), middle (1), and right (2) button all start a pan — any
      // mouse button held + drag moves the canvas. The context menu is
      // suppressed separately on <main> so right-click doesn't pop it up.
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
      e.preventDefault()
      panStart.current = {
        panX: pan.x,
        panY: pan.y,
        mouseX: e.clientX,
        mouseY: e.clientY
      }
      setIsPanning(true)
    },
    [pan.x, pan.y]
  )

  // Wheel zoom — must be a native passive:false listener so we can
  // preventDefault and stop the page from scrolling. Zoom is anchored
  // at the cursor: the world point under the mouse stays under the
  // mouse after the zoom change.
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      const rect = surface!.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      const worldX = (cursorX - pan.x) / zoom
      const worldY = (cursorY - pan.y) / zoom
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY)
      const newZoom = clampZoom(zoom * factor)
      setPan({
        x: cursorX - worldX * newZoom,
        y: cursorY - worldY * newZoom
      })
      setZoom(newZoom)
    }

    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [pan, zoom])

  // Pan: window-level pointermove/pointerup so the drag continues even when
  // the cursor leaves the canvas surface, and works for touch + pen. We use
  // pointer events to match the surface-level `onPointerDown` and the shape
  // drag handlers — keeping every interaction in one event family prevents
  // the "drag a shape, everything pans too" bug.
  useEffect(() => {
    if (!isPanning) return
    function onMove(e: PointerEvent) {
      setPan({
        x: panStart.current.panX + (e.clientX - panStart.current.mouseX),
        y: panStart.current.panY + (e.clientY - panStart.current.mouseY)
      })
    }
    function endPan() {
      setIsPanning(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', endPan)
    window.addEventListener('pointercancel', endPan)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', endPan)
      window.removeEventListener('pointercancel', endPan)
    }
  }, [isPanning])

  const worldTransform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`

  return {
    zoom,
    pan,
    isPanning,
    surfaceRef,
    worldTransform,
    onSurfacePointerDown,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(-ZOOM_STEP),
    resetView,
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN
  }
}
