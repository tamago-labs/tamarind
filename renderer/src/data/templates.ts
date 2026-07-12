// Template catalogue organised by category. Each template builds an
// array of BoardScopedItem records that get bulk-inserted via the
// `add-items` reducer action when the user clicks Insert.
//
// Items carry placeholder ids — CanvasPage.handleInsertTemplate
// re-stamps every item with a fresh uid() before dispatching.
//
// Ordering convention (lower = rendered first / behind):
//   background: -10  — field, court, grid backgrounds
//   markings:   -5   — lines, circles, arrows
//   shapes:      0   — players, boxes, cards
//   notes:       5   — sticky notes (on the canvas, not preview)
//   labels:     10   — text labels

import type { BoardScopedItem, ConnectorLabel } from '../canvas/types'
import {
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_FONT_SIZE,
  type ConnectorEnd
} from '../canvas/types'

// ── Ordering constants ──────────────────────────────────────────

export const ORDER = {
  background: -10,
  markings: -5,
  shapes: 0,
  notes: 5,
  labels: 10
} as const

// ── Types ───────────────────────────────────────────────────────

export interface TemplateCategory {
  id: string
  name: string
  icon: string
}

export interface Template {
  id: string
  category: string
  name: string
  description: string
  build: (boardId: string, now: number) => BoardScopedItem[]
}

export const CATEGORIES: TemplateCategory[] = [
  { id: 'football', name: 'Football', icon: '⚽' },
  { id: 'basketball', name: 'Basketball', icon: '🏀' },
  { id: 'marketing', name: 'Marketing', icon: '📈' },
  { id: 'product', name: 'Product', icon: '📦' },
  { id: 'strategy', name: 'Strategy', icon: '🎯' },
  { id: 'startup', name: 'Startup', icon: '🚀' },
  { id: 'general', name: 'General', icon: '📋' }
]

// ── Helpers ─────────────────────────────────────────────────────

function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; text?: string; order?: number } = {}
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
    order: opts.order ?? ORDER.shapes,
    updatedAt: 0
  }
}

function ellipse(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; text?: string; order?: number } = {}
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
    order: opts.order ?? ORDER.shapes,
    updatedAt: 0
  }
}

function note(
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: string; text?: string; order?: number } = {}
): BoardScopedItem {
  return {
    id: '',
    boardId: '',
    type: 'note',
    x,
    y,
    w,
    h,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    fill: opts.fill ?? '#fef3c7',
    text: opts.text,
    fontSize: DEFAULT_NOTE_FONT_SIZE,
    order: opts.order ?? ORDER.notes,
    updatedAt: 0
  }
}

function text(
  x: number,
  y: number,
  w: number,
  h: number,
  body: string,
  fontSize: number = DEFAULT_TEXT_FONT_SIZE,
  order: number = ORDER.labels
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
    order,
    updatedAt: 0
  }
}

function connector(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: {
    arrowStart?: 'none' | 'arrow'
    arrowEnd?: 'none' | 'arrow'
    strokePattern?: 'solid' | 'dashed' | 'dotted'
    label?: ConnectorLabel
    order?: number
  } = {}
): BoardScopedItem {
  const start: ConnectorEnd = { kind: 'free', x: x1, y: y1 }
  const end: ConnectorEnd = { kind: 'free', x: x2, y: y2 }
  return {
    id: '',
    boardId: '',
    type: 'connector',
    x: x1,
    y: y1,
    stroke: DEFAULT_STROKE,
    strokeWidth: DEFAULT_STROKE_WIDTH,
    lineCap: 'round',
    arrowStart: opts.arrowStart ?? 'none',
    arrowEnd: opts.arrowEnd ?? 'arrow',
    strokePattern: opts.strokePattern ?? 'solid',
    curve: 'straight',
    label: opts.label,
    start,
    end,
    order: opts.order ?? ORDER.markings,
    updatedAt: 0
  }
}

// ── Football Templates ──────────────────────────────────────────

const FOOTBALL_442: Template = {
  id: 'football-442',
  category: 'football',
  name: '4-4-2 Formation',
  description: 'Classic balanced formation with two strikers',
  build: () => {
    const items: BoardScopedItem[] = []
    const pitchX = 40,
      pitchY = 40,
      pitchW = 520,
      pitchH = 360

    // Pitch
    items.push(rect(pitchX, pitchY, pitchW, pitchH, { fill: '#86efac', order: ORDER.background }))
    // Center line
    items.push(
      connector(pitchX + pitchW / 2, pitchY, pitchX + pitchW / 2, pitchY + pitchH, {
        arrowEnd: 'none'
      })
    )
    // Center circle
    items.push({
      ...ellipse(pitchX + pitchW / 2 - 40, pitchY + pitchH / 2 - 40, 80, 80, { fill: 'none' }),
      order: ORDER.markings
    })

    // Players (4-4-2)
    const players: [number, number, string][] = [
      [pitchX + pitchW / 2, pitchY + pitchH - 30, 'GK'],
      [pitchX + 80, pitchY + pitchH - 100, 'LB'],
      [pitchX + pitchW / 2 - 60, pitchY + pitchH - 100, 'CB'],
      [pitchX + pitchW / 2 + 60, pitchY + pitchH - 100, 'CB'],
      [pitchX + pitchW - 80, pitchY + pitchH - 100, 'RB'],
      [pitchX + 80, pitchY + pitchH / 2, 'LM'],
      [pitchX + pitchW / 2 - 60, pitchY + pitchH / 2, 'CM'],
      [pitchX + pitchW / 2 + 60, pitchY + pitchH / 2, 'CM'],
      [pitchX + pitchW - 80, pitchY + pitchH / 2, 'RM'],
      [pitchX + pitchW / 2 - 60, pitchY + 80, 'ST'],
      [pitchX + pitchW / 2 + 60, pitchY + 80, 'ST']
    ]
    for (const [x, y, label] of players) {
      items.push(ellipse(x - 18, y - 18, 36, 36, { text: label }))
    }

    // Sticky notes
    items.push(note(580, 40, 160, 80, { text: 'Press high after losing possession' }))
    items.push(note(580, 130, 160, 80, { text: 'Full-backs overlap on attack' }))
    items.push(note(580, 220, 160, 80, { text: 'Compact defensive shape' }))
    items.push(note(580, 310, 160, 80, { text: 'Target striker holds up play' }))

    return items
  }
}

const FOOTBALL_433: Template = {
  id: 'football-433',
  category: 'football',
  name: '4-3-3 Formation',
  description: 'Attacking width with wingers',
  build: () => {
    const items: BoardScopedItem[] = []
    const pitchX = 40,
      pitchY = 40,
      pitchW = 520,
      pitchH = 360

    items.push(rect(pitchX, pitchY, pitchW, pitchH, { fill: '#86efac', order: ORDER.background }))
    items.push(
      connector(pitchX + pitchW / 2, pitchY, pitchX + pitchW / 2, pitchY + pitchH, {
        arrowEnd: 'none'
      })
    )
    items.push({
      ...ellipse(pitchX + pitchW / 2 - 40, pitchY + pitchH / 2 - 40, 80, 80, { fill: 'none' }),
      order: ORDER.markings
    })

    const players: [number, number, string][] = [
      [pitchX + pitchW / 2, pitchY + pitchH - 30, 'GK'],
      [pitchX + 80, pitchY + pitchH - 100, 'LB'],
      [pitchX + pitchW / 2 - 60, pitchY + pitchH - 100, 'CB'],
      [pitchX + pitchW / 2 + 60, pitchY + pitchH - 100, 'CB'],
      [pitchX + pitchW - 80, pitchY + pitchH - 100, 'RB'],
      [pitchX + pitchW / 2, pitchY + pitchH / 2 + 40, 'DM'],
      [pitchX + pitchW / 2 - 80, pitchY + pitchH / 2 - 20, 'CM'],
      [pitchX + pitchW / 2 + 80, pitchY + pitchH / 2 - 20, 'CM'],
      [pitchX + 60, pitchY + 80, 'LW'],
      [pitchX + pitchW / 2, pitchY + 60, 'ST'],
      [pitchX + pitchW - 60, pitchY + 80, 'RW']
    ]
    for (const [x, y, label] of players) {
      items.push(ellipse(x - 18, y - 18, 36, 36, { text: label }))
    }

    items.push(note(580, 40, 160, 80, { text: 'Wingers stay wide' }))
    items.push(note(580, 130, 160, 80, { text: 'DM covers counter attacks' }))
    items.push(note(580, 220, 160, 80, { text: 'High pressing trigger' }))
    items.push(note(580, 310, 160, 80, { text: 'Switch play quickly' }))

    return items
  }
}

const FOOTBALL_CORNER: Template = {
  id: 'football-corner',
  category: 'football',
  name: 'Corner Kick Planner',
  description: 'Set piece layout for corner kicks',
  build: () => {
    const items: BoardScopedItem[] = []
    const pitchX = 40,
      pitchY = 40,
      pitchW = 520,
      pitchH = 360

    items.push(rect(pitchX, pitchY, pitchW, pitchH, { fill: '#86efac', order: ORDER.background }))
    // Penalty area
    items.push(
      rect(pitchX + pitchW - 180, pitchY + pitchH / 2 - 90, 180, 180, {
        fill: 'none',
        order: ORDER.markings
      })
    )
    // Goal
    items.push(
      rect(pitchX + pitchW - 10, pitchY + pitchH / 2 - 30, 10, 60, {
        fill: '#ffffff',
        order: ORDER.markings
      })
    )
    // Corner arc
    items.push({
      ...ellipse(pitchX + pitchW - 20, pitchY + pitchH - 20, 20, 20, { fill: 'none' }),
      order: ORDER.markings
    })

    // Players in box
    const players: [number, number, string][] = [
      [pitchX + pitchW - 60, pitchY + pitchH / 2 - 40, 'Near'],
      [pitchX + pitchW - 100, pitchY + pitchH / 2 + 20, 'Far'],
      [pitchX + pitchW - 140, pitchY + pitchH / 2, 'Edge'],
      [pitchX + pitchW - 20, pitchY + pitchH - 10, 'Corner']
    ]
    for (const [x, y, label] of players) {
      items.push(ellipse(x - 16, y - 16, 32, 32, { text: label }))
    }

    items.push(note(580, 40, 160, 80, { text: 'Near-post run' }))
    items.push(note(580, 130, 160, 80, { text: 'Far-post target' }))
    items.push(note(580, 220, 160, 80, { text: 'Edge of box rebound' }))
    items.push(note(580, 310, 160, 80, { text: 'Short corner option' }))

    return items
  }
}

const FOOTBALL_FREEKICK: Template = {
  id: 'football-freekick',
  category: 'football',
  name: 'Free Kick Planner',
  description: 'Set piece layout for free kicks',
  build: () => {
    const items: BoardScopedItem[] = []
    const pitchX = 40,
      pitchY = 40,
      pitchW = 520,
      pitchH = 360

    items.push(rect(pitchX, pitchY, pitchW, pitchH, { fill: '#86efac', order: ORDER.background }))
    // Penalty area
    items.push(
      rect(pitchX + pitchW - 180, pitchY + pitchH / 2 - 90, 180, 180, {
        fill: 'none',
        order: ORDER.markings
      })
    )
    // Goal
    items.push(
      rect(pitchX + pitchW - 10, pitchY + pitchH / 2 - 30, 10, 60, {
        fill: '#ffffff',
        order: ORDER.markings
      })
    )
    // Ball position
    items.push({
      ...ellipse(pitchX + pitchW - 200, pitchY + pitchH / 2, 16, 16, { fill: '#ffffff' }),
      order: ORDER.shapes
    })
    // Wall (defenders)
    for (let i = 0; i < 4; i++) {
      items.push(
        ellipse(pitchX + pitchW - 160, pitchY + pitchH / 2 - 40 + i * 25, 20, 20, {
          fill: '#ef4444'
        })
      )
    }
    // Taker
    items.push(ellipse(pitchX + pitchW - 220, pitchY + pitchH / 2 - 10, 28, 28, { text: 'Taker' }))

    items.push(note(580, 40, 160, 80, { text: 'Primary taker' }))
    items.push(note(580, 130, 160, 80, { text: 'Dummy run' }))
    items.push(note(580, 220, 160, 80, { text: 'Wall positioning' }))
    items.push(note(580, 310, 160, 80, { text: 'Rebound responsibility' }))

    return items
  }
}

const FOOTBALL_BLANK: Template = {
  id: 'football-blank',
  category: 'football',
  name: 'Blank Football Pitch',
  description: 'An empty football pitch ready for custom tactics and formations.',
  build: () => {
    const items: BoardScopedItem[] = []

    const pitchX = 40
    const pitchY = 40
    const pitchW = 520
    const pitchH = 360

    // Pitch
    items.push(
      rect(pitchX, pitchY, pitchW, pitchH, {
        fill: '#86efac',
        order: ORDER.background
      })
    )

    // Halfway line
    items.push(
      connector(pitchX + pitchW / 2, pitchY, pitchX + pitchW / 2, pitchY + pitchH, {
        arrowEnd: 'none'
      })
    )

    // Center circle
    items.push({
      ...ellipse(pitchX + pitchW / 2 - 40, pitchY + pitchH / 2 - 40, 80, 80, { fill: 'none' }),
      order: ORDER.markings
    })

    // Left penalty area
    items.push(
      rect(pitchX, pitchY + pitchH / 2 - 90, 120, 180, { fill: 'none', order: ORDER.markings })
    )

    // Right penalty area
    items.push(
      rect(pitchX + pitchW - 120, pitchY + pitchH / 2 - 90, 120, 180, {
        fill: 'none',
        order: ORDER.markings
      })
    )

    // Left goal area
    items.push(
      rect(pitchX, pitchY + pitchH / 2 - 45, 40, 90, { fill: 'none', order: ORDER.markings })
    )

    // Right goal area
    items.push(
      rect(pitchX + pitchW - 40, pitchY + pitchH / 2 - 45, 40, 90, {
        fill: 'none',
        order: ORDER.markings
      })
    )

    items.push(
      note(580, 40, 160, 80, {
        text: 'Team strategy'
      })
    )

    return items
  }
}

// ── Basketball Templates ────────────────────────────────────────

const BASKETBALL_ZONE: Template = {
  id: 'basketball-zone',
  category: 'basketball',
  name: '2-3 Zone Defense',
  description: 'Defensive formation protecting the paint',
  build: () => {
    const items: BoardScopedItem[] = []
    const courtX = 40,
      courtY = 40,
      courtW = 520,
      courtH = 360

    items.push(rect(courtX, courtY, courtW, courtH, { fill: '#fde68a', order: ORDER.background }))
    // Key
    items.push(
      rect(courtX + courtW / 2 - 80, courtY + courtH - 160, 160, 160, {
        fill: 'none',
        order: ORDER.markings
      })
    )
    // 3pt arc
    items.push({
      ...ellipse(courtX + courtW / 2 - 130, courtY + courtH - 280, 260, 280, { fill: 'none' }),
      order: ORDER.markings
    })
    // Hoop
    items.push(
      connector(
        courtX + courtW / 2,
        courtY + courtH - 4,
        courtX + courtW / 2,
        courtY + courtH + 8,
        { arrowEnd: 'none' }
      )
    )

    // Players (2-3 zone)
    const players: [number, number, string][] = [
      [courtX + courtW / 2 - 60, courtY + 100, 'PF'],
      [courtX + courtW / 2 + 60, courtY + 100, 'PF'],
      [courtX + courtW / 2 - 80, courtY + 200, 'C'],
      [courtX + courtW / 2, courtY + 220, 'C'],
      [courtX + courtW / 2 + 80, courtY + 200, 'C']
    ]
    for (const [x, y, label] of players) {
      items.push(ellipse(x - 18, y - 18, 36, 36, { text: label }))
    }

    items.push(note(580, 40, 160, 80, { text: 'Protect the paint' }))
    items.push(note(580, 130, 160, 80, { text: 'Close out shooters' }))
    items.push(note(580, 220, 160, 80, { text: 'Box out on rebounds' }))
    items.push(note(580, 310, 160, 80, { text: 'Communicate switches' }))

    return items
  }
}

const BASKETBALL_BLANK: Template = {
  id: 'basketball-blank',
  category: 'basketball',
  name: 'Blank Court',
  description: 'Empty half-court for your own plays',
  build: () => {
    const items: BoardScopedItem[] = []
    const courtX = 40,
      courtY = 40,
      courtW = 520,
      courtH = 360

    items.push(rect(courtX, courtY, courtW, courtH, { fill: '#fde68a', order: ORDER.background }))
    items.push(
      rect(courtX + courtW / 2 - 80, courtY + courtH - 160, 160, 160, {
        fill: 'none',
        order: ORDER.markings
      })
    )
    items.push({
      ...ellipse(courtX + courtW / 2 - 130, courtY + courtH - 280, 260, 280, { fill: 'none' }),
      order: ORDER.markings
    })
    items.push(
      connector(
        courtX + courtW / 2,
        courtY + courtH - 4,
        courtX + courtW / 2,
        courtY + courtH + 8,
        { arrowEnd: 'none' }
      )
    )

    items.push(note(580, 40, 160, 80, { text: 'Draw your play' }))

    return items
  }
}

// ── Marketing Templates ─────────────────────────────────────────

const MARKETING_SWOT: Template = {
  id: 'marketing-swot',
  category: 'marketing',
  name: 'SWOT Analysis',
  description: '2x2 matrix for strengths, weaknesses, opportunities, threats',
  build: () => {
    const items: BoardScopedItem[] = []
    const gridX = 60,
      gridY = 80,
      cellW = 240,
      cellH = 150

    items.push(text(60, 30, 400, 40, 'SWOT Analysis', 24))
    // Quadrants
    items.push(
      rect(gridX, gridY, cellW, cellH, {
        fill: '#bbf7d0',
        text: 'Strengths',
        order: ORDER.background
      })
    )
    items.push(
      rect(gridX + cellW + 20, gridY, cellW, cellH, {
        fill: '#fecaca',
        text: 'Weaknesses',
        order: ORDER.background
      })
    )
    items.push(
      rect(gridX, gridY + cellH + 20, cellW, cellH, {
        fill: '#bfdbfe',
        text: 'Opportunities',
        order: ORDER.background
      })
    )
    items.push(
      rect(gridX + cellW + 20, gridY + cellH + 20, cellW, cellH, {
        fill: '#fed7aa',
        text: 'Threats',
        order: ORDER.background
      })
    )

    items.push(note(gridX + 10, gridY + 40, cellW - 20, 80, { text: 'Strong community' }))
    items.push(note(gridX + cellW + 30, gridY + 40, cellW - 20, 80, { text: 'Limited budget' }))
    items.push(note(gridX + 10, gridY + cellH + 60, cellW - 20, 80, { text: 'New market' }))
    items.push(
      note(gridX + cellW + 30, gridY + cellH + 60, cellW - 20, 80, { text: 'Competitor launch' })
    )

    return items
  }
}

const MARKETING_FUNNEL: Template = {
  id: 'marketing-funnel',
  category: 'marketing',
  name: 'Campaign Funnel',
  description: 'Linear funnel from awareness to retention',
  build: () => {
    const items: BoardScopedItem[] = []
    const x = 60,
      y = 80,
      w = 200,
      h = 60,
      gap = 20

    items.push(text(60, 30, 400, 40, 'Campaign Funnel', 24))
    const stages = ['Awareness', 'Consideration', 'Conversion', 'Retention']
    const colors = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6']
    for (let i = 0; i < stages.length; i++) {
      items.push(
        rect(x + i * 30, y + i * (h + gap), w - i * 20, h, {
          fill: colors[i],
          text: stages[i],
          order: ORDER.background
        })
      )
    }

    return items
  }
}

const MARKETING_JOURNEY: Template = {
  id: 'marketing-journey',
  category: 'marketing',
  name: 'User Journey',
  description: 'Journey map from discovery to return',
  build: () => {
    const items: BoardScopedItem[] = []
    const y = 120

    items.push(text(60, 30, 400, 40, 'User Journey', 24))
    const stages = ['Discover', 'Sign Up', 'First Success', 'Return User']
    for (let i = 0; i < stages.length; i++) {
      const x = 60 + i * 150
      items.push(rect(x, y, 120, 60, { fill: '#e0e7ff', text: stages[i] }))
      if (i < stages.length - 1) {
        items.push(connector(x + 120, y + 30, x + 150, y + 30))
      }
    }

    return items
  }
}

// ── Product Templates ───────────────────────────────────────────

const PRODUCT_ROADMAP: Template = {
  id: 'product-roadmap',
  category: 'product',
  name: 'Product Roadmap',
  description: 'Quarterly timeline with milestones',
  build: () => {
    const items: BoardScopedItem[] = []
    const y = 100

    items.push(text(60, 30, 400, 40, 'Product Roadmap', 24))
    const quarters = ['Q1 MVP', 'Q2 Beta', 'Q3 Public Launch', 'Q4 Scale']
    const colors = ['#bbf7d0', '#bfdbfe', '#ddd6fe', '#fed7aa']
    for (let i = 0; i < quarters.length; i++) {
      const x = 60 + i * 140
      items.push(rect(x, y, 120, 80, { fill: colors[i], text: quarters[i] }))
      if (i < quarters.length - 1) {
        items.push(connector(x + 120, y + 40, x + 140, y + 40))
      }
    }

    return items
  }
}

const PRODUCT_PRIORITIZATION: Template = {
  id: 'product-prioritization',
  category: 'product',
  name: 'Feature Prioritization',
  description: 'Priority matrix for feature planning',
  build: () => {
    const items: BoardScopedItem[] = []
    const x = 60,
      y = 80,
      w = 240,
      h = 80

    items.push(text(60, 30, 400, 40, 'Feature Prioritization', 24))
    const priorities = ['Must Have', 'Should Have', 'Nice to Have', 'Future Ideas']
    const colors = ['#fecaca', '#fed7aa', '#fef3c7', '#e5e7eb']
    for (let i = 0; i < priorities.length; i++) {
      items.push(rect(x, y + i * (h + 15), w * 2 + 20, h, { fill: colors[i], text: priorities[i] }))
    }

    return items
  }
}

const PRODUCT_STORY_MAP: Template = {
  id: 'product-story-map',
  category: 'product',
  name: 'User Story Mapping',
  description: 'Story map with goals, activities, and stories',
  build: () => {
    const items: BoardScopedItem[] = []

    items.push(text(60, 30, 500, 40, 'User Story Mapping', 24))
    // Headers
    const headers = ['User Goal', 'Key Activities', 'User Stories', 'Next Release']
    for (let i = 0; i < headers.length; i++) {
      items.push(rect(60 + i * 150, 80, 130, 40, { fill: '#e5e7eb', text: headers[i] }))
    }
    // Rows
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        items.push(rect(60 + col * 150, 140 + row * 70, 130, 50, { fill: '#f3f4f6' }))
      }
    }

    return items
  }
}

const PRODUCT_LEAN: Template = {
  id: 'product-lean',
  category: 'product',
  name: 'Lean Canvas',
  description: '9-block lean startup canvas',
  build: () => {
    const items: BoardScopedItem[] = []
    const x = 40,
      y = 80,
      w = 160,
      h = 120

    items.push(text(60, 30, 400, 40, 'Lean Canvas', 24))
    const blocks = [
      ['Problem', 0, 0],
      ['Solution', 1, 0],
      ['Unique Value', 2, 0],
      ['Unfair Advantage', 3, 0],
      ['Customer Segments', 4, 0],
      ['Key Metrics', 0, 1],
      ['Channels', 1, 1],
      ['Cost Structure', 2, 1],
      ['Revenue Streams', 3, 1]
    ] as const
    for (const [label, col, row] of blocks) {
      items.push(
        rect(x + col * (w + 10), y + row * (h + 10), w, h, { fill: '#f3f4f6', text: label })
      )
    }

    return items
  }
}

// ── Strategy Templates ──────────────────────────────────────────

const STRATEGY_BMC: Template = {
  id: 'strategy-bmc',
  category: 'strategy',
  name: 'Business Model Canvas',
  description: '9-block business model canvas',
  build: () => {
    const items: BoardScopedItem[] = []
    const x = 40,
      y = 80,
      w = 160,
      h = 120

    items.push(text(60, 30, 500, 40, 'Business Model Canvas', 24))
    const blocks = [
      ['Key Partners', 0, 0],
      ['Key Activities', 1, 0],
      ['Value Proposition', 2, 0],
      ['Customer Relationships', 3, 0],
      ['Customer Segments', 4, 0],
      ['Key Resources', 1, 1],
      ['Channels', 3, 1],
      ['Cost Structure', 0, 2],
      ['Revenue Streams', 4, 2]
    ] as const
    for (const [label, col, row] of blocks) {
      items.push(
        rect(x + col * (w + 10), y + row * (h + 10), w, h, { fill: '#e0e7ff', text: label })
      )
    }

    return items
  }
}

const STRATEGY_QUARTERLY: Template = {
  id: 'strategy-quarterly',
  category: 'strategy',
  name: 'Quarterly Planning',
  description: 'QBR layout with objectives and metrics',
  build: () => {
    const items: BoardScopedItem[] = []

    items.push(text(60, 30, 400, 40, 'Quarterly Planning', 24))
    const sections = ['Objectives', 'Key Deliverables', 'Risks', 'Success Metrics']
    const colors = ['#bfdbfe', '#bbf7d0', '#fed7aa', '#ddd6fe']
    for (let i = 0; i < sections.length; i++) {
      const x = 60 + (i % 2) * 260
      const y = 80 + Math.floor(i / 2) * 160
      items.push(rect(x, y, 240, 130, { fill: colors[i], text: sections[i] }))
    }

    return items
  }
}

const STRATEGY_OKRS: Template = {
  id: 'strategy-okrs',
  category: 'strategy',
  name: 'OKRs',
  description: 'Objective and key results layout',
  build: () => {
    const items: BoardScopedItem[] = []

    items.push(text(60, 30, 400, 40, 'OKRs', 24))
    // Objective
    items.push(
      rect(60, 80, 500, 60, { fill: '#bfdbfe', text: 'Objective: Improve user retention' })
    )
    // Key Results
    items.push(note(60, 160, 150, 60, { text: 'Increase DAU 20%' }))
    items.push(note(220, 160, 150, 60, { text: 'Launch onboarding' }))
    items.push(note(380, 160, 150, 60, { text: 'Reduce churn' }))

    return items
  }
}

// ── Startup Templates ───────────────────────────────────────────

const STARTUP_IDEA: Template = {
  id: 'startup-idea',
  category: 'startup',
  name: 'Idea Canvas',
  description: 'Lean validation canvas',
  build: () => {
    const items: BoardScopedItem[] = []
    const x = 60,
      y = 80,
      w = 240,
      h = 100

    items.push(text(60, 30, 400, 40, 'Idea Canvas', 24))
    const blocks = [
      ['Problem', 0, 0],
      ['Solution', 1, 0],
      ['Users', 0, 1],
      ['Why Now?', 1, 1]
    ] as const
    for (const [label, col, row] of blocks) {
      items.push(
        rect(x + col * (w + 20), y + row * (h + 20), w, h, { fill: '#e0e7ff', text: label })
      )
    }

    return items
  }
}

const STARTUP_CRAZY8: Template = {
  id: 'startup-crazy8',
  category: 'startup',
  name: 'Crazy 8s',
  description: 'Rapid ideation sketching',
  build: () => {
    const items: BoardScopedItem[] = []

    items.push(text(60, 30, 400, 40, 'Crazy 8s', 24))
    items.push(text(60, 80, 500, 30, 'One idea per minute', 14))
    // 8 boxes for sketching
    for (let i = 0; i < 8; i++) {
      const x = 60 + (i % 4) * 140
      const y = 130 + Math.floor(i / 4) * 130
      items.push(rect(x, y, 120, 110, { fill: '#f3f4f6' }))
    }

    return items
  }
}

const STARTUP_ARCHITECTURE: Template = {
  id: 'startup-architecture',
  category: 'startup',
  name: 'System Architecture',
  description: 'High-level tech architecture diagram',
  build: () => {
    const items: BoardScopedItem[] = []
    const boxW = 140,
      boxH = 70

    items.push(text(60, 30, 400, 40, 'System Architecture', 24))
    // Components
    items.push(rect(60, 100, boxW, boxH, { fill: '#ddd6fe', text: 'Frontend' }))
    items.push(rect(260, 100, boxW, boxH, { fill: '#bfdbfe', text: 'Backend' }))
    items.push(rect(160, 220, boxW, boxH, { fill: '#bbf7d0', text: 'Database' }))
    items.push(rect(360, 220, boxW, boxH, { fill: '#fed7aa', text: 'External APIs' }))
    // Arrows
    items.push(connector(200, 170, 260, 170))
    items.push(connector(200, 170, 160, 220))
    items.push(connector(330, 170, 230, 220))
    items.push(connector(330, 170, 360, 220))

    return items
  }
}

const STARTUP_PITCH: Template = {
  id: 'startup-pitch',
  category: 'startup',
  name: 'Pitch Flow',
  description: 'Pitch deck flow from problem to ask',
  build: () => {
    const items: BoardScopedItem[] = []
    const y = 120

    items.push(text(60, 30, 400, 40, 'Pitch Flow', 24))
    const stages = ['Problem', 'Solution', 'Demo', 'Business Model', 'Ask']
    for (let i = 0; i < stages.length; i++) {
      const x = 60 + i * 120
      items.push(rect(x, y, 100, 60, { fill: '#e0e7ff', text: stages[i] }))
      if (i < stages.length - 1) {
        items.push(connector(x + 100, y + 30, x + 120, y + 30))
      }
    }

    return items
  }
}

const STARTUP_MVP: Template = {
  id: 'startup-mvp',
  category: 'startup',
  name: 'MVP Planning',
  description: 'Feature planning for minimum viable product',
  build: () => {
    const items: BoardScopedItem[] = []

    items.push(text(60, 30, 400, 40, 'MVP Planning', 24))
    const sections = ['Core Features', 'Stretch Goals', 'Demo Checklist', 'Nice to Have']
    const colors = ['#bbf7d0', '#bfdbfe', '#ddd6fe', '#e5e7eb']
    for (let i = 0; i < sections.length; i++) {
      const x = 60 + (i % 2) * 260
      const y = 80 + Math.floor(i / 2) * 140
      items.push(rect(x, y, 240, 110, { fill: colors[i], text: sections[i] }))
    }

    return items
  }
}

const STARTUP_TASKBOARD: Template = {
  id: 'startup-taskboard',
  category: 'startup',
  name: 'Task Board',
  description: 'Simple task board with columns',
  build: () => {
    const items: BoardScopedItem[] = []
    const colW = 130,
      colH = 250,
      gap = 20

    items.push(text(60, 30, 400, 40, 'Task Board', 24))
    const columns = ['To Do', 'In Progress', 'Review', 'Done']
    const colors = ['#e5e7eb', '#fef3c7', '#bfdbfe', '#bbf7d0']
    for (let i = 0; i < columns.length; i++) {
      const x = 60 + i * (colW + gap)
      items.push(rect(x, 80, colW, 40, { fill: colors[i], text: columns[i] }))
      items.push(rect(x, 130, colW, colH, { fill: '#f9fafb' }))
    }
    // Example cards
    items.push(note(70, 140, 110, 50, { text: 'Build login' }))
    items.push(note(200, 140, 110, 50, { text: 'Connect API' }))
    items.push(note(330, 140, 110, 50, { text: 'Polish UI' }))
    items.push(note(460, 140, 110, 50, { text: 'Ship MVP' }))

    return items
  }
}

// ── General Templates ───────────────────────────────────────────

const GENERAL_FLOWCHART: Template = {
  id: 'general-flowchart',
  category: 'general',
  name: 'Flowchart',
  description: 'Basic flowchart with decision points',
  build: () => {
    const items: BoardScopedItem[] = []
    const y = 100

    items.push(text(60, 30, 400, 40, 'Flowchart', 24))
    // Start
    items.push({
      ...ellipse(60, y, 100, 50, { fill: '#bbf7d0', text: 'Start' }),
      order: ORDER.shapes
    })
    // Decision
    items.push({
      ...rect(200, y - 10, 120, 70, { fill: '#fef3c7', text: 'Decision' }),
      order: ORDER.shapes
    })
    // Process
    items.push(rect(360, y, 120, 50, { fill: '#bfdbfe', text: 'Process' }))
    // End
    items.push({
      ...ellipse(520, y, 100, 50, { fill: '#fecaca', text: 'End' }),
      order: ORDER.shapes
    })
    // Arrows
    items.push(connector(160, y + 25, 200, y + 25))
    items.push(connector(320, y + 25, 360, y + 25))
    items.push(connector(480, y + 25, 520, y + 25))

    return items
  }
}

const GENERAL_KANBAN: Template = {
  id: 'general-kanban',
  category: 'general',
  name: 'Kanban',
  description: 'Task board with columns and example cards',
  build: () => {
    const items: BoardScopedItem[] = []
    const colW = 130,
      colH = 250,
      gap = 20

    items.push(text(60, 30, 400, 40, 'Kanban', 24))
    const columns = ['Backlog', 'To Do', 'Doing', 'Done']
    const colors = ['#e5e7eb', '#fef3c7', '#bfdbfe', '#bbf7d0']
    for (let i = 0; i < columns.length; i++) {
      const x = 60 + i * (colW + gap)
      items.push(rect(x, 80, colW, 40, { fill: colors[i], text: columns[i] }))
      items.push(rect(x, 130, colW, colH, { fill: '#f9fafb' }))
    }
    // Example cards
    items.push(note(70, 140, 110, 50, { text: 'Design UI' }))
    items.push(note(70, 200, 110, 50, { text: 'Write docs' }))
    items.push(note(200, 140, 110, 50, { text: 'Ship MVP' }))

    return items
  }
}

const GENERAL_TIMELINE: Template = {
  id: 'general-timeline',
  category: 'general',
  name: 'Timeline',
  description: 'Project timeline with milestones',
  build: () => {
    const items: BoardScopedItem[] = []
    const y = 120

    items.push(text(60, 30, 400, 40, 'Timeline', 24))
    // Timeline line
    items.push(connector(60, y + 25, 560, y + 25, { arrowEnd: 'none' }))
    // Milestones
    const milestones = ['Kickoff', 'Prototype', 'Testing', 'Launch']
    for (let i = 0; i < milestones.length; i++) {
      const x = 100 + i * 130
      items.push({ ...ellipse(x - 15, y + 10, 30, 30, { fill: '#3b82f6' }), order: ORDER.shapes })
      items.push(text(x - 40, y + 50, 80, 30, milestones[i], 12))
    }

    return items
  }
}

// ── Export ──────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [
  // Football
  FOOTBALL_442,
  FOOTBALL_433,
  FOOTBALL_CORNER,
  FOOTBALL_FREEKICK,
  FOOTBALL_BLANK,
  // Basketball
  BASKETBALL_ZONE,
  BASKETBALL_BLANK,
  // Marketing
  MARKETING_SWOT,
  MARKETING_FUNNEL,
  MARKETING_JOURNEY,
  // Product
  PRODUCT_ROADMAP,
  PRODUCT_PRIORITIZATION,
  PRODUCT_STORY_MAP,
  PRODUCT_LEAN,
  // Strategy
  STRATEGY_BMC,
  STRATEGY_QUARTERLY,
  STRATEGY_OKRS,
  // Startup
  STARTUP_IDEA,
  STARTUP_CRAZY8,
  STARTUP_ARCHITECTURE,
  STARTUP_PITCH,
  STARTUP_MVP,
  STARTUP_TASKBOARD,
  // General
  GENERAL_FLOWCHART,
  GENERAL_KANBAN,
  GENERAL_TIMELINE
]

export function getTemplateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id)
}

export const TEMPLATE_BOARD_ID_PLACEHOLDER = '__placeholder__'
