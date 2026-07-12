// Simplified inline SVG thumbnails for each template category.
// All thumbnails share viewBox='0 0 160 100' for visual consistency.

import type { CSSProperties, ReactElement } from 'react'

const stroke = '#1f2937'
const fill = 'none'

// ── Football thumbnails ─────────────────────────────────────────

function FootballThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#86efac' stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={10} x2={80} y2={90} stroke={stroke} strokeWidth={1} />
      <ellipse cx={80} cy={50} rx={14} ry={10} fill={fill} stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={84} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={32} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={62} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={98} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={128} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={50} cy={50} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={50} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={110} cy={50} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={28} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={32} cy={28} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={128} cy={28} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function Football433Thumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#86efac' stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={10} x2={80} y2={90} stroke={stroke} strokeWidth={1} />
      <ellipse cx={80} cy={50} rx={14} ry={10} fill={fill} stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={84} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={32} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={62} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={98} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={128} cy={70} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={55} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={55} cy={45} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={105} cy={45} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={25} cy={25} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={20} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={135} cy={25} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function SetPieceThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#86efac' stroke={stroke} strokeWidth={1} />
      <rect x={100} y={30} width={54} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
      <rect x={150} y={42} width={4} height={16} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={100} cy={80} r={4} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={120} cy={50} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={130} cy={65} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={115} cy={40} r={3} fill='#ef4444' stroke={stroke} strokeWidth={1} />
      <circle cx={125} cy={40} r={3} fill='#ef4444' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function BlankPitchThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#86efac' stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={10} x2={80} y2={90} stroke={stroke} strokeWidth={1} />
      <ellipse cx={80} cy={50} rx={14} ry={10} fill={fill} stroke={stroke} strokeWidth={1} />
      <rect x={6} y={30} width={20} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
      <rect x={134} y={30} width={20} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Basketball thumbnails ───────────────────────────────────────

function BasketballThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#fde68a' stroke={stroke} strokeWidth={1} />
      <rect x={60} y={50} width={40} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={86} x2={80} y2={90} stroke={stroke} strokeWidth={2} />
      <path d='M 28 90 A 52 56 0 0 1 132 90' fill={fill} stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={25} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={60} cy={40} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={100} cy={40} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={50} cy={65} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
      <circle cx={110} cy={65} r={3} fill='#fff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function BlankCourtThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#fde68a' stroke={stroke} strokeWidth={1} />
      <rect x={60} y={50} width={40} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={86} x2={80} y2={90} stroke={stroke} strokeWidth={2} />
      <path d='M 28 90 A 52 56 0 0 1 132 90' fill={fill} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Marketing thumbnails ────────────────────────────────────────

function SWOTThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={72} height={38} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={10} width={72} height={38} fill='#fecaca' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={52} width={72} height={38} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={52} width={72} height={38} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function FunnelThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <polygon points='10,10 150,10 130,30 30,30' fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <polygon points='30,35 130,35 115,55 45,55' fill='#93c5fd' stroke={stroke} strokeWidth={1} />
      <polygon points='45,60 115,60 105,78 55,78' fill='#60a5fa' stroke={stroke} strokeWidth={1} />
      <polygon points='55,83 105,83 95,95 65,95' fill='#3b82f6' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function JourneyThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={35} width={32} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={46} y={35} width={32} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={86} y={35} width={32} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={126} y={35} width={32} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <line
        x1={38}
        y1={50}
        x2={46}
        y2={50}
        stroke={stroke}
        strokeWidth={1}
        markerEnd='url(#arrow)'
      />
      <line x1={78} y1={50} x2={86} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={118} y1={50} x2={126} y2={50} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Product thumbnails ──────────────────────────────────────────

function RoadmapThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={30} width={34} height={40} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={44} y={30} width={34} height={40} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={30} width={34} height={40} fill='#ddd6fe' stroke={stroke} strokeWidth={1} />
      <rect x={120} y={30} width={34} height={40} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
      <line x1={40} y1={50} x2={44} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={78} y1={50} x2={82} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={116} y1={50} x2={120} y2={50} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function PrioritizationThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={148} height={20} fill='#fecaca' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={32} width={148} height={20} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={56} width={148} height={20} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={80} width={148} height={14} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function StoryMapThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={34} height={16} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
      <rect x={44} y={8} width={34} height={16} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={34} height={16} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
      <rect x={120} y={8} width={34} height={16} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
      {[0, 1, 2].map((row) =>
        [0, 1, 2, 3].map((col) => (
          <rect
            key={`${row}-${col}`}
            x={6 + col * 38}
            y={30 + row * 24}
            width={34}
            height={18}
            fill='#f3f4f6'
            stroke={stroke}
            strokeWidth={1}
          />
        ))
      )}
    </svg>
  )
}

function LeanCanvasThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={28} height={38} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={38} y={8} width={28} height={38} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={70} y={8} width={28} height={38} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={102} y={8} width={28} height={38} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={134} y={8} width={22} height={38} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={50} width={28} height={42} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={38} y={50} width={28} height={42} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
      <rect x={70} y={50} width={86} height={42} fill='#f3f4f6' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Strategy thumbnails ─────────────────────────────────────────

function BMCTumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={28} height={84} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={38} y={8} width={28} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={70} y={8} width={28} height={84} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={102} y={8} width={28} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={134} y={8} width={22} height={84} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={38} y={52} width={28} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={102} y={52} width={28} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function QuarterlyThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={72} height={40} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={72} height={40} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={52} width={72} height={40} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={52} width={72} height={40} fill='#ddd6fe' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function OKRSThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={148} height={24} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={38} width={48} height={54} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={58} y={38} width={48} height={54} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={110} y={38} width={44} height={54} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Startup thumbnails ──────────────────────────────────────────

function IdeaCanvasThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={72} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={72} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={52} width={72} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={52} width={72} height={40} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function Crazy8Thumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      {[0, 1, 2, 3].map((col) =>
        [0, 1].map((row) => (
          <rect
            key={`${row}-${col}`}
            x={6 + col * 38}
            y={8 + row * 46}
            width={34}
            height={40}
            fill='#f3f4f6'
            stroke={stroke}
            strokeWidth={1}
          />
        ))
      )}
    </svg>
  )
}

function ArchitectureThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={20} width={36} height={24} fill='#ddd6fe' stroke={stroke} strokeWidth={1} />
      <rect x={62} y={20} width={36} height={24} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={34} y={60} width={36} height={24} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={90} y={60} width={36} height={24} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
      <line x1={42} y1={44} x2={62} y2={44} stroke={stroke} strokeWidth={1} />
      <line x1={42} y1={44} x2={52} y2={60} stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={44} x2={70} y2={60} stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={44} x2={90} y2={60} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function PitchFlowThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={35} width={24} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={36} y={35} width={24} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={66} y={35} width={24} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={96} y={35} width={24} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <rect x={126} y={35} width={28} height={30} fill='#e0e7ff' stroke={stroke} strokeWidth={1} />
      <line x1={30} y1={50} x2={36} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={60} y1={50} x2={66} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={90} y1={50} x2={96} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={120} y1={50} x2={126} y2={50} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function MVPThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={72} height={40} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={72} height={40} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={6} y={52} width={72} height={40} fill='#ddd6fe' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={52} width={72} height={40} fill='#e5e7eb' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function TaskBoardThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={44} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={120} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={10} y={14} width={26} height={12} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={48} y={14} width={26} height={12} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={86} y={14} width={26} height={12} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── General thumbnails ──────────────────────────────────────────

function FlowchartThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <ellipse cx={20} cy={50} rx={16} ry={12} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <rect x={48} y={38} width={32} height={24} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={92} y={38} width={32} height={24} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <ellipse cx={142} cy={50} rx={16} ry={12} fill='#fecaca' stroke={stroke} strokeWidth={1} />
      <line x1={36} y1={50} x2={48} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={50} x2={92} y2={50} stroke={stroke} strokeWidth={1} />
      <line x1={124} y1={50} x2={126} y2={50} stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function KanbanThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={44} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={120} y={8} width={34} height={84} fill='#f9fafb' stroke={stroke} strokeWidth={1} />
      <rect x={10} y={30} width={26} height={12} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={10} y={50} width={26} height={12} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={48} y={30} width={26} height={12} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function TimelineThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <line x1={10} y1={50} x2={150} y2={50} stroke={stroke} strokeWidth={1} />
      <circle cx={30} cy={50} r={6} fill='#3b82f6' stroke={stroke} strokeWidth={1} />
      <circle cx={70} cy={50} r={6} fill='#3b82f6' stroke={stroke} strokeWidth={1} />
      <circle cx={110} cy={50} r={6} fill='#3b82f6' stroke={stroke} strokeWidth={1} />
      <circle cx={150} cy={50} r={6} fill='#3b82f6' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

// ── Thumbnail map ───────────────────────────────────────────────

const THUMBNAIL_MAP: Record<string, () => ReactElement> = {
  'football-442': FootballThumb,
  'football-433': Football433Thumb,
  'football-corner': SetPieceThumb,
  'football-freekick': SetPieceThumb,
  'football-blank': BlankPitchThumb,
  'basketball-zone': BasketballThumb,
  'basketball-blank': BlankCourtThumb,
  'marketing-swot': SWOTThumb,
  'marketing-funnel': FunnelThumb,
  'marketing-journey': JourneyThumb,
  'product-roadmap': RoadmapThumb,
  'product-prioritization': PrioritizationThumb,
  'product-story-map': StoryMapThumb,
  'product-lean': LeanCanvasThumb,
  'strategy-bmc': BMCTumb,
  'strategy-quarterly': QuarterlyThumb,
  'strategy-okrs': OKRSThumb,
  'startup-idea': IdeaCanvasThumb,
  'startup-crazy8': Crazy8Thumb,
  'startup-architecture': ArchitectureThumb,
  'startup-pitch': PitchFlowThumb,
  'startup-mvp': MVPThumb,
  'startup-taskboard': TaskBoardThumb,
  'general-flowchart': FlowchartThumb,
  'general-kanban': KanbanThumb,
  'general-timeline': TimelineThumb
}

// ── Default fallback thumbnail ──────────────────────────────────

function DefaultThumb(): ReactElement {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect
        x={6}
        y={6}
        width={148}
        height={88}
        fill='#f3f4f6'
        stroke={stroke}
        strokeWidth={1}
        rx={4}
      />
      <text x={80} y={54} textAnchor='middle' fill='#9ca3af' fontSize={10} fontFamily='sans-serif'>
        Preview
      </text>
    </svg>
  )
}

// ── Exported component ──────────────────────────────────────────

export function TemplateThumbnail({
  id,
  style
}: {
  id: string
  style?: CSSProperties
}): ReactElement {
  const Thumb = THUMBNAIL_MAP[id] ?? DefaultThumb
  return (
    <div style={style} className='overflow-hidden rounded-md border border-gray-200 bg-white'>
      <Thumb />
    </div>
  )
}
