// Type declarations for qvac.js — consumed by main.js (CommonJS) when
// needed and by intellisense. Runtime surface is the module.exports
// object literal below.

declare interface RegistryModelDescriptor {
  readonly name: string
  readonly src: string
  readonly registryPath: string
  readonly modelId: string
  [key: string]: unknown
}

export interface ModelSourceKindMap {
  http: 'http'
  https: 'https'
  registry: 'registry'
  file: 'file'
}

export type ModelSourceKind = ModelSourceKindMap[keyof ModelSourceKindMap]

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

export interface AiConfig {
  ctx_size: 2048 | 4096 | 8192 | 16384
  tools: boolean
}

export interface QvacStatus {
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

export interface QvacErrorPayload {
  code: string
  message: string
  retryable: boolean
}

export interface QvacProgressPayload {
  phase: 'downloading' | 'loading'
  downloaded: number
  total: number
  percentage: number
  requestId?: string
}

export type BrowserWindowLike = import('electron').BrowserWindow

export const ensureQvacConfig: () => void
export const setMainWindow: (window: BrowserWindowLike | null) => void
export const setActiveConfig: (config: AiConfig) => void
export const ensureModel: (entry: ModelEntry) => Promise<{ modelId: string; fromCache: boolean }>
export const cancelCurrentRequest: (opts?: { clearCache?: boolean }) => Promise<void>
export const unloadCurrent: (modelId: string) => Promise<void>
export const getActiveModelId: () => string | null
export const getActiveEntry: () => ModelEntry | null
export const buildStatus: () => QvacStatus
export const findAndUnlinkCacheFile: (entry: ModelEntry) => Promise<string[]>
export const resetCache: (
  entry: ModelEntry
) => Promise<{ success: boolean; deleted: string[]; error?: string }>
export const mapError: (err: unknown) => QvacErrorPayload
