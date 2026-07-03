// Electron bridge wrapper. In production the renderer is hosted inside
// Electron and `window.bridge` is set by `electron/preload.js`. When the
// renderer is loaded standalone (vite dev server, tests, Storybook),
// `window.bridge` is undefined; we fall back to a no-op stub so the UI
// still mounts and Phase 1 reducer actions work — only the P2P worker
// side effects are silently skipped.
//
// Phase 5 adds the `models` + `ai` blocks for local AI selection,
// ported from `C:\projects\tamaflow\desktop-app\src\preload\index.ts`.

import type {
  AiConfig,
  AiSource,
  AiStatusShim,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatStatsEvent,
  ChatStatusEvent,
  ChatThinkingEvent,
  ChatTokenEvent,
  ChatTurn,
  ModelAddInput,
  ModelEntry,
  ModelErrorPayload,
  ModelLoadProgress,
  ModelStatus,
  SessionMeta
} from '../ai/types'

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
  joinWithInvite(invite: string): Promise<boolean>
  onWorkerStdout(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerStderr(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerIPC(specifier: string, listener: (data: Uint8Array) => void): () => void
  onWorkerExit(specifier: string, listener: (code: number | null) => void): () => void
  writeWorkerIPC(specifier: string, data: string | Uint8Array): Promise<void>

  models: {
    list(): Promise<ModelEntry[]>
    add(entry: ModelAddInput): Promise<ModelEntry>
    remove(id: string): Promise<boolean>
    select(id: string): Promise<{ success: boolean; error?: string }>
    cancel(opts?: { clearCache?: boolean }): Promise<{ success: boolean }>
    resetCache(id: string): Promise<{ success: boolean; deleted: string[]; error?: string }>
    status(): Promise<ModelStatus>
    pickFile(): Promise<string | null>
    onProgress(cb: (p: ModelLoadProgress) => void): () => void
    onError(cb: (e: ModelErrorPayload) => void): () => void
  }
  ai: {
    getStatus(): Promise<AiStatusShim>
    unload(): Promise<{ success: boolean; error?: string }>
    getConfig(): Promise<AiConfig>
    setConfig(config: AiConfig): Promise<{ success: boolean }>
  }
  // Phase 6: streaming chat completions. The four event channels are
  // subscribe-only — listeners are registered once via these methods
  // and the returned function unsubscribes. The renderer's `useAIChat`
  // hook subscribes on mount with empty deps and never re-subscribes
  // (avoids the my-doctor-ai stale-closure bug).
  aiChat: {
    send(args: {
      messages: ChatTurn[]
    }): Promise<{ success: boolean; requestId?: string; error?: string }>
    cancel(): Promise<{ success: boolean; error?: string }>
    status(): Promise<ChatStatusEvent>
    onToken(cb: (e: ChatTokenEvent) => void): () => void
    onThinking(cb: (e: ChatThinkingEvent) => void): () => void
    onStats(cb: (e: ChatStatsEvent) => void): () => void
    onDone(cb: (e: ChatDoneEvent) => void): () => void
    onError(cb: (e: ChatErrorEvent) => void): () => void
    onStatus(cb: (e: ChatStatusEvent) => void): () => void
  }
  // Phase 6: file-based AI chat session store. NOT P2P-replicated.
  sessions: {
    list(): Promise<SessionMeta[]>
    create(): Promise<{ slug: string }>
    delete(slug: string): Promise<{ success: boolean; error?: string }>
    clear(slug: string): Promise<{ success: boolean; error?: string }>
    load(slug: string): Promise<{ success: boolean; messages: ChatTurn[]; error?: string }>
    save(
      slug: string,
      messages: ChatTurn[]
    ): Promise<{ success: boolean; count?: number; error?: string }>
  }
  // Phase 7+: P2P AI source — list of peers' currently-loaded models
  // (and whether they're accepting requests). Surface for the Setup
  // tab's "Chat with this peer" picker. The actual routing of the
  // completion to a peer is owned by `aiChat.send` (Phase 8 wires
  // the relay path through the same send function). `loadedAt` is
  // replicated from the `@tamarind/ai-state` row (Unix ms, null
  // when no model is loaded).
  aiSourcePeers(): Promise<
    Array<{
      writerKey: string
      modelId: string | null
      modelName: string | null
      loadedAt: number | null
      accepting: boolean
    }>
  >
  onPeerAiStates(
    cb: (
      states: Array<{
        writerKey: string
        modelId: string | null
        modelName: string | null
        loadedAt: number | null
        accepting: boolean
      }>
    ) => void
  ): () => void
  // Phase 7+: AI source persistence deliberately omitted — always
  // defaults to local on launch (per the user's locked-in decision).
  aiSourceGet(): Promise<AiSource | null>
  aiSourceSet(source: AiSource): Promise<{ success: boolean }>
  // Phase 8: route a chat completion to a peer's loaded model.
  // `targetWriterKey` is the z32-encoded writer pubkey (use the
  // writerKey from `peerAiStates`). The peer's worker re-runs the
  // completion on its local model and streams the result back over
  // the Autobase; events arrive via `onRelayEvent`.
  chat: {
    route(args: {
      requestId: string
      targetWriterKey: string
      messages: ChatTurn[]
      modelId: string
    }): Promise<{ success: boolean; error?: string }>
    routeCancel(requestId: string): Promise<{ success: boolean }>
  }
  onRelayEvent(
    cb: (e: {
      requestId: string
      kind: 'started' | 'token' | 'thinking' | 'done' | 'error' | 'busy'
      text?: string | null
      error?: { code: string; message: string; retryable: boolean } | null
    }) => void
  ): () => void
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
  joinWithInvite: () => Promise.resolve(false),
  onWorkerStdout: () => () => {},
  onWorkerStderr: () => () => {},
  onWorkerIPC: () => () => {},
  onWorkerExit: () => () => {},
  writeWorkerIPC: () => Promise.resolve(),
  models: {
    list: () => Promise.resolve([]),
    add: () => Promise.reject(new Error('bridge not available')),
    remove: () => Promise.resolve(false),
    select: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    cancel: () => Promise.resolve({ success: false }),
    resetCache: () =>
      Promise.resolve({ success: false, deleted: [], error: 'bridge not available' }),
    status: () =>
      Promise.resolve({
        active: {
          id: null,
          name: '',
          source: '',
          sourceKind: null,
          loaded: false,
          requestId: null,
          loadedAt: null
        },
        lastSelectedId: null,
        available: []
      }),
    pickFile: () => Promise.resolve(null),
    onProgress: () => () => {},
    onError: () => () => {}
  },
  ai: {
    getStatus: () =>
      Promise.resolve({
        isReady: false,
        modelName: '',
        uptime: 0,
        downloading: false,
        downloadProgress: 0
      }),
    unload: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    getConfig: () => Promise.resolve({ ctx_size: 4096, tools: false }),
    setConfig: () => Promise.resolve({ success: false })
  },
  aiChat: {
    send: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    cancel: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    status: () => Promise.resolve({ isStreaming: false, requestId: null, startedAt: null }),
    onToken: () => () => {},
    onThinking: () => () => {},
    onStats: () => () => {},
    onDone: () => () => {},
    onError: () => () => {},
    onStatus: () => () => {}
  },
  sessions: {
    list: () => Promise.resolve([]),
    create: () => Promise.resolve({ slug: 'main' }),
    delete: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    clear: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    load: () => Promise.resolve({ success: true, messages: [] }),
    save: () => Promise.resolve({ success: false, error: 'bridge not available' })
  },
  aiSourcePeers: () => Promise.resolve([]),
  onPeerAiStates: () => () => {},
  aiSourceGet: () => Promise.resolve(null),
  aiSourceSet: () => Promise.resolve({ success: false }),
  chat: {
    route: () => Promise.resolve({ success: false, error: 'bridge not available' }),
    routeCancel: () => Promise.resolve({ success: false })
  },
  onRelayEvent: () => () => {}
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
