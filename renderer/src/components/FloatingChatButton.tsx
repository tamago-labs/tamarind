// FloatingChatButton — round floating action button for opening
// chat panels. Sits at the bottom-left (AI) or bottom-right (Team)
// of the canvas viewport.

import type { ReactNode } from 'react'

interface FloatingChatButtonProps {
  onClick: () => void
  label: string
  side: 'left' | 'right'
  active?: boolean
  badge?: number
  children: ReactNode
}

export function FloatingChatButton({
  onClick,
  label,
  side,
  active = false,
  badge,
  children
}: FloatingChatButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`fixed bottom-12 ${side === 'left' ? 'left-4' : 'right-4'} z-30 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition ${
        active
          ? 'bg-tamarind-600 text-white hover:bg-tamarind-700'
          : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-800'
      }`}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className='absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white'>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
