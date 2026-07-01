// History wrapper around `canvasReducer`.
//
// Pure present-state (one CanvasState) is augmented to `{ past, present,
// future }`. Most actions push the current `present` to `past` and clear
// `future`. `transient` updates (resize pointermove, drag-tick multi-drag,
// connector snap preview) skip the history push so they don't flood the
// stack — they still update `present` for render visibility.
//
// Phase 3 P2P replays pass `snapshot` actions here too — those replace
// `present` wholesale without touching `past`/`future` (the operator's
// undo stack is local-only state, never synced).

import type { Action, CanvasState } from './canvasReducer'

export const MAX_HISTORY = 50

export interface HistoryState {
  past: CanvasState[]
  present: CanvasState
  future: CanvasState[]
}

// Strip the meta field so the inner reducer never sees it.
function stripMeta<T extends Action>(action: T): Omit<T, 'meta'> {
  if ('meta' in action) {
    const { meta: _meta, ...rest } = action as T & { meta?: unknown }
    return rest as Omit<T, 'meta'>
  }
  return action
}

function pushPast(state: HistoryState, next: CanvasState): HistoryState {
  const past = [...state.past, state.present]
  // Cap history depth — drop the oldest.
  while (past.length > MAX_HISTORY) past.shift()
  return { past, present: next, future: [] }
}

export function withHistory(reducer: (state: CanvasState, action: Action) => CanvasState) {
  return (state: HistoryState, action: Action): HistoryState => {
    // Undo / redo / snapshot read/write the stack without going through
    // the inner reducer. Everything else delegates.
    if (action.type === 'undo') {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future]
      }
    }
    if (action.type === 'redo') {
      if (state.future.length === 0) return state
      const next = state.future[0]
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1)
      }
    }
    if (action.type === 'snapshot') {
      // Phase 3 wholesale replace — bumps `present` only, leaves history.
      const next: CanvasState = reducer(state.present, action)
      return { past: state.past, present: next, future: [] }
    }
    const isTransient = action.type === 'update-item' && Boolean(action.meta?.transient)
    const innerAction = stripMeta(action)
    const next = reducer(state.present, innerAction as Action)
    if (next === state.present) return state
    if (isTransient) {
      // Transient: update present but don't push to past.
      return { ...state, present: next }
    }
    return pushPast(state, next)
  }
}
