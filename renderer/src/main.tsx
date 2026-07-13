import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { __tamarindRoomStoreForTest, dispatchActionForTest } from './hooks/useRoom'
import './index.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')

  // Test hook — exposes the room store snapshot to CDP-driven smoke
  // tests. `window.__tamarind?.room.peek()` returns the latest state
  // without depending on DOM scraping. `room.dispatch(action)` fires a
  // raw `{type:'state-action', action}` IPC frame past any UI guards
  // (e.g. to verify the worker-side last-board guard fires when the UI
  // hides the delete button). Safe in production (read-only peek;
  // dispatch only writes the same way the React hook does).
}
;(window as unknown as { __tamarind?: unknown }).__tamarind = {
  room: {
    ...__tamarindRoomStoreForTest(),
    dispatch: dispatchActionForTest
  }
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
