import { motion } from 'framer-motion'
import { useCanvasViewport } from '../hooks/useCanvasViewport'
import { CanvasContent } from './CanvasContent'
import { CanvasFooter } from './CanvasFooter'
import { CanvasToolbar } from './CanvasToolbar'

export function CanvasPage() {
  const {
    zoom,
    isPanning,
    surfaceRef,
    worldTransform,
    onSurfaceMouseDown,
    zoomIn,
    zoomOut,
    resetView,
    canZoomIn,
    canZoomOut
  } = useCanvasViewport()

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
      />
      <main
        ref={surfaceRef}
        onMouseDown={onSurfaceMouseDown}
        onContextMenu={(e) => e.preventDefault()}
        className='canvas-grid relative flex-1 select-none overflow-hidden'
        style={{ cursor: isPanning ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <div className='absolute inset-0 origin-top-left' style={{ transform: worldTransform }}>
          <CanvasContent />
        </div>
      </main>
      <CanvasFooter />
    </motion.div>
  )
}
