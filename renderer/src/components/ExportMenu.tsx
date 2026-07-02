// Toolbar dropdown for visual export (Phase 4). Renders next to the
// Restore button. Collapses to a single "Export" button that opens a
// popover with two format choices: SVG (vector, lossless, foreignObject
// text) and PNG (raster, 2× scale by default for retina).
//
// Area is decided by the caller — this menu just signals intent. Each
// option's subtitle surfaces whether the export will cover the current
// selection (bbox union) or the visible viewport, so the user can tell
// at a glance what they're about to grab without having to read
// tooltip docs. The "2× scale" hint for PNG echoes the default in
// `rasterizeSvgToPng` — explicit so the file size implication is
// obvious before the rasterization kicks off (SVG export is
// essentially free).

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface ExportMenuProps {
  // Mirrors `canBackup` / `canRestore` — disabled until there's an
  // active board to export. Selecting "Export" without a board would
  // just no-op, but the visual cue prevents the user from clicking a
  // dead button in the first place.
  canExport: boolean
  // Drives the subtitle on each option ("Selected items" vs "Visible
  // viewport"). Caller is the source of truth — if selectedIds.size
  // is 0, callers fall back to viewport regardless of selection state
  // at click time.
  hasSelection: boolean
  onExportSvg: () => void
  onExportPng: () => void
}

export function ExportMenu({ canExport, hasSelection, onExportSvg, onExportPng }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click / Escape so keyboard nav works
  // without leaving the menu trapped open. Same pattern as
  // `BoardsMenu`.
  useEffect(() => {
    if (!open) return
    function onDocPointerDown(e: PointerEvent) {
      const el = containerRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const areaLabel = hasSelection ? 'Selected items' : 'Visible viewport'

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-haspopup='menu'
        aria-expanded={open}
        aria-label='Export visual'
        disabled={!canExport}
        className='inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-700 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500'
      >
        Export
        <ChevronDown className='h-3.5 w-3.5' aria-hidden='true' />
      </button>
      {open && (
        <div
          role='menu'
          aria-label='Export format'
          className='absolute right-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-md border border-gray-200 bg-white shadow-md'
        >
          <button
            type='button'
            role='menuitem'
            onClick={() => {
              onExportSvg()
              setOpen(false)
            }}
            className='block w-full px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-gray-100'
          >
            <div className='font-medium'>Export as SVG</div>
            <div className='mt-0.5 text-[10px] text-gray-500'>{areaLabel}</div>
          </button>
          <button
            type='button'
            role='menuitem'
            onClick={() => {
              onExportPng()
              setOpen(false)
            }}
            className='block w-full border-t border-gray-100 px-3 py-2 text-left text-xs text-gray-700 transition hover:bg-gray-100'
          >
            <div className='font-medium'>Export as PNG</div>
            <div className='mt-0.5 text-[10px] text-gray-500'>{areaLabel} · 2× scale</div>
          </button>
        </div>
      )}
    </div>
  )
}
