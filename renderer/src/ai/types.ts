// Shared type surface for the Phase-5 local-AI feature. Imported by
// `bridge.ts`, `useAI.ts`, `AIModelModal.tsx`, and `CanvasFooter.tsx`.
//
// These mirror `electron/qvac.d.ts` and `electron/modelStore.d.ts` but
// are renderer-side: no Node-only types, all fields user-visible.

export type ModelSourceKind = 'http' | 'https' | 'registry' | 'file'

export interface ModelEntry {
  id: string
  name: string
  source: string
  sourceKind: ModelSourceKind
  size?: number
  quantization?: string
  params?: string
  description?: string
  createdAt: string
  builtin?: boolean
}

export interface ModelStatus {
  active: {
    id: string | null
    name: string
    source: string
    sourceKind: ModelSourceKind | null
    loaded: boolean
    requestId: string | null
    loadedAt: number | null
  }
  lastSelectedId: string | null
  available: ModelEntry[]
}

export interface ModelLoadProgress {
  phase: 'downloading' | 'loading'
  downloaded: number
  total: number
  percentage: number
  requestId?: string
}

export interface ModelErrorPayload {
  code: string
  message: string
  retryable: boolean
}

export interface ModelAddInput {
  name: string
  source: string
  description?: string
  quantization?: string
  params?: string
}

export interface AiStatusShim {
  isReady: boolean
  modelName: string
  uptime: number
  downloading: boolean
  downloadProgress: number
}

/**
 * Per-load model configuration. Mirrors the values shown in the
 * AIModal Config tab. `ctx_size` controls the
 * llama.cpp context window in tokens; `tools` enables Qwen's
 * tool-calling surface (gated by the SDK's `tools` flag inside
 * `buildModelConfig`).
 *
 * Persisted in `<userData>/models.json>` under the `aiConfig` key so
 * the pick survives reloads.
 */
export interface AiConfig {
  ctx_size: 2048 | 4096 | 8192 | 16384
  tools: boolean
  toolConfig?: {
    add_items: boolean
    update_items: boolean
    remove_items: boolean
    get_items: boolean
  }
  knowledgeBase?: boolean
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  ctx_size: 8192,
  tools: false,
  toolConfig: {
    add_items: true,
    update_items: false,
    remove_items: true,
    get_items: true
  },
  knowledgeBase: false
}

export const CTX_SIZE_OPTIONS: ReadonlyArray<AiConfig['ctx_size']> = [2048, 4096, 8192, 16384]

// ──────────────────────────── Phase 6: AI chat ────────────────────────────

/**
 * A single message in an AI chat session. The shape is renderer-
 * owned; the main process stores it as JSON and the SDK sees only
 * the `role` + `content` fields.
 *
 * `thinking` is the model's reasoning (captured via the SDK's
 * `captureThinking: true` flag and surfaced as `thinkingDelta`
 * events). Persisted alongside the message so reopening a session
 * shows the reasoning again.
 *
 * `modelId` + `modelName` record which model produced the turn
 * (only set on assistant messages in a multi-model setup).
 */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  thinking?: string
  modelId?: string
  modelName?: string
}

/**
 * Metadata for one AI chat session. Computed from the on-disk layout
 * (`<userData>/sessions/<slug>/messages.json`); the directory
 * listing is the index.
 *
 * `pinned: true` for the `main` session, which is auto-created on
 * app boot and cannot be deleted (but can be cleared).
 */
export interface SessionMeta {
  slug: string
  createdAt: number
  lastActive: number
  messageCount: number
  pinned: boolean
}

/** What the SDK streams back. The renderer aggregates into a turn. */
export interface ChatTokenEvent {
  requestId: string
  text: string
}

export interface ChatThinkingEvent {
  requestId: string
  text: string
}

export interface ChatStatsEvent {
  requestId: string
  stats: {
    timeToFirstToken?: number
    tokensPerSecond?: number
    cacheTokens?: number
    promptTokens?: number
    generatedTokens?: number
    backendDevice?: 'cpu' | 'gpu'
  }
}

export interface ChatDoneEvent {
  requestId: string
  stopReason: 'cancelled' | 'eos' | 'length' | 'stopSequence' | 'error'
}

export interface ChatErrorEvent {
  requestId: string
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export interface ChatStatusEvent {
  isStreaming: boolean
  requestId: string | null
  startedAt: number | null
}

/**
 * Where the active AI chat is sourcing completions. Defaults to
 * `local` (per the user's locked-in decision 2 — never persist the
 * pick across launches). Phase 2 adds `peer` for routing to a
 * remote writer.
 */
export type AiSource =
  | { kind: 'local'; modelId: string; modelName: string }
  | { kind: 'peer'; writerKey: string; modelId: string; modelName: string; displayName?: string }
