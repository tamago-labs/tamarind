// In-place text editor rendered inside a shape's `<foreignObject>`.
// Used by Rect and Ellipse to add an optional text caption. The
// text colour follows the shape's stroke so the panel stays visually
// consistent with the rest of the canvas theme.
//
// Behaviour:
//   • Double-click on the text region → enter edit mode (textarea).
//   • Enter in single-line mode, Cmd/Ctrl+Enter in multi-line → commit.
//   • Esc → cancel and revert to the previous text.
//   • The text adapts to the shape's bounding box: padding is 8/10,
//     line height 1.3, font-size is `item.fontSize`.
//
// Edits dispatch through the parent's `onUpdate` callback. Inside a
// drag, `onUpdate` is wrapped to dispatch transient (so the
// history stack isn't polluted per-keystroke during a move).

import { useEffect, useRef, useState } from 'react'
import type { BoardScopedItem } from '../types'
import { DEFAULT_NOTE_FONT_SIZE } from '../types'

interface TextOverlayProps {
  item: BoardScopedItem
  width: number
  height: number
  onUpdate: (patch: Partial<BoardScopedItem>) => void
}

export function TextOverlay({ item, width, height, onUpdate }: TextOverlayProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text ?? '')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Keep the draft in sync with `item.text` when external changes
  // (drawer textarea, undo, peer update) come in while we're not
  // editing. Avoids clobbering an in-progress edit.
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
    if (draft !== (item.text ?? '')) onUpdate({ text: draft })
  }

  function cancel() {
    setEditing(false)
    setDraft(item.text ?? '')
  }

  const fontSize = item.fontSize ?? DEFAULT_NOTE_FONT_SIZE
  const textColor = item.stroke ?? '#000000'

  return (
    <foreignObject x={item.x} y={item.y} width={width} height={height}>
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
            background: 'transparent',
            border: 'none',
            color: textColor,
            fontSize,
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
            color: textColor,
            fontSize,
            fontFamily: 'var(--font-display)',
            lineHeight: 1.3,
            overflow: 'hidden',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            cursor: 'text'
          }}
        >
          {item.text}
        </div>
      )}
    </foreignObject>
  )
}
