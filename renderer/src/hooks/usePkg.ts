import { bridge } from '../lib/bridge'
import type { Pkg } from '../lib/bridge'

// `bridge.pkg()` is a sync IPC call into the main process. The package
// metadata is constant for the app's lifetime, so we cache the result at
// module scope. This avoids per-component sync IPC round-trips and a
// flash-of-empty UI that a `useState`/`useEffect` wrapper would produce.
let cached: Pkg | null = null

const fallback: Pkg = {
  name: 'tamarind',
  productName: 'Tamarind',
  version: '1.0.0'
}

function readPkg(): Pkg {
  if (cached !== null) return cached
  try {
    cached = bridge.pkg()
  } catch (err) {
    console.error('Failed to read package metadata:', err)
    cached = fallback
  }
  return cached
}

export function usePkg(): Pkg {
  return readPkg()
}
