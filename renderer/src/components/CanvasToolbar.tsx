// Top toolbar for the canvas. Five groups, left to right:
//   • Board file ops  — boards menu, backup, restore, export
//   • View            — zoom out / percentage / zoom in
//   • Tools           — marquee, shape palette, templates
//   • Selection       — delete
//   • History         — undo / redo
//
// Bring-to-front / send-to-back live in the right-side PropertiesDrawer
// alongside the rest of the per-selection actions, where they belong
// with text labels rather than glyphs that read as "up/down arrows".

import {
  Circle,
  FolderOpen,
  LayoutTemplate,
  MousePointerSquareDashed,
  Redo2,
  Save,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import type { Board, GenericShapeType } from '../canvas/types'
import { BoardsMenu } from './BoardsMenu'
import { ExportMenu } from './ExportMenu'

// Phase 3 tool state. The connector uses a different interaction model
// (click + drag to draw with snap) so it lives in its own state slot
// separate from the "instant add" tools that just spawn-at-position.
export type ConnectorTool = 'connector'
export type SelectedTool = ConnectorTool | null

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
  // Phase 3: connector uses a drag-to-create flow with snap-to-port
  // rather than spawning a 200-unit line at the cursor. The toolbar
  // tells the page to enter that mode; the page owns the pointer
  // handlers. `null` clears the mode.
  selectedTool: SelectedTool
  onSelectTool: (tool: SelectedTool) => void
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
  // Backup writes the active board to a Tamarind board file (kind:
  // 'tamarind-board', v1) and triggers a download via the renderer's
  // Blob/anchor dance — see `CanvasPage.handleBackup`. Restore opens
  // a file picker, parses the backup, and dispatches `add-items` for
  // the recovered shapes onto the active board.
  canBackup: boolean
  canRestore: boolean
  onBackup: () => void
  onRestore: () => void
  // Phase 4: visual export (SVG / PNG). Same gating as Backup/Restore
  // — disabled until there's an active board to render. `onExportSvg`
  // produces a `.svg` file via the same Blob+anchor dance as Backup;
  // `onExportPng` rasterizes via `<canvas>` first.
  // `hasSelection` is shared with the Delete button above — same
  // source of truth (selectedIds.size > 0).
  canExport: boolean
  onExportSvg: () => void
  onExportPng: () => void
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
  children,
  active
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  // When true, the button is styled as the currently-selected tool
  // (blue background + blue text) so the user has a visual confirmation
  // that the toolbar is in a non-default mode. Used by the connector
  // button to indicate "you're in draw mode".
  active?: boolean
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={
        active
          ? 'inline-flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 text-blue-700 transition hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
          : 'inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
      }
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
  selectedTool,
  onSelectTool,
  onDelete,
  onUndo,
  onRedo,
  onMarqueePressStart,
  onMarqueePressEnd,
  onSelectBoard,
  onAddBoard,
  onRenameBoard,
  onDeleteBoard,
  onOpenTemplates,
  canBackup,
  canRestore,
  onBackup,
  onRestore,
  canExport,
  onExportSvg,
  onExportPng
}: CanvasToolbarProps) {
  return (
    <header
      title={SHORTCUT_HINT}
      className='relative flex h-12 w-full items-center justify-start border-b border-gray-200 bg-gray-100 px-4'
    >
      <div className='flex items-center gap-1'>
        {/* ── Board file ops ─────────────────────────────────────── */}
        <BoardsMenu
          boards={boards}
          activeBoardId={activeBoardId}
          onSelect={onSelectBoard}
          onAdd={onAddBoard}
          onRename={onRenameBoard}
          onDelete={onDeleteBoard}
        />
        <IconButton label='Backup board to file' onClick={onBackup} disabled={!canBackup}>
          <Save className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <IconButton label='Restore board from file' onClick={onRestore} disabled={!canRestore}>
          <FolderOpen className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <ExportMenu
          canExport={canExport}
          hasSelection={hasSelection}
          onExportSvg={onExportSvg}
          onExportPng={onExportPng}
        />
        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* ── Zoom group ─────────────────────────────────────────── */}
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

        {/* ── Tools (marquee + shape palette + templates) ────────── */}
        <MomentaryButton
          label='Marquee select (hold and drag on canvas)'
          active={marqueeActive}
          onPressStart={onMarqueePressStart}
          onPressEnd={onMarqueePressEnd}
        >
          <MousePointerSquareDashed className='h-4 w-4' aria-hidden='true' />
        </MomentaryButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        <ShapeButton label='Add rectangle' onClick={() => onAddShape('rect')}>
          <Square className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add ellipse' onClick={() => onAddShape('ellipse')}>
          <Circle className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton
          label='Add connector'
          active={selectedTool === 'connector'}
          onClick={() => onSelectTool(selectedTool === 'connector' ? null : 'connector')}
        >
          <Spline className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>
        <ShapeButton label='Add text' onClick={() => onAddShape('text')}>
          <Type className='h-4 w-4' aria-hidden='true' />
        </ShapeButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        <IconButton label='Templates' onClick={onOpenTemplates}>
          <LayoutTemplate className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

        {/* ── Selection / History ────────────────────────────────── */}
        <IconButton label='Delete selected' onClick={onDelete} disabled={!hasSelection}>
          <Trash2 className='h-4 w-4' aria-hidden='true' />
        </IconButton>

        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />

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
