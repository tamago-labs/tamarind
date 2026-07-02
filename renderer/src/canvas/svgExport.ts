// Visual export — turns the active board (or a sub-region of it) into
// a self-contained SVG document, or rasterizes the same document to a
// PNG blob. Pure module, no React, no DOM access beyond `<canvas>` for
// the PNG path (which has to happen in the renderer).
//
// Two area modes, picked by the caller:
//   • 'selection' — union of `computeBoundingBox` over the selected
//     items on the active board, padded. Predictable, share-friendly.
//   • 'viewport'  — the user's current visible area (whatever's on
//     screen). Mirrors a "screenshot this view" mental model.
//
// In both cases the caller passes the rect explicitly; the helper
// `buildExportSvg` is decoupled so CanvasPage can also use it for any
// future programmatic export (full-board backup file etc.).
//
// Coordinate system: the rendered SVG uses `viewBox="x y w h"` for
// the rect the caller asked for. Items are emitted at their world
// positions, so any subset of items within (or overlapping) the rect
// shows up at the right spot. Items entirely outside the rect still
// get emitted (cheap; the viewBox clips them on render).
//
// Text rendering uses `<foreignObject>` with the same HTML+CSS the
// live `TextOverlay` uses, so word-break / padding / line-height
// match the canvas exactly. Trade-off: SVG renderers without
// foreignObject support (Inkscape command-line, some thumbnail
// services) will render text blank. Acceptable for v1 — Tamarind
// exports are intended for browser preview + share, not vector
// editing.

import {
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_TEXT_FONT_SIZE,
  computeBoundingBox,
  resolveEnd,
  type Board,
  type BoardScopedItem
} from './types'

export type ExportAreaMode = 'selection' | 'viewport'

export interface ExportRect {
  // World coordinates. Width/height must be positive (callers should
  // pad the union to keep both axes positive).
  x: number
  y: number
  w: number
  h: number
}

export interface ExportLayout {
  board: Pick<Board, 'name' | 'createdAt'>
  rect: ExportRect
  // Source items are pre-filtered to the active board and (when area
  // mode is 'selection') to the selected ids. Items outside the rect
  // are still rendered; the viewBox clips them.
  items: BoardScopedItem[]
  itemsById: Record<string, BoardScopedItem>
  mode: ExportAreaMode
}

// Padding around the export rect so strokes / arrowheads / connector
// chips don't kiss the edge. World units (the renderer uses world px
// everywhere, so 40 = 40 SVG units).
const RECT_PADDING = 40

// Selection-trim padding — wider so multi-selection bboxes that touch
// the bounding box of every item get some breathing room.
const SELECTION_PADDING = 40

// Build an ExportRect from the selection. Returns null if no item on
// the active board is selected (caller can then fall back to the
// viewport).
export function selectionRect(
  items: BoardScopedItem[],
  selectedIds: ReadonlySet<string>,
  activeBoardId: string | null
): ExportRect | null {
  if (!activeBoardId) return null
  const onBoard = items.filter((it) => it.boardId === activeBoardId)
  const selected = onBoard.filter((it) => selectedIds.has(it.id))
  if (selected.length === 0) return null
  const itemsById: Record<string, BoardScopedItem> = {}
  for (const it of onBoard) itemsById[it.id] = it
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of selected) {
    const bb = computeBoundingBox(it, itemsById)
    if (bb.x < minX) minX = bb.x
    if (bb.y < minY) minY = bb.y
    if (bb.x + bb.w > maxX) maxX = bb.x + bb.w
    if (bb.y + bb.h > maxY) maxY = bb.y + bb.h
  }
  return paddedRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, SELECTION_PADDING)
}

// Compute the visible viewport's world-space rect from the surface's
// bounding rect + current pan/zoom. Caller passes `clientToWorld` so
// this module stays free of React refs.
export function viewportRect(
  surfaceRect: DOMRect,
  pan: { x: number; y: number },
  zoom: number
): ExportRect {
  // world = (client - surfaceRect.origin - pan) / zoom
  const tl = worldFromClient(surfaceRect.left, surfaceRect.top, surfaceRect, pan, zoom)
  const br = worldFromClient(
    surfaceRect.left + surfaceRect.width,
    surfaceRect.top + surfaceRect.height,
    surfaceRect,
    pan,
    zoom
  )
  const x = Math.min(tl.x, br.x)
  const y = Math.min(tl.y, br.y)
  const w = Math.abs(br.x - tl.x)
  const h = Math.abs(br.y - tl.y)
  return paddedRect({ x, y, w, h }, RECT_PADDING)
}

function worldFromClient(
  cx: number,
  cy: number,
  surfaceRect: DOMRect,
  pan: { x: number; y: number },
  zoom: number
): { x: number; y: number } {
  return {
    x: (cx - surfaceRect.left - pan.x) / zoom,
    y: (cy - surfaceRect.top - pan.y) / zoom
  }
}

function paddedRect(rect: ExportRect, pad: number): ExportRect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }
}

// ── SVG emission ─────────────────────────────────────────────────

// Build the full SVG document. The string includes the XML prologue
// so it can be opened standalone in a browser (drag-and-drop a
// .svg file onto a tab → renders). Width / height attrs use the
// rect's pixel size so PNG rasterization has explicit intrinsic
// dimensions (some browsers default to 300×150 for bare SVGs).
export function buildExportSvg(layout: ExportLayout): string {
  const r = layout.rect
  const body = layout.items.map((it) => renderItem(it, layout.itemsById)).join('')
  const created = new Date(layout.board.createdAt).toISOString().slice(0, 10)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${r.w}" height="${r.h}" viewBox="${r.x} ${r.y} ${r.w} ${r.h}">
  <title>${escapeXml(layout.board.name)} — Tamarind export ${created}</title>
  <defs>
    <marker id="tamarind-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="strokeWidth" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
    </marker>
  </defs>
  <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#ffffff" />
${body}
</svg>
`
}

// Render a single item as an SVG fragment string. Mirrors the live
// CanvasItems rendering closely enough that the export looks like a
// snapshot of the canvas — minus selection overlays, resize handles,
// drag ghosts, ports overlay.
function renderItem(item: BoardScopedItem, itemsById: Record<string, BoardScopedItem>): string {
  switch (item.type) {
    case 'rect':
      return renderRect(item)
    case 'ellipse':
      return renderEllipse(item)
    case 'connector':
      return renderConnector(item, itemsById)
    case 'text':
      return renderText(item)
  }
}

function renderRect(item: BoardScopedItem): string {
  const w = item.w ?? 0
  const h = item.h ?? 0
  const body = `<rect x="${item.x}" y="${item.y}" width="${w}" height="${h}" fill="${escapeXml(item.fill ?? 'none')}" stroke="${escapeXml(item.stroke)}" stroke-width="${item.strokeWidth}" />`
  return shapeTextOverlay(item, w, h, body)
}

function renderEllipse(item: BoardScopedItem): string {
  const w = item.w ?? 0
  const h = item.h ?? 0
  const cx = item.x + w / 2
  const cy = item.y + h / 2
  const body = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="${escapeXml(item.fill ?? 'none')}" stroke="${escapeXml(item.stroke)}" stroke-width="${item.strokeWidth}" />`
  return shapeTextOverlay(item, w, h, body)
}

function renderText(item: BoardScopedItem): string {
  const w = item.w ?? 0
  const h = item.h ?? 0
  if (!item.text) return ''
  const fontSize = item.fontSize ?? DEFAULT_TEXT_FONT_SIZE
  const color = item.stroke ?? '#000000'
  // Same padding / line-height as `TextOverlay`. `word-break: break-word`
  // mirrors the canvas's behaviour for long titles.
  const safeText = escapeXml(item.text).replace(/&#10;/g, '\n')
  return `<foreignObject x="${item.x}" y="${item.y}" width="${w}" height="${h}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;padding:8px 10px;color:${escapeXml(color)};font-size:${fontSize}px;font-family:var(--font-display, sans-serif);line-height:1.3;white-space:pre-wrap;word-break:break-word;overflow:hidden;">
    ${safeText}
  </div>
</foreignObject>`
}

// Replicates the rect/ellipse `<foreignObject>` text caption so the
// export includes the optional inline note ("Double-click to edit"
// etc.). Wraps the body in a single `<g>` so both the shape and the
// overlay travel together when grouped.
function shapeTextOverlay(item: BoardScopedItem, w: number, h: number, shape: string): string {
  if (!item.text) return shape
  const fontSize = item.fontSize ?? DEFAULT_NOTE_FONT_SIZE
  const color = item.stroke ?? '#000000'
  const text = escapeXml(item.text)
  const overlay = `<foreignObject x="${item.x}" y="${item.y}" width="${w}" height="${h}">
  <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;box-sizing:border-box;padding:8px 10px;color:${escapeXml(color)};font-size:${fontSize}px;font-family:var(--font-display, sans-serif);line-height:1.3;white-space:pre-wrap;word-break:break-word;overflow:hidden;">
    ${text}
  </div>
</foreignObject>`
  return `${shape}\n  ${overlay}`
}

function renderConnector(
  item: BoardScopedItem,
  itemsById: Record<string, BoardScopedItem>
): string {
  if (!item.start || !item.end) return ''
  const s = resolveEnd(item.start, itemsById)
  const e = resolveEnd(item.end, itemsById)
  const strokeWidth = item.strokeWidth ?? 2
  const stroke = escapeXml(item.stroke)
  const dash = strokeDasharray(item.strokePattern ?? 'solid', strokeWidth)
  const markerStart = item.arrowStart === 'arrow' ? 'url(#tamarind-arrowhead)' : undefined
  const markerEnd = item.arrowEnd === 'arrow' ? 'url(#tamarind-arrowhead)' : undefined
  const lineAttrs = [
    `stroke="${stroke}"`,
    `stroke-width="${strokeWidth}"`,
    `stroke-linecap="${item.lineCap ?? 'round'}"`,
    dash ? `stroke-dasharray="${dash}"` : '',
    markerStart ? `marker-start="${markerStart}"` : '',
    markerEnd ? `marker-end="${markerEnd}"` : ''
  ]
    .filter(Boolean)
    .join(' ')
  const strokeEl =
    item.curve === 'bezier'
      ? `<path d="${escapeXml(buildBezierPath(s, e))}" fill="none" ${lineAttrs} />`
      : `<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" ${lineAttrs} />`
  const labelEl = item.label?.text ? renderConnectorLabel(item.label, s, e) : ''
  return `${strokeEl}\n  ${labelEl}`
}

function renderConnectorLabel(
  label: NonNullable<BoardScopedItem['label']>,
  s: { x: number; y: number },
  e: { x: number; y: number }
): string {
  const fontSize = label.fontSize ?? 11
  const text = label.text
  // Same chip math as `ConnectorShape.ConnectorLabelEl` so the export
  // matches the canvas.
  const charW = fontSize * 0.55
  const padX = 6
  const padY = 3
  const textW = Math.max(text.length, 1) * charW
  const chipW = textW + padX * 2
  const chipH = fontSize + padY * 2
  const anchor = labelAnchor(label.at, s, e)
  const cx = anchor.x - chipW / 2
  const cy = anchor.y - chipH - 6
  const textY = cy + padY + fontSize - 2
  return `<g>
  <rect x="${cx}" y="${cy}" width="${chipW}" height="${chipH}" rx="4" ry="4" fill="white" stroke="#3b82f6" stroke-width="1" />
  <text x="${anchor.x}" y="${textY}" font-size="${fontSize}" fill="#1f2937" text-anchor="middle" font-family="var(--font-display, sans-serif)">${escapeXml(text)}</text>
</g>`
}

function strokeDasharray(
  pattern: 'solid' | 'dashed' | 'dotted',
  strokeWidth: number
): string | undefined {
  if (pattern === 'dashed') {
    const u = Math.max(1, strokeWidth * 2)
    return `${u * 4} ${u * 3}`
  }
  if (pattern === 'dotted') {
    const u = Math.max(1, strokeWidth)
    return `${u} ${u * 3}`
  }
  return undefined
}

function buildBezierPath(s: { x: number; y: number }, e: { x: number; y: number }): string {
  const mx = (s.x + e.x) / 2
  const my = (s.y + e.y) / 2
  const dx = e.x - s.x
  const dy = e.y - s.y
  const len = Math.hypot(dx, dy) || 1
  const offset = len * 0.25
  const cx = mx + (-dy / len) * offset
  const cy = my + (dx / len) * offset
  return `M ${s.x} ${s.y} Q ${cx} ${cy} ${e.x} ${e.y}`
}

function labelAnchor(
  at: 'start' | 'middle' | 'end',
  s: { x: number; y: number },
  e: { x: number; y: number }
): { x: number; y: number } {
  if (at === 'start') return s
  if (at === 'end') return e
  return { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
}

// Minimal XML escaping for attribute values + PCDATA. Kept local so
// svgExport.ts doesn't depend on the chip menu's `i18n` helpers.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── PNG rasterization ────────────────────────────────────────────

export interface RasterizeOptions {
  // Output pixel size. Defaults to the SVG's intrinsic w × h.
  pixelWidth?: number
  pixelHeight?: number
  // Device-pixel-ratio multiplier (default 2 for crisp exports on
  // retina displays). Halve for size-conscious sharing.
  scale?: number
}

// Rasterize an SVG string to a PNG Blob via an offscreen `<canvas>`.
// Returns a promise so callers can `await` for the download trigger.
//
// Why a canvas and not `image.src = blob:svg` directly: SVG load via
// Blob URL has been reliable in Chromium / Firefox / WebKit for
// years, but drawing it onto a canvas is the only way to produce a
// PNG (the browser's canvas-API is the source of `toBlob('image/png')`).
//
// CSP note: Tamarind's renderer runs with `img-src 'self' data:`,
// which blocks `blob:` URLs from being loaded into `<img>` (Chromium
// logs "violates Content Security Policy directive" and the load
// silently fails — the canvas never gets pixels, `canvas.toBlob`
// returns null). The fix is to convert the SVG Blob to a data URL via
// `FileReader.readAsDataURL` before assigning to `image.src` — data
// URLs are explicitly allowed by the policy. The SVG-download path
// (CanvasPage handleExportSvg) still uses a Blob URL for the anchor
// download because `<a href>` isn't subject to `img-src`.
export async function rasterizeSvgToPng(
  svg: string,
  options: RasterizeOptions = {}
): Promise<Blob> {
  const scale = options.scale ?? 2
  const intrinsic = svgIntrinsicSize(svg)
  const w = Math.max(1, Math.round((options.pixelWidth ?? intrinsic.w) * scale))
  const h = Math.max(1, Math.round((options.pixelHeight ?? intrinsic.h) * scale))
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const dataUrl = await blobToDataUrl(blob)
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D canvas context')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(image, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))),
      'image/png'
    )
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Failed to convert SVG blob to data URL'))
    reader.readAsDataURL(blob)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load SVG into <img>'))
    img.src = url
  })
}

// Pull w/h attributes from the root `<svg>` opening tag. Falls back
// to 1024×768 if neither is set (paranoia — `buildExportSvg` always
// emits both, so this only fires for hand-crafted SVG inputs).
function svgIntrinsicSize(svg: string): { w: number; h: number } {
  const wMatch = svg.match(/<svg[^>]*\swidth=["'](\d+(?:\.\d+)?)["']/)
  const hMatch = svg.match(/<svg[^>]*\sheight=["'](\d+(?:\.\d+)?)["']/)
  const w = wMatch ? Number(wMatch[1]) : 1024
  const h = hMatch ? Number(hMatch[1]) : 768
  return { w, h }
}

// ── Filename helpers (mirroring boardIO.ts conventions) ──────────

const PNG_FILE_EXTENSION = '.png'
const SVG_FILE_EXTENSION = '.svg'

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
  return trimmed.length > 0 ? trimmed : 'Untitled'
}

export function buildExportFilename(
  board: Pick<Board, 'name'>,
  kind: 'svg' | 'png',
  now: Date = new Date()
): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const ext = kind === 'svg' ? SVG_FILE_EXTENSION : PNG_FILE_EXTENSION
  return `${sanitizeFilename(board.name)}-${date}${ext}`
}
