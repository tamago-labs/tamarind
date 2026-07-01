// CanvasContent renders the things that live *inside* the world div, so
// they pan and zoom together with the world transform applied in
// <CanvasPage>. The dot/line grid lives on the surface <main> as a
// fixed viewport reference; this file draws the soccer pitch
// (markings + tokens) in world space on top of it.

interface Token {
  id: string
  x: number
  y: number
  label: string
  team: 'home' | 'away'
}

const PITCH_WIDTH = 1050
const PITCH_HEIGHT = 680

// 4-3-3 home formation with three opponent players, laid out in world
// coordinates inside the pitch.
const TOKENS: Token[] = [
  { id: 'gk', x: 50, y: 340, label: 'GK', team: 'home' },
  { id: 'lb', x: 200, y: 100, label: 'LB', team: 'home' },
  { id: 'lcb', x: 200, y: 260, label: 'CB', team: 'home' },
  { id: 'rcb', x: 200, y: 420, label: 'CB', team: 'home' },
  { id: 'rb', x: 200, y: 580, label: 'RB', team: 'home' },
  { id: 'lcm', x: 410, y: 170, label: 'CM', team: 'home' },
  { id: 'cm', x: 410, y: 340, label: 'CM', team: 'home' },
  { id: 'rcm', x: 410, y: 510, label: 'CM', team: 'home' },
  { id: 'lw', x: 650, y: 90, label: 'LW', team: 'home' },
  { id: 'st', x: 720, y: 340, label: 'ST', team: 'home' },
  { id: 'rw', x: 650, y: 590, label: 'RW', team: 'home' },
  { id: 'a1', x: 900, y: 220, label: '1', team: 'away' },
  { id: 'a2', x: 950, y: 340, label: '2', team: 'away' },
  { id: 'a3', x: 900, y: 460, label: '3', team: 'away' }
]

function PitchMarkings() {
  return (
    <svg
      className='pointer-events-none absolute inset-0'
      width={PITCH_WIDTH}
      height={PITCH_HEIGHT}
      viewBox={`0 0 ${PITCH_WIDTH} ${PITCH_HEIGHT}`}
      aria-hidden='true'
    >
      {/* Turf stripes — alternating subtle bands for depth */}
      {Array.from({ length: 10 }).map((_, i) => (
        <rect
          key={`stripe-${i}`}
          x={i * (PITCH_WIDTH / 10)}
          y={0}
          width={PITCH_WIDTH / 10}
          height={PITCH_HEIGHT}
          fill={i % 2 === 0 ? 'rgba(255, 255, 255, 0.5)' : 'transparent'}
        />
      ))}
      {/* Pitch outline */}
      <rect
        x={1}
        y={1}
        width={PITCH_WIDTH - 2}
        height={PITCH_HEIGHT - 2}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Halfway line */}
      <line
        x1={PITCH_WIDTH / 2}
        y1={0}
        x2={PITCH_WIDTH / 2}
        y2={PITCH_HEIGHT}
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Center circle */}
      <circle
        cx={PITCH_WIDTH / 2}
        cy={PITCH_HEIGHT / 2}
        r={70}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Center spot */}
      <circle cx={PITCH_WIDTH / 2} cy={PITCH_HEIGHT / 2} r={3} fill='#0e4f15' />
      {/* Home penalty box */}
      <rect
        x={0}
        y={PITCH_HEIGHT / 2 - 165}
        width={150}
        height={330}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Home goal area */}
      <rect
        x={0}
        y={PITCH_HEIGHT / 2 - 80}
        width={50}
        height={160}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Away penalty box */}
      <rect
        x={PITCH_WIDTH - 150}
        y={PITCH_HEIGHT / 2 - 165}
        width={150}
        height={330}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
      {/* Away goal area */}
      <rect
        x={PITCH_WIDTH - 50}
        y={PITCH_HEIGHT / 2 - 80}
        width={50}
        height={160}
        fill='none'
        stroke='#0e4f15'
        strokeWidth={2}
      />
    </svg>
  )
}

function TokenDot({ token }: { token: Token }) {
  const isHome = token.team === 'home'
  const bg = isHome ? 'bg-tamarind-700' : 'bg-red-600'
  const border = isHome ? 'border-tamarind-900' : 'border-red-800'
  return (
    <div
      className={`absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 ${bg} ${border} text-xs font-bold text-white shadow-md`}
      style={{ left: token.x, top: token.y }}
      aria-label={`${isHome ? 'Home' : 'Away'} token ${token.label}`}
    >
      {token.label}
    </div>
  )
}

export function CanvasContent() {
  return (
    <div className='absolute' style={{ left: 0, top: 0, width: PITCH_WIDTH, height: PITCH_HEIGHT }}>
      <PitchMarkings />
      {TOKENS.map((t) => (
        <TokenDot key={t.id} token={t} />
      ))}
    </div>
  )
}

export { PITCH_WIDTH, PITCH_HEIGHT }
