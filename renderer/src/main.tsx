import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { __tamarindRoomStoreForTest } from './hooks/useRoom'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

// Test hook — exposes the room store snapshot to CDP-driven smoke
// tests. `window.__tamarind?.room.peek()` returns the latest state
// without depending on DOM scraping. Safe in production (read-only).
;(window as unknown as { __tamarind?: unknown }).__tamarind = {
  room: __tamarindRoomStoreForTest()
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
