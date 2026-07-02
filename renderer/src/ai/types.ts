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
 * AIModal "Model configuration" section. `ctx_size` controls the
 * llama.cpp context window in tokens; `tools` enables Qwen's
 * tool-calling surface (gated by the SDK's `tools` flag inside
 * `buildModelConfig`).
 *
 * Persisted in `<userData>/models.json>` under the `aiConfig` key so
 * the pick survives reloads.
 */
export interface AiConfig {
  ctx_size: 2048 | 4096 | 8192
  tools: boolean
}

export const DEFAULT_AI_CONFIG: AiConfig = { ctx_size: 4096, tools: false }

export const CTX_SIZE_OPTIONS: ReadonlyArray<AiConfig['ctx_size']> = [2048, 4096, 8192]
