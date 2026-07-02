// Static template catalogue. Each template is a small layout of
// `BoardScopedItem` records that gets bulk-inserted via the existing
// `add-items` reducer action when the user clicks Insert.
//
// Items here are TEMPLATES — they carry no `id`/`boardId`/`updatedAt`
// (those are stamped at insert time by `CanvasPage.handleInsertTemplate`).
// `order` is also set to 0 and re-assigned by the reducer's
// `orderCounter` so newly-inserted shapes render on top.
//
// The `build()` factory accepts the active board id + current timestamp
// and returns a fresh array of items ready for dispatch.

import type { BoardScopedItem } from '../canvas/types'
import {
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  type ConnectorEnd
} from '../canvas/types'

export interface Template {
  id: string
  name: string
  description: string
  build: (boardId: string, now: number) => BoardScopedItem[]
}

// ── Helpers ───────────────────────────────────────────────────────
//
// `tplId()` isn't needed — the reducer assigns fresh ids via its own
// `id: uid()` flow on insert. Instead we mint `tpl<index>` ids here
// purely as build-time placeholders so the `BoardScopedItem` type
// checker is happy. `CanvasPage.handleInsertTemplate` re-stamps every
// item with a fresh `uid()` before dispatching.

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; text?: string } = {}
): BoardScopedItem {
  return {
    id: '',
    boardId: '',
    type: 'rect',
    x,
    y,
    w,
    h,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fill: opts.fill ?? '#ffffff',
    text: opts.text,
    fontSize: DEFAULT_NOTE_FONT_SIZE,
    order: 0,
    updatedAt: 0
  }
}

function ellipse(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; text?: string } = {}
): BoardScopedItem {
  return {
    id: '',
    boardId: '',
    type: 'ellipse',
    x,
    y,
    w,
    h,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fill: opts.fill ?? '#ffffff',
    text: opts.text,
    fontSize: DEFAULT_NOTE_FONT_SIZE,
    order: 0,
    updatedAt: 0
  }
}

function text(
  x: number,
  y: number,
  w: number,
  h: number,
  body: string,
  fontSize: number = DEFAULT_TEXT_FONT_SIZE
): BoardScopedItem {
  return {
    id: '',
    boardId: '',
    type: 'text',
    x,
    y,
    w,
    h,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    text: body,
    fontSize,
    order: 0,
    updatedAt: 0
  }
}

function arrow(x1: number, y1: number, x2: number, y2: number): BoardScopedItem {
  const start: ConnectorEnd = { kind: 'free', x: x1, y: y1 }
  const end: ConnectorEnd = { kind: 'free', x: x2, y: y2 }
  return {
    id: '',
    boardId: '',
    type: 'arrow',
    x: x1,
    y: y1,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    lineCap: 'round',
    start,
    end,
    order: 0,
    updatedAt: 0
  }
}

// ── Templates ─────────────────────────────────────────────────────

const FOOTBALL: Template = {
  id: 'football',
  name: 'Football pitch',
  description: '11 players + 2 arrows for a pass-and-run pattern',
  build: () => {
    const pitchW = 520
    const pitchH = 360
    const items: BoardScopedItem[] = []
    // Pitch background (green tint — gives the football layout its
    // pitch identity when dropped on the white canvas).
    items.push(rect(40, 40, pitchW, pitchH, { fill: '#86efac' }))
    // Center line.
    items.push(arrow(40 + pitchW / 2, 40, 40 + pitchW / 2, 40 + pitchH))
    // Center circle (approximated with an ellipse outline).
    items.push({
      ...ellipse(40 + pitchW / 2 - 40, 40 + pitchH / 2 - 40, 80, 80, { fill: 'none' }),
      text: undefined
    })
    // 11 players — 1 GK + 4 defenders + 3 mids + 3 forwards.
    const playerW = 36
    const playerH = 36
    const labels: Array<[number, number, string]> = [
      [40 + pitchW / 2 - playerW / 2, 40 + pitchH - playerH - 10, 'GK'],
      [80, 40 + pitchH - playerH - 70, 'LB'],
      [40 + pitchW / 2 - playerW / 2 - 40, 40 + pitchH - playerH - 70, 'CB'],
      [40 + pitchW / 2 - playerW / 2 + 40, 40 + pitchH - playerH - 70, 'CB'],
      [40 + pitchW - playerW - 80, 40 + pitchH - playerH - 70, 'RB'],
      [40 + 130, 40 + pitchH / 2 - playerH / 2, 'DM'],
      [40 + pitchW / 2 - playerW / 2, 40 + pitchH / 2 - playerH / 2, 'CM'],
      [40 + pitchW - playerW - 130, 40 + pitchH / 2 - playerH / 2, 'CM'],
      [40 + pitchW / 2 - playerW / 2, 40 + 110, 'AM'],
      [80, 40 + 110, 'LW'],
      [40 + pitchW - playerW - 80, 40 + 110, 'RW']
    ]
    for (const [x, y, label] of labels) {
      items.push(ellipse(x, y, playerW, playerH, { text: label }))
    }
    // Pass + run: CM → AM and AM runs upfield.
    const cm = labels[6]
    const am = labels[8]
    items.push(
      arrow(cm[0] + playerW / 2, cm[1] + playerH / 2, am[0] + playerW / 2, am[1] + playerH / 2),
      arrow(am[0] + playerW / 2, am[1] + playerH / 2, am[0] + playerW / 2, am[1] - 60)
    )
    return items
  }
}

const BASKETBALL: Template = {
  id: 'basketball',
  name: 'Basketball half-court',
  description: '5 players, court + 3pt arc, ready to draw a play',
  build: () => {
    const items: BoardScopedItem[] = []
    // Court (wood tan).
    items.push(rect(40, 40, 520, 360, { fill: '#fde68a' }))
    // Key (paint area).
    items.push(rect(40 + 520 / 2 - 80, 40 + 360 - 160, 160, 160, { fill: 'none' }))
    // Free-throw circle (top of key).
    items.push({
      ...ellipse(40 + 520 / 2 - 50, 40 + 360 - 160 - 50, 100, 60, { fill: 'none' }),
      text: undefined
    })
    // 3pt arc (approximated with an ellipse outline, top half).
    items.push({
      ...ellipse(40 + 520 / 2 - 130, 40 + 360 - 280, 260, 280, { fill: 'none' }),
      text: undefined
    })
    // Hoop line.
    items.push(arrow(40 + 520 / 2, 40 + 360 - 4, 40 + 520 / 2, 40 + 360 + 8))
    // 5 players.
    const playerW = 36
    const playerH = 36
    const labels: Array<[number, number, string]> = [
      [40 + 520 / 2 - playerW / 2, 40 + 60, 'PG'],
      [40 + 520 / 2 - playerW / 2 - 80, 40 + 120, 'SG'],
      [40 + 520 / 2 - playerW / 2 + 80, 40 + 120, 'SF'],
      [40 + 520 / 2 - playerW / 2 - 50, 40 + 200, 'PF'],
      [40 + 520 / 2 - playerW / 2 + 50, 40 + 200, 'C']
    ]
    for (const [x, y, label] of labels) {
      items.push(ellipse(x, y, playerW, playerH, { text: label }))
    }
    return items
  }
}

const SALES: Template = {
  id: 'sales',
  name: 'Sales pipeline',
  description: 'Lead → Qualified → Proposal → Closed',
  build: () => {
    const items: BoardScopedItem[] = []
    const boxW = 140
    const boxH = 80
    const y = 80
    const xs = [40, 200, 360, 520]
    const labels = ['Lead', 'Qualified', 'Proposal', 'Closed']
    const fills = ['#dbeafe', '#fef3c7', '#fde68a', '#bbf7d0']
    for (let i = 0; i < xs.length; i++) {
      items.push(rect(xs[i], y, boxW, boxH, { fill: fills[i], text: labels[i] }))
    }
    // Arrows between consecutive stages.
    for (let i = 0; i < xs.length - 1; i++) {
      items.push(arrow(xs[i] + boxW, y + boxH / 2, xs[i + 1], y + boxH / 2))
    }
    // Title.
    items.push(text(40, 20, 620, 40, 'Sales pipeline', 24))
    return items
  }
}

const HACKATHON: Template = {
  id: 'hackathon',
  name: 'Hackathon system',
  description: 'Frontend / API / Worker / DB overview',
  build: () => {
    const items: BoardScopedItem[] = []
    const boxW = 160
    const boxH = 80
    // Top row: Frontend (left) + API (right).
    items.push(
      rect(60, 100, boxW, boxH, { fill: '#ddd6fe', text: 'Frontend' }),
      rect(320, 100, boxW, boxH, { fill: '#bfdbfe', text: 'API' }),
      rect(60, 260, boxW, boxH, { fill: '#fed7aa', text: 'Worker' }),
      rect(320, 260, boxW, boxH, { fill: '#bbf7d0', text: 'DB' })
    )
    // Arrows: Frontend → API, API → Worker, API → DB, Worker → DB.
    items.push(
      arrow(60 + boxW, 100 + boxH / 2, 320, 100 + boxH / 2),
      arrow(320 + boxW / 2, 100 + boxH, 60 + boxW / 2, 260),
      arrow(320 + boxW, 100 + boxH / 2, 320 + boxW / 2, 260),
      arrow(60 + boxW, 260 + boxH / 2, 320, 260 + boxH / 2)
    )
    // Title.
    items.push(text(60, 30, 420, 40, 'System overview', 24))
    return items
  }
}

export const TEMPLATES: Template[] = [FOOTBALL, BASKETBALL, SALES, HACKATHON]

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

// Sentinel constants for tests + dev tools that import them.
export const TEMPLATE_BOARD_ID_PLACEHOLDER = '__placeholder__'
