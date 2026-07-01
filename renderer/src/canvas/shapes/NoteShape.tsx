import { useEffect, useRef, useState } from 'react'
import type { BoardScopedItem } from '../types'
import { DEFAULT_NOTE_FONT_SIZE, DEFAULT_NOTE_TEXT } from '../types'

interface NoteShapeProps {
  item: BoardScopedItem
  onUpdate: (patch: Partial<BoardScopedItem>) => void
}

export function NoteShape({ item, onUpdate }: NoteShapeProps) {
  if (item.type !== 'note') return null
  const w = item.w ?? 160
  const h = item.h ?? 100
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Keep the draft in sync with item.text when external changes
  // (e.g. drawer textarea) come in while we're not editing.
  useEffect(() => {
    if (!editing) setDraft(item.text ?? '')
  }, [item.text, editing])

  // Auto-focus + select-all when entering edit mode.
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [editing])

  function commit() {
    setEditing(false)
    if (draft !== item.text) onUpdate({ text: draft })
  }

  function cancel() {
    setEditing(false)
    setDraft(item.text ?? '')
  }

  return (
    <foreignObject x={item.x} y={item.y} width={w} height={h}>
      {editing ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit()
            }
            // Stop keydown from reaching the global Delete handler on
            // CanvasPage (which would otherwise remove the shape on
            // backspace while editing).
            e.stopPropagation()
          }}
          style={{
            width: '100%',
            height: '100%',
            padding: '8px 10px',
            background: item.fill ?? 'rgba(253,246,236,0.9)',
            border: `${item.strokeWidth}px solid ${item.stroke}`,
            borderRadius: 4,
            color: item.stroke,
            fontSize: item.fontSize ?? DEFAULT_NOTE_FONT_SIZE,
            fontFamily: 'var(--font-display)',
            lineHeight: 1.3,
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box'
          }}
        />
      ) : (
        <div
          onDoubleClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          style={{
            width: '100%',
            height: '100%',
            padding: '8px 10px',
            background: item.fill ?? 'rgba(253,246,236,0.9)',
            border: `${item.strokeWidth}px solid ${item.stroke}`,
            borderRadius: 4,
            color: item.stroke,
            fontSize: item.fontSize ?? DEFAULT_NOTE_FONT_SIZE,
            fontFamily: 'var(--font-display)',
            lineHeight: 1.3,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            cursor: 'text'
          }}
        >
          {item.text || DEFAULT_NOTE_TEXT}
        </div>
      )}
    </foreignObject>
  )
}
