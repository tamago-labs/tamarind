// Type declarations for modelStore.js.

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

export interface AiConfig {
  ctx_size: 2048 | 4096 | 8192 | 16384
  tools: boolean
}

export interface ModelRegistryFile {
  version: 1
  models: ModelEntry[]
  lastSelectedModelId: string | null
  aiConfig: AiConfig
}

export interface ModelStoreApi {
  getAll(): ModelEntry[]
  getById(id: string): ModelEntry | undefined
  add(
    input: Omit<ModelEntry, 'id' | 'createdAt' | 'sourceKind' | 'size'> & {
      sourceKind?: ModelSourceKind
      size?: number
    }
  ): ModelEntry
  remove(id: string): boolean
  setLastSelected(id: string | null): void
  getLastSelected(): ModelEntry | null
  getAiConfig(): AiConfig
  setAiConfig(config: AiConfig): void
}

export const modelStore: ModelStoreApi
