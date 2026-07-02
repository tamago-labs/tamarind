// Top toolbar for the canvas. Six groups, left to right:
//   • Boards menu    — switch active board, add, rename, delete
//   • Zoom controls   — wheel-zoom presets anchored at cursor centre
//   • Marquee toggle  — click once to arm, drag empty area to select,
//                       click again (or press Escape) to disarm
//   • Shape palette   — rect, ellipse, line, arrow (rect/ellipse
//                       accept an optional text caption via double-click
//                       on the shape body)
//   • Delete          — trash icon for the current selection
//   • History         — undo / redo
//
// Bring-to-front / send-to-back live in the right-side PropertiesDrawer
// alongside the rest of the per-selection actions, where they belong
// with text labels rather than glyphs that read as "up/down arrows".

import {
  ArrowRight,
  Circle,
  LayoutTemplate,
  MousePointerSquareDashed,
  Minus,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { Board, GenericShapeType } from '../canvas/types'
import { BoardsMenu } from './BoardsMenu'

interface CanvasToolbarProps {
  zoom: number
  canZoomIn: boolean
  canZoomOut: boolean
  hasSelection: boolean
  canUndo: boolean
  canRedo: boolean
  marqueeActive: boolean
  boards: Board[]
  activeBoardId: string | null
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  onAddShape: (type: GenericShapeType) => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  onMarqueePressStart: () => void
  onMarqueePressEnd: () => void
  onSelectBoard: (id: string) => void
  onAddBoard: () => void
  onRenameBoard: (id: string, name: string) => void
  onDeleteBoard: (id: string) => void
  onOpenTemplates: () => void
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

// Toggle button: click once to arm (aria-pressed=true), click again to
// disarm. Pairs with the Marquee overlay — when armed, dragging on the
// canvas draws the selection rect; when disarmed, dragging pans. Mirrors
// how Adobe / Figma handle the marquee tool: the button persists state,
// so the user can draw multiple selections in a row without re-clicking.
function MomentaryButton({
  label,
  active,
  onPressStart,
  onPressEnd,
  children
}: {
  label: string
  active: boolean
  onPressStart: () => void
  onPressEnd: () => void
  children: React.ReactNode
}) {
  function handleClick() {
    // Click while disarmed → arm. Click while armed → disarm. The handlers
    // are wired by CanvasPage to setMarqueeMode(true/false), so toggling
    // is a single dispatch on each click.
    if (active) onPressEnd()
    else onPressStart()
  }
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      className={
        active
          ? 'inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-500 text-white transition'
          : 'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-200'
      }
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
  marqueeActive,
  boards,
  activeBoardId,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onAddShape,
  onDelete,
  onUndo,
  onRedo,
  onMarqueePressStart,
  onMarqueePressEnd,
  onSelectBoard,
  onAddBoard,
  onRenameBoard,
  onDeleteBoard,
  onOpenTemplates
}: CanvasToolbarProps) {
  return (
    <header
      title={SHORTCUT_HINT}
      className='relative flex h-12 w-full items-center justify-center border-b border-gray-200 bg-gray-100 px-4'
    >
      <div className='flex items-center gap-1'>
        {/* Boards menu */}
        <BoardsMenu
          boards={boards}
          activeBoardId={activeBoardId}
          onSelect={onSelectBoard}
          onAdd={onAddBoard}
          onRename={onRenameBoard}
          onDelete={onDeleteBoard}
        />
        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

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

        {/* Marquee selector (momentary) */}
        <MomentaryButton
          label='Marquee select (hold and drag on canvas)'
          active={marqueeActive}
          onPressStart={onMarqueePressStart}
          onPressEnd={onMarqueePressEnd}
        >
          <MousePointerSquareDashed className='h-4 w-4' aria-hidden='true' />
        </MomentaryButton>

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
        <ShapeButton label='Add text' onClick={() => onAddShape('text')}>
          <Type className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* Templates */}
        <ShapeButton label='Templates' onClick={onOpenTemplates}>
          <LayoutTemplate className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

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
