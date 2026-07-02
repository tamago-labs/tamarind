// User-managed model registry persisted at `userData/models.json`.
//
// Pre-seeds the curated QWEN model library from the @qvac/sdk
// registry (1.7B Q4 for low-spec machines, 4B Q4_K_M for high-spec
// machines) and migrates any legacy `*.gguf` files already in
// `userData` as `sourceKind: 'file'` entries so users do not have to
// re-import.
//
// Three source kinds are supported:
//   - 'registry': opaque `registry://` id mapped to a named export
//                 of @qvac/sdk (qvac.js has the lookup map).
//   - 'https' / 'http': remote URL the SDK will download into the
//                 qvac cache and then load.
//   - 'file':    absolute local path the SDK will load directly.
//
// Phase-5 also adds an `aiConfig: { ctx_size, tools }` field at the
// same JSON root, persisted across reloads so the AIModal
// "Model configuration" section survives restarts.

const { app } = require('electron')
const { join } = require('path')
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } = require('fs')

/** @type {'http' | 'https' | 'registry' | 'file'} */
let sourceKind
/** @type {string} */
let source
/** @type {ModelEntry} */
let entry

/**
 * Curated QWEN builtin presets. These are the only models the app
 * ships with — users can add custom file/URL entries alongside via
 * "Add custom model" in the picker.
 *
 * `source` uses the `registry://` scheme; the qvac service layer maps
 * the id to the matching export from `@qvac/sdk` at load time.
 */
/** @type {Array<Omit<ModelEntry, 'id' | 'createdAt'>>} */
const BUILTIN_PRESETS = [
  {
    name: 'QWEN 1.7B',
    source: 'registry://qwen3-1.7b-instruct-q4',
    sourceKind: 'registry',
    quantization: 'Q4',
    params: '1.7B',
    size: 1.28 * 1024 * 1024 * 1024,
    description:
      'Compact dual-mode reasoning model. Runs easily on low-spec laptops and mobile devices with 4-8 GB RAM.',
    builtin: true
  },
  {
    name: 'QWEN 4B',
    source: 'registry://qwen3-4b-instruct-q4-k-m',
    sourceKind: 'registry',
    quantization: 'Q4_K_M',
    params: '4B',
    size: 2.5 * 1024 * 1024 * 1024, // 2.50 GB
    description:
      'Higher-quality balanced model. Runs comfortably on standard 8 GB RAM laptops; discrete GPU optional for acceleration.',
    builtin: true
  }
]

/** @type {2048 | 4096 | 8192} */
const DEFAULT_CTX_SIZE = 4096

function deriveSourceKind(src) {
  if (src.startsWith('registry://')) return 'registry'
  if (src.startsWith('https://')) return 'https'
  if (src.startsWith('http://')) return 'http'
  // Absolute path on Windows (C:\...) or POSIX (/...) → file
  if (src.length >= 2 && (src[1] === ':' || src.startsWith('/') || src.startsWith('\\\\'))) {
    return 'file'
  }
  // Fallback: treat as a URL
  return 'https'
}

function newId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

class ModelStore {
  constructor() {
    /** @type {string} */
    this.filePath
    /** @type {ModelRegistryFile} */
    this.state = {
      version: 1,
      models: [],
      lastSelectedModelId: null,
      aiConfig: { ctx_size: DEFAULT_CTX_SIZE, tools: false }
    }

    const userDataPath = app.getPath('userData')
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }
    this.filePath = join(userDataPath, 'models.json')
    this.load()
    this.scanExistingGguf()
    this.preSeedIfEmpty()
    this.save()
  }

  load() {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8')
        const parsed = JSON.parse(data)
        if (parsed && Array.isArray(parsed.models)) {
          // Merge in defaults so older files (no aiConfig) don't break
          // callers that read the field unconditionally.
          this.state = {
            version: 1,
            models: parsed.models,
            lastSelectedModelId: parsed.lastSelectedModelId ?? null,
            aiConfig: {
              ctx_size: parsed.aiConfig?.ctx_size ?? DEFAULT_CTX_SIZE,
              tools: parsed.aiConfig?.tools ?? false
            }
          }
        }
      }
    } catch (error) {
      console.error('[ModelStore] Failed to load registry:', error)
      this.state = {
        version: 1,
        models: [],
        lastSelectedModelId: null,
        aiConfig: { ctx_size: DEFAULT_CTX_SIZE, tools: false }
      }
    }
  }

  save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf-8')
    } catch (error) {
      console.error('[ModelStore] Failed to save registry:', error)
    }
  }

  preSeedIfEmpty() {
    if (this.state.models.length > 0) return
    const now = new Date().toISOString()
    // Default `lastSelectedModelId` to the 1.7B (low-spec) entry so
    // first-time users on small machines get the right default.
    let firstEntryId = /** @type {string|null} */ (null)
    for (const preset of BUILTIN_PRESETS) {
      /** @type {ModelEntry} */
      const entry = {
        id: newId(),
        ...preset,
        createdAt: now
      }
      this.state.models.push(entry)
      if (firstEntryId === null) firstEntryId = entry.id
    }
    if (firstEntryId !== null) {
      this.state.lastSelectedModelId = firstEntryId
    }
  }

  scanExistingGguf() {
    try {
      const userDataPath = app.getPath('userData')
      const files = readdirSync(userDataPath)
      const ggufFiles = files.filter((f) => f.toLowerCase().endsWith('.gguf'))

      for (const filename of ggufFiles) {
        const absPath = join(userDataPath, filename)
        let stat
        try {
          stat = statSync(absPath)
          if (!stat.isFile()) continue
        } catch {
          continue
        }

        // Skip if a local-file entry with this exact path already exists.
        const exists = this.state.models.some(
          (m) => m.sourceKind === 'file' && m.source === absPath
        )
        if (exists) continue

        const entry = {
          id: newId(),
          name: filename.replace(/\.gguf$/i, ''),
          source: absPath,
          sourceKind: /** @type {'file'} */ ('file'),
          size: stat.size,
          quantization: 'Q4_K_M',
          params: '1.7B',
          description: 'Local GGUF file detected in userData',
          createdAt: new Date().toISOString(),
          builtin: false
        }
        this.state.models.push(entry)
      }

      // Ensure lastSelectedModelId still points at an existing entry.
      if (
        this.state.lastSelectedModelId &&
        !this.state.models.some((m) => m.id === this.state.lastSelectedModelId)
      ) {
        this.state.lastSelectedModelId = this.state.models[0]?.id ?? null
      }
    } catch (error) {
      console.error('[ModelStore] Failed to scan userData for .gguf files:', error)
    }
  }

  getAll() {
    return [...this.state.models]
  }

  getById(id) {
    return this.state.models.find((m) => m.id === id)
  }

  add(input) {
    const sourceKind = input.sourceKind ?? deriveSourceKind(input.source)
    const entry = {
      id: newId(),
      name: input.name,
      source: input.source,
      sourceKind,
      size: input.size,
      quantization: input.quantization,
      params: input.params,
      description: input.description,
      createdAt: new Date().toISOString(),
      builtin: input.builtin ?? false
    }
    this.state.models.push(entry)
    this.save()
    return entry
  }

  remove(id) {
    const entry = this.getById(id)
    if (!entry) return false
    if (entry.builtin) return false
    this.state.models = this.state.models.filter((m) => m.id !== id)
    if (this.state.lastSelectedModelId === id) {
      this.state.lastSelectedModelId = this.state.models[0]?.id ?? null
    }
    this.save()
    return true
  }

  setLastSelected(id) {
    if (id !== null && !this.getById(id)) return
    this.state.lastSelectedModelId = id
    this.save()
  }

  getLastSelected() {
    if (!this.state.lastSelectedModelId) return null
    return this.getById(this.state.lastSelectedModelId) ?? null
  }

  /**
   * @returns {AiConfig}
   */
  getAiConfig() {
    return { ...this.state.aiConfig }
  }

  /**
   * @param {AiConfig} config
   */
  setAiConfig(config) {
    this.state.aiConfig = {
      ctx_size: config.ctx_size,
      tools: config.tools
    }
    this.save()
  }
}

const modelStore = new ModelStore()

module.exports = { modelStore }
