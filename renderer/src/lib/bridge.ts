// Electron bridge wrapper. In production the renderer is hosted inside
// Electron and `window.bridge` is set by `electron/preload.js`. When the
// renderer is loaded standalone (vite dev server, tests, Storybook),
// `window.bridge` is undefined; we fall back to a no-op stub so the UI
// still mounts and Phase 1 reducer actions work — only the P2P worker
// side effects are silently skipped.

export interface Pkg {
  name: string
  productName: string
  version: string
  [key: string]: unknown
}

export interface BridgeAPI {
  pkg(): Pkg
  applyUpdate(): Promise<void>
  appAfterUpdate(): Promise<void>
  startWorker(specifier: string): Promise<boolean>
  onWorkerStdout(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerStderr(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerIPC(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerExit(specifier: string, listener: (code: number | null) => void): () => void
  writeWorkerIPC(specifier: string, data: string | Uint8Array): Promise<void>
}

// Worker specifiers. Picked by the renderer when calling
// `bridge.startWorker(SPEC)` — must match the path arguments in
// `electron/main.js`'s `getWorker()`.
export const MAIN_WORKER = '/workers/main.js'
export const ROOM_WORKER = '/workers/tamarind-room-entry.js'

const noopBridge: BridgeAPI = {
  pkg: () => ({ name: 'tamarind', productName: 'Tamarind', version: '0.0.0' }),
  applyUpdate: () => Promise.resolve(),
  appAfterUpdate: () => Promise.resolve(),
  startWorker: () => Promise.resolve(false),
  onWorkerStdout: () => () => {},
  onWorkerStderr: () => () => {},
  onWorkerIPC: () => () => {},
  onWorkerExit: () => () => {},
  writeWorkerIPC: () => Promise.resolve()
}

export const bridge: BridgeAPI =
  typeof window !== 'undefined' && window.bridge ? window.bridge : noopBridge

if (typeof window !== 'undefined' && !window.bridge) {
  // Surface the fallback path so we know the renderer is running outside
  // Electron (vite dev / tests / Storybook) — Phase 1 reducer still works,
  // but P2P worker side effects are silently no-op'd.
  console.warn('[tamarind] bridge: window.bridge missing, using no-op stub')
}

declare global {
  interface Window {
    bridge?: BridgeAPI
  }
}
