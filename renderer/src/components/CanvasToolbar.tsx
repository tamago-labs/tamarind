// Top toolbar for the canvas. Five groups, left to right:
//   • Board file ops  — boards menu, backup, restore, export
//   • View            — zoom out / percentage / zoom in
//   • Tools           — marquee, shape palette, templates
//   • Selection       — delete
//   • History         — undo / redo
//   • Invite          — invite button with popover
//
// Bring-to-front / send-to-back live in the right-side PropertiesDrawer
// alongside the rest of the per-selection actions, where they belong
// with text labels rather than glyphs that read as "up/down arrows".

import { useEffect, useRef, useState } from 'react'
import {
  BookText,
  Check,
  Circle,
  Copy,
  Download,
  MousePointerSquareDashed,
  Redo2,
  Spline,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Upload,
  UserPlus,
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
  // Invite / room props
  invite: string | null
  role: string | null
  peers: number
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
  onExportPng,
  invite,
  role,
  peers
}: CanvasToolbarProps) {
  const [showInvite, setShowInvite] = useState(false)
  const [copied, setCopied] = useState(false)
  const inviteRef = useRef<HTMLDivElement>(null)

  // Close the invite popover on outside click / Escape.
  useEffect(() => {
    if (!showInvite) return
    function onDocPointerDown(e: PointerEvent) {
      const el = inviteRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) setShowInvite(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowInvite(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [showInvite])

  function handleCopyInvite() {
    if (!invite) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(invite).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
    }
  }

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
          <Download className='h-4 w-4' aria-hidden='true' />
        </IconButton>
        <IconButton label='Restore board from file' onClick={onRestore} disabled={!canRestore}>
          <Upload className='h-4 w-4' aria-hidden='true' />
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
        <ShapeButton label='Add sticky note' onClick={() => onAddShape('note')}>
          <StickyNote className='h-4 w-4' aria-hidden='true' />
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
          <BookText className='h-4 w-4' aria-hidden='true' />
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

        {/* ── Invite button + popover ────────────────────────────── */}
        <div className='mx-2 h-5 w-px bg-gray-300' aria-hidden='true' />
        <div ref={inviteRef} className='relative'>
          <button
            type='button'
            onClick={() => setShowInvite((v) => !v)}
            aria-label='Invite peers'
            title='Invite peers'
            className='inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500'
          >
            <UserPlus className='h-3.5 w-3.5' aria-hidden='true' />
            Invite
          </button>
          {showInvite && (
            <div className='absolute right-0 top-full z-50 mt-2 w-72 rounded-md border border-gray-200 bg-white shadow-md'>
              <div className='p-3'>
                <div className='space-y-2'>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-gray-500'>Role</span>
                    <span className='font-medium text-gray-800 capitalize'>
                      {role ?? 'Connecting…'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between text-xs'>
                    <span className='text-gray-500'>Peers</span>
                    <span className='font-medium text-gray-800'>{peers} connected</span>
                  </div>
                  {invite && role === 'host' && (
                    <div className='pt-1'>
                      <div className='flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5'>
                        <code className='min-w-0 flex-1 truncate font-mono text-xs text-gray-800'>
                          {invite}
                        </code>
                        <button
                          type='button'
                          onClick={handleCopyInvite}
                          aria-label='Copy invite code'
                          className='shrink-0 rounded p-0.5 text-gray-500 transition hover:bg-gray-200 hover:text-gray-700'
                        >
                          {copied ? (
                            <Check className='h-3.5 w-3.5 text-green-600' />
                          ) : (
                            <Copy className='h-3.5 w-3.5' />
                          )}
                        </button>
                      </div>
                      <p className='mt-1.5 text-[10px] text-gray-500'>
                        Share this code so peers can join the board.
                      </p>
                    </div>
                  )}
                  {role === 'guest' && (
                    <p className='pt-1 text-[10px] text-gray-500'>
                      You joined using a host-shared code.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
