// Per-template inline SVG thumbnails. Hand-rolled miniatures — not
// auto-rendered from the BoardScopedItem array (that would need a
// headless SVG renderer which is out of scope for v1).
//
// All thumbnails share `viewBox='0 0 160 100'` so the modal grid stays
// visually consistent. Stroke/fill colors mirror the actual template
// styles so the user can match thumbnail to result at a glance.

import type { CSSProperties, ReactElement } from 'react'

const stroke = '#1f2937' // gray-800
const fill = 'none'

// Center circle for the football thumbnail.
function FootballThumb() {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      {/* Pitch background — matches the green tint of the actual football template. */}
      <rect x={6} y={10} width={148} height={80} fill='#86efac' stroke={stroke} strokeWidth={1} />
      <line x1={80} y1={10} x2={80} y2={90} stroke={stroke} strokeWidth={1} />
      <ellipse cx={80} cy={50} rx={14} ry={10} fill={fill} stroke={stroke} strokeWidth={1} />
      {/* 11 player dots, same formation as the template. */}
      <circle cx={80} cy={84} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={32} cy={70} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={62} cy={70} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={98} cy={70} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={128} cy={70} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={50} cy={50} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={50} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={110} cy={50} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={80} cy={28} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={32} cy={28} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={128} cy={28} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function BasketballThumb() {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      <rect x={6} y={10} width={148} height={80} fill='#fde68a' stroke={stroke} strokeWidth={1} />
      {/* key */}
      <rect x={60} y={50} width={40} height={40} fill={fill} stroke={stroke} strokeWidth={1} />
      {/* hoop */}
      <line x1={80} y1={86} x2={80} y2={90} stroke={stroke} strokeWidth={2} />
      {/* 3pt arc (top half of an ellipse) */}
      <path d='M 28 90 A 52 56 0 0 1 132 90' fill={fill} stroke={stroke} strokeWidth={1} />
      {/* 5 players */}
      <circle cx={80} cy={20} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={60} cy={32} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={100} cy={32} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={70} cy={45} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
      <circle cx={90} cy={45} r={3} fill='#ffffff' stroke={stroke} strokeWidth={1} />
    </svg>
  )
}

function SalesThumb() {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      {/* 4 stages + 3 arrows */}
      <rect x={6} y={30} width={28} height={24} fill='#dbeafe' stroke={stroke} strokeWidth={1} />
      <rect x={44} y={30} width={28} height={24} fill='#fef3c7' stroke={stroke} strokeWidth={1} />
      <rect x={82} y={30} width={28} height={24} fill='#fde68a' stroke={stroke} strokeWidth={1} />
      <rect x={120} y={30} width={28} height={24} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      <line x1={34} y1={42} x2={44} y2={42} stroke={stroke} strokeWidth={1.5} />
      <line x1={72} y1={42} x2={82} y2={42} stroke={stroke} strokeWidth={1.5} />
      <line x1={110} y1={42} x2={120} y2={42} stroke={stroke} strokeWidth={1.5} />
    </svg>
  )
}

function HackathonThumb() {
  return (
    <svg viewBox='0 0 160 100' className='h-full w-full' aria-hidden='true'>
      {/* 4 boxes in a 2x2 layout + arrows */}
      <rect x={10} y={20} width={60} height={26} fill='#ddd6fe' stroke={stroke} strokeWidth={1} />
      <rect x={90} y={20} width={60} height={26} fill='#bfdbfe' stroke={stroke} strokeWidth={1} />
      <rect x={10} y={62} width={60} height={26} fill='#fed7aa' stroke={stroke} strokeWidth={1} />
      <rect x={90} y={62} width={60} height={26} fill='#bbf7d0' stroke={stroke} strokeWidth={1} />
      {/* arrows */}
      <line x1={70} y1={33} x2={90} y2={33} stroke={stroke} strokeWidth={1.5} />
      <line x1={120} y1={46} x2={120} y2={62} stroke={stroke} strokeWidth={1.5} />
      <line x1={70} y1={75} x2={90} y2={75} stroke={stroke} strokeWidth={1.5} />
      <line x1={40} y1={46} x2={40} y2={62} stroke={stroke} strokeWidth={1.5} />
    </svg>
  )
}

const THUMBNAILS: Record<string, () => ReactElement> = {
  football: FootballThumb,
  basketball: BasketballThumb,
  sales: SalesThumb,
  hackathon: HackathonThumb
}

export function TemplateThumbnail({ id, style }: { id: string; style?: CSSProperties }) {
  const Thumb = THUMBNAILS[id]
  if (!Thumb) return null
  return (
    <div className='overflow-hidden rounded-md border border-gray-200 bg-white' style={style}>
      <Thumb />
    </div>
  )
}
