// Top toolbar for the canvas. Five groups, left to right:
//   • Zoom controls  — wheel-zoom presets anchored at cursor centre
//   • Shape palette  — rect, ellipse, line, arrow (rect/ellipse
//                      accept an optional text caption via double-click
//                      on the shape body)
//   • Selection ops  — bring to front, send to back, delete
//   • History        — undo / redo (real buttons; phase 1+ short-lived)
//   • Clipboard hint — keyboard shortcuts shown in tooltips

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Circle,
  Minus,
  Redo2,
  Square,
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
  canUndo: boolean
  canRedo: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onAddShape: (type: GenericShapeType) => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  onBringToFront: () => void
  onSendToBack: () => void
}

const SHORTCUT_HINT = 'Cmd/Ctrl+Z to undo · Cmd/Ctrl+Shift+Z to redo · Cmd/Ctrl+A to select all'

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
  canUndo,
  canRedo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onAddShape,
  onDelete,
  onUndo,
  onRedo,
  onBringToFront,
  onSendToBack
}: CanvasToolbarProps) {
  return (
    <header
      title={SHORTCUT_HINT}
      className='relative flex h-12 w-full items-center justify-center border-b border-gray-200 bg-gray-100 px-4'
    >
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

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* Z-order group */}
        <IconButton
          label='Bring selected to front (top of stack)'
          onClick={onBringToFront}
          disabled={!hasSelection}
        >
          <ChevronUp className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <IconButton
          label='Send selected to back (bottom of stack)'
          onClick={onSendToBack}
          disabled={!hasSelection}
        >
          <ChevronDown className='h-4 w-4' aria-hidden='true' />
        </IconButton>

        {/* Delete */}
        <IconButton label='Delete selected' onClick={onDelete} disabled={!hasSelection}>
          <Trash2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* History group */}
        <IconButton
          label={`Undo (Cmd/Ctrl+Z)${canUndo ? '' : ' — nothing to undo'}`}
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <IconButton
          label={`Redo (Cmd/Ctrl+Shift+Z)${canRedo ? '' : ' — nothing to redo'}`}
          onClick={onRedo}
          disabled={!canRedo}
        >
          <Redo2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>
      </div>
    </header>
  )
}
