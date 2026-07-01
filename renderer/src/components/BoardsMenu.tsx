// Toolbar dropdown for switching the active board + creating/renaming
// boards. Renders next to the marquee selector; collapses to a single
// "Board: <current name>" button.
//
// Selection state lives in the canvas reducer (`activeBoardId`); the
// host of this component dispatches `set-active`, `add-board`, and
// `rename-board` actions and mirrors them through the worker.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import type { Board } from '../canvas/types'

interface BoardsMenuProps {
  boards: Board[]
  activeBoardId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function BoardsMenu({
  boards,
  activeBoardId,
  onSelect,
  onAdd,
  onRename,
  onDelete
}: BoardsMenuProps) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the menu on outside click / Escape so keyboard nav works
  // without leaving the menu trapped open.
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

  const activeBoard = boards.find((b) => b.id === activeBoardId)
  const label = activeBoard?.name ?? 'Untitled'

  function startEdit(board: Board) {
    setEditingId(board.id)
    setDraftName(board.name)
  }

  function commitEdit() {
    if (!editingId) return
    onRename(editingId, draftName.trim() || 'Untitled')
    setEditingId(null)
    setDraftName('')
  }

  return (
    <div ref={containerRef} className='relative'>
      <button
        type='button'
        onClick={() => setOpen((v) => !v)}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-label={`Boards — currently ${label}`}
        className='inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500'
      >
        <span className='max-w-32 truncate font-medium'>{label}</span>
        <ChevronDown className='h-3.5 w-3.5' aria-hidden='true' />
      </button>
      {open && (
        <div
          role='listbox'
          aria-label='Boards'
          className='absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-md border border-gray-200 bg-white shadow-md'
        >
          {boards.length === 0 ? (
            <p className='p-3 text-xs text-gray-500'>No boards yet.</p>
          ) : (
            <ul className='divide-y divide-gray-100'>
              {boards.map((b) => (
                <li key={b.id} className='flex items-center gap-1 px-2 py-1 text-xs text-gray-700'>
                  {editingId === b.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitEdit()
                        } else if (e.key === 'Escape') {
                          setEditingId(null)
                          setDraftName('')
                        }
                      }}
                      aria-label='Rename board'
                      className='h-7 flex-1 rounded border border-blue-500 px-1 focus:outline-none'
                    />
                  ) : (
                    <>
                      <button
                        type='button'
                        onClick={() => {
                          onSelect(b.id)
                          setOpen(false)
                        }}
                        aria-selected={b.id === activeBoardId}
                        className={
                          b.id === activeBoardId
                            ? 'h-7 flex-1 truncate rounded bg-blue-50 px-2 text-left font-medium text-blue-700'
                            : 'h-7 flex-1 truncate rounded px-2 text-left hover:bg-gray-100'
                        }
                      >
                        {b.name}
                      </button>
                      <button
                        type='button'
                        onClick={() => startEdit(b)}
                        aria-label={`Rename board ${b.name}`}
                        className='inline-flex h-7 w-7 items-center justify-center rounded text-gray-500 transition hover:bg-gray-100'
                      >
                        <Pencil className='h-3 w-3' aria-hidden='true' />
                      </button>
                      {boards.length > 1 && (
                        <button
                          type='button'
                          onClick={() => {
                            if (confirm(`Delete board "${b.name}" and all its shapes?`)) {
                              onDelete(b.id)
                            }
                          }}
                          aria-label={`Delete board ${b.name}`}
                          className='inline-flex h-7 w-7 items-center justify-center rounded text-red-600 transition hover:bg-red-50'
                        >
                          <Trash2 className='h-3 w-3' aria-hidden='true' />
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            type='button'
            onClick={() => {
              onAdd()
              setOpen(false)
            }}
            aria-label='Add new board'
            className='flex w-full items-center gap-1 border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100'
          >
            <Plus className='h-3.5 w-3.5' aria-hidden='true' />
            New board
          </button>
        </div>
      )}
    </div>
  )
}
