// Single-board backup / restore. The wire format is a self-contained
// JSON document — version + kind marker, board metadata, and the
// items on that board. Lossless round-trip: every field the renderer
// writes into a `BoardScopedItem` (including Phase 3 connector styling
// and the JSON-encoded `label`) survives the trip through JSON.
//
// Named for the Backup / Restore toolbar buttons (data round-trip).
// Visual export (SVG / PNG) is a separate, future module — see the
// Phase 4 plan notes about "decide the area" before adding it.
//
// Chat is per-room, not per-board, so it's not in the file. Writers /
// identity belong to the Autobase, not the data, so they're excluded.
// Item ids are preserved as hex strings for debugging; the restore
// path stamps fresh ones anyway so collisions are impossible.
//
// v1 contract:
//   {
//     version: 1,
//     kind: 'tamarind-board',
//     exportedAt: <unix ms>,
//     board: { name: string, createdAt: number, updatedAt: number },
//     items: [BoardScopedItem-shape]
//   }

import type { Board, BoardScopedItem } from '../canvas/types'

export const BOARD_FILE_KIND = 'tamarind-board'
export const BOARD_FILE_VERSION = 1
export const BOARD_FILE_EXTENSION = '.tamarind.json'

interface TamarindBoardFile {
  version: number
  kind: string
  exportedAt: number
  board: { name: string; createdAt: number; updatedAt: number }
  // Items are kept as plain JSON (no Buffer / Date round-trip). The
  // `start` / `end` / `label` fields are already JSON-string-safe in
  // `BoardScopedItem`, so `JSON.stringify` is enough.
  items: BoardScopedItem[]
}

export interface ParsedBackup {
  name: string
  // Items with placeholder `id` and `boardId` (empty strings) — the
  // caller stamps fresh values via `uid()` and the active board id
  // before dispatching `add-items`. Mirrors `CanvasPage.handleInsertTemplate`.
  items: BoardScopedItem[]
}

// Sanitize a board name into a safe filename component. Strips path
// separators and a handful of characters Windows / macOS / Linux
// reject in filenames. Falls back to "Untitled" if the result is empty.
function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
  return trimmed.length > 0 ? trimmed : 'Untitled'
}

export function buildBackupFilename(board: Board, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${sanitizeFilename(board.name)}-${date}${BOARD_FILE_EXTENSION}`
}

// Serialize one board + its items for the Backup flow. Items must
// already be filtered to `item.boardId === board.id` by the caller
// (this module is presentation-layer agnostic about which board is
// active).
export function serializeBoard(board: Board, items: BoardScopedItem[], now: number): string {
  const file: TamarindBoardFile = {
    version: BOARD_FILE_VERSION,
    kind: BOARD_FILE_KIND,
    exportedAt: now,
    board: {
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt
    },
    items
  }
  // Pretty-print for human readability (boards aren't huge; ~1MB worst
  // case for a heavy template is fine to ship as text). Trailing
  // newline so editors / `cat` don't complain.
  return JSON.stringify(file, null, 2) + '\n'
}

// Known item types — anything else in the backup file is silently
// dropped. Keeps a malformed / hand-crafted file from injecting an
// unknown shape type that would crash the renderer.
const KNOWN_ITEM_TYPES = new Set<BoardScopedItem['type']>(['rect', 'ellipse', 'connector', 'text'])

// Defensive per-item validation. Strips `id` + `boardId` (caller
// re-stamps) and drops the item if it's missing a type or has an
// unknown type. Other field-level validation is intentionally lax —
// the reducer / worker will reject anything truly malformed via the
// existing add-items path.
function validateItem(raw: unknown): BoardScopedItem | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.type !== 'string') return null
  if (!KNOWN_ITEM_TYPES.has(r.type as BoardScopedItem['type'])) return null
  if (typeof r.x !== 'number' || typeof r.y !== 'number') return null
  if (typeof r.stroke !== 'string' || typeof r.strokeWidth !== 'number') return null
  if (typeof r.order !== 'number' || typeof r.updatedAt !== 'number') return null
  // Spread — we trust the JSON shape but rely on the reducer to
  // enforce the typed `BoardScopedItem` contract downstream.
  const item: BoardScopedItem = {
    ...(r as unknown as BoardScopedItem),
    id: '',
    boardId: ''
  }
  return item
}

// Thrown on malformed input — caught by the UI to show a friendly error.
export class BoardBackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoardBackupError'
  }
}

export function parseBackup(text: string): ParsedBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new BoardBackupError(`File is not valid JSON: ${(e as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BoardBackupError('File is not a Tamarind board document')
  }
  const data = parsed as Partial<TamarindBoardFile>
  if (data.kind !== BOARD_FILE_KIND) {
    throw new BoardBackupError(
      `Not a Tamarind board file (expected kind "${BOARD_FILE_KIND}", got "${String(data.kind)}")`
    )
  }
  if (data.version !== BOARD_FILE_VERSION) {
    throw new BoardBackupError(
      `Unsupported file version ${String(data.version)} (this build speaks version ${BOARD_FILE_VERSION})`
    )
  }
  if (!data.board || typeof data.board.name !== 'string') {
    throw new BoardBackupError('Missing or malformed board name')
  }
  if (!Array.isArray(data.items)) {
    throw new BoardBackupError('Missing or malformed items array')
  }
  const items: BoardScopedItem[] = []
  for (const raw of data.items) {
    const item = validateItem(raw)
    if (item) items.push(item)
  }
  return {
    name: data.board.name,
    items
  }
}
