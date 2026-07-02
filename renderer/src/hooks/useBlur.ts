// useBlurHandler — attach a commit callback to a native `blur` event via a
// callback ref. React's synthetic `onBlur` is batched and can be dropped when
// the element unmounts in the same tick as the focus change (e.g. selecting a
// different shape swaps the whole PropertiesDrawer subtree). The native `blur`
// event fires synchronously during focus loss, *before* React unmounts the
// old tree, so a commit registered here always runs.
//
// The handler is stored in a ref so the returned callback ref stays stable
// (empty dep array) — we never detach/reattach the listener just because the
// closure changed. The ref cleanup removes the listener when the node unmounts.

import { useCallback, useRef } from 'react'

export function useBlurHandler(handler: () => void) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  return useCallback((el: HTMLElement | null) => {
    if (!el) return
    const listener = () => handlerRef.current()
    el.addEventListener('blur', listener)
    return () => el.removeEventListener('blur', listener)
  }, [])
}
