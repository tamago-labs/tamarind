// Snap-to-port helper. Phase 3 extracted this from `ConnectorHandles`
// so `CanvasPage`'s drag-to-create flow can reuse the same logic when
// the user is in connector-draw mode.
//
// The signature is intentionally minimal: pass the cursor in world
// coordinates and the radius (also world units); get back the closest
// snap target within range or `null`. Connectors themselves are NOT
// snap targets (you can't drag a connector onto another connector's
// port — only onto rect/ellipse/text hosts).

import type { BoardScopedItem, Port } from './types'
import { getPortWorld } from './types'

export interface NearestPort {
  itemId: string
  port: Port
}

export function findNearestPort(
  cursor: { x: number; y: number },
  selfId: string | null,
  itemsById: Record<string, BoardScopedItem>,
  radiusWorld: number
): NearestPort | null {
  let best: { itemId: string; port: Port; d: number } | null = null
  for (const item of Object.values(itemsById)) {
    if (selfId !== null && item.id === selfId) continue
    // Skip connectors and any host without a measurable bbox (text
    // shapes still have w/h so they're included).
    if (item.type === 'connector') continue
    if (item.w === undefined || item.h === undefined) continue
    for (const port of ['top', 'right', 'bottom', 'left'] as Port[]) {
      const p = getPortWorld(item, port)
      const d = Math.hypot(p.x - cursor.x, p.y - cursor.y)
      if (d <= radiusWorld && (best === null || d < best.d)) {
        best = { itemId: item.id, port, d }
      }
    }
  }
  if (!best) return null
  return { itemId: best.itemId, port: best.port }
}
