// FloatingChatButton — round floating action button for opening
// chat panels. Used inside a flex container for positioning.

import type { ReactNode } from 'react'

interface FloatingChatButtonProps {
  onClick: () => void
  label: string
  children: ReactNode
}

export function FloatingChatButton({ onClick, label, children }: FloatingChatButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label}
      title={label}
      className='flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-600 shadow-lg transition hover:bg-gray-100 hover:text-gray-800'
    >
      {children}
    </button>
  )
}
