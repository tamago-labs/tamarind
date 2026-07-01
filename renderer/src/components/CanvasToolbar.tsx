// Top toolbar for the canvas. Four groups, left to right:
//   • Zoom controls  — wheel-zoom presets anchored at cursor centre
//   • Shape palette  — rect, ellipse, line, arrow, note
//   • Selection ops  — delete (disabled when nothing selected)
//   • History        — undo / redo (disabled this pass)
//
// Shape buttons insert an item at a pan-invariant stacking offset via
// `onAddShape` from the parent (Phase 1 dispatch; Phase 3 IPC).

import {
  ArrowRight,
  Circle,
  Minus,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { GenericShapeType } from '../canvas/types'

interface CanvasToolbarProps {
  zoom: number
  canZoomIn: boolean
  canZoomOut: boolean
  hasSelection: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onAddShape: (type: GenericShapeType) => void
  onDelete: () => void
}

const COMING_SOON = 'Coming in Sprint 1'

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className='inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent'
    >
      {children}
    </button>
  )
}

function ShapeButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className='inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-200'
    >
      {children}
    </button>
  )
}

function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export function CanvasToolbar({
  zoom,
  canZoomIn,
  canZoomOut,
  hasSelection,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onAddShape,
  onDelete
}: CanvasToolbarProps) {
  return (
    <header className='relative flex h-12 w-full items-center justify-center border-b border-gray-200 bg-gray-100 px-4'>
      <div className='flex items-center gap-1'>
        {/* Zoom group */}
        <IconButton label='Zoom out' onClick={onZoomOut} disabled={!canZoomOut}>
          <ZoomOut className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <button
          type='button'
          onClick={onResetZoom}
          aria-label='Reset zoom to 100%'
          title='Reset zoom to 100%'
          className='inline-flex h-8 min-w-14 items-center justify-center rounded-md px-2 text-xs font-semibold tabular-nums text-gray-800 transition hover:bg-gray-200'
        >
          {formatZoom(zoom)}
        </button>
        <IconButton label='Zoom in' onClick={onZoomIn} disabled={!canZoomIn}>
          <ZoomIn className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* Shape group */}
        <ShapeButton label='Add rectangle' onClick={() => onAddShape('rect')}>
          <Square className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add ellipse' onClick={() => onAddShape('ellipse')}>
          <Circle className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add line' onClick={() => onAddShape('line')}>
          <Minus className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add arrow' onClick={() => onAddShape('arrow')}>
          <ArrowRight className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add note' onClick={() => onAddShape('note')}>
          <StickyNote className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* Selection group */}
        <IconButton label='Delete selected' onClick={onDelete} disabled={!hasSelection}>
          <Trash2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* History group */}
        <IconButton label={`Undo (${COMING_SOON})`} disabled>
          <Undo2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <IconButton label={`Redo (${COMING_SOON})`} disabled>
          <Redo2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>
      </div>
    </header>
  )
}
