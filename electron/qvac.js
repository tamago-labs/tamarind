// QVAC SDK chokepoint. Mirrors the public API of
// `C:\projects\tamaflow\desktop-app\src\main\qvac.ts` (Phase-5 reference),
// adapted for Tamarind's CommonJS main-process loader.
//
// Single owner of:
//   - the SDK config (cacheDirectory on userData)
//   - the in-flight requestId (for cancellation)
//   - the currently-loaded modelId
//   - the active per-load config (ctx_size + tools, mirrored from
//     modelStore.setAiConfig via setActiveConfig)
//   - normalized progress emission (models:progress)
//   - error mapping → { code, message, retryable } for the renderer
//
// Source kinds:
//   - 'registry' → looked up in REGISTRY_SOURCES, resolved SDK
//                  constant is passed to loadModel.
//   - 'file'     → loaded directly from the absolute path.
//   - 'https'/'http' → downloaded into the qvac cache, then loaded.

const { app, BrowserWindow } = require('electron')
const { basename: pathBasename } = require('path')
const { existsSync, writeFileSync, mkdirSync, promises: fsPromises } = require('fs')
const {
  QWEN3_1_7B_INST_Q4,
  QWEN3_4B_INST_Q4_K_M,
  GEMMA4_31B_MULTIMODAL_Q4_K_M,
  GEMMA4_4B_MULTIMODAL_Q4_K_M,
  loadModel,
  unloadModel,
  downloadAsset,
  cancel,
  deleteCache,
  ModelType,
  InferenceCancelledError,
  ContextOverflowError,
  WorkerCrashedError,
  WorkerShutdownError
} = require('@qvac/sdk')

// ───────────────────────────── module state ─────────────────────────────

let mainWindowRef = /** @type {BrowserWindow|null} */ (null)
let currentRequestId = /** @type {string|null} */ (null)
let currentModelId = /** @type {string|null} */ (null)
let currentEntry = /** @type {object|null} */ (null)
let currentLoadedAt = /** @type {number|null} */ (null)

// Mirrored from modelStore.setAiConfig via setActiveConfig(). Module-scope
// so ensureModel can read it on every load without threading it through
// the IPC callbacks (matches TamaFlow's module-scope design).
/** @type {{ ctx_size: 2048|4096|8192|16384, tools: boolean, knowledgeBase: boolean }} */
let activeConfig = { ctx_size: 8192, tools: false, knowledgeBase: false }

/** Return the current active config (read-only copy). */
function getActiveConfig() {
  return { ...activeConfig }
}

/**
 * Map of `registry://<id>` source strings to the matching @qvac/sdk
 * named export. Keep this in lockstep with the builtin presets in
 * `modelStore.js`.
 */
const REGISTRY_SOURCES = /** @type {Record<string, unknown>} */ ({
  'qwen3-1.7b-instruct-q4': QWEN3_1_7B_INST_Q4, // expectedSize: 1056782912,
  'qwen3-4b-instruct-q4-k-m': QWEN3_4B_INST_Q4_K_M, //   expectedSize: 2497280256,
  'gemma4-31b-q4-k-m': GEMMA4_31B_MULTIMODAL_Q4_K_M, // expectedSize: 19598488192,
  'gemma4-4b-q4-k-m': GEMMA4_4B_MULTIMODAL_Q4_K_M // expectedSize: 5405168384,
})

function resolveRegistrySource(source) {
  if (!source.startsWith('registry://')) {
    throw {
      code: 'UNKNOWN_REGISTRY',
      message: `Registry id is missing the "registry://" prefix: ${source}`,
      retryable: false
    }
  }
  const id = source.slice('registry://'.length)
  const resolved = REGISTRY_SOURCES[id]
  if (!resolved) {
    throw {
      code: 'UNKNOWN_REGISTRY',
      message: `Unknown registry id: ${id}. Available: ${Object.keys(REGISTRY_SOURCES).join(', ')}`,
      retryable: false
    }
  }
  return resolved
}

// ───────────────────────────── config bootstrap ─────────────────────────

/**
 * Writes `userData/qvac.config.json` so the SDK's Node resolver picks
 * it up via QVAC_CONFIG_PATH. Must be called BEFORE any
 * loadModel/downloadAsset call so the worker writes its cache where
 * we can inspect it.
 */
function ensureQvacConfig() {
  if (process.env.QVAC_CONFIG_PATH) return
  const userDataPath = app.getPath('userData')
  const cacheDir = require('path').join(userDataPath, 'qvac-cache')
  mkdirSync(cacheDir, { recursive: true })
  const cfgPath = require('path').join(userDataPath, 'qvac.config.json')
  const cfg = { cacheDirectory: cacheDir }
  try {
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
    process.env.QVAC_CONFIG_PATH = cfgPath
    console.log('[qvac] Wrote config to', cfgPath)
  } catch (error) {
    console.error('[qvac] Failed to write qvac.config.json:', error)
  }
}

function setMainWindow(window) {
  mainWindowRef = window
}

/**
 * Mutator called by main.js's `ai-config:set` handler. Mirrors the
 * persisted aiConfig into module scope so the next ensureModel() call
 * reads the freshest values.
 */
function setActiveConfig(config) {
  activeConfig = {
    ctx_size: Number(config?.ctx_size) || 4096,
    tools: !!config?.tools,
    knowledgeBase: !!config?.knowledgeBase
  }
}

// ───────────────────────────── progress emission ─────────────────────────

function send(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload)
  }
}

function emitProgress(phase, p) {
  send('models:progress', { phase, ...p })
}

// ───────────────────────────── cache-file utility ──────────────────────

/**
 * Compute the basename of an HTTP(S) source URL, matching how the
 * QVAC SDK constructs cache filenames. `generateShortHash` is not
 * exported from the SDK, so we discover cache files by `endsWith`
 * on the basename only.
 */
function basenameOfSource(source) {
  if (!/^https?:\/\//i.test(source)) return ''
  try {
    return pathBasename(new URL(source).pathname) || ''
  } catch {
    return ''
  }
}

/**
 * Find every file in `<userData>/qvac-cache/` whose name ends with
 * `_<basename(entry.source)>` and unlink it. Used both by
 * auto-recovery and by the manual `models:resetCache` IPC.
 */
async function findAndUnlinkCacheFile(entry) {
  const basename = basenameOfSource(entry.source)
  if (!basename) return []
  const cacheDir = require('path').join(app.getPath('userData'), 'qvac-cache')
  let names
  try {
    names = await fsPromises.readdir(cacheDir)
  } catch (err) {
    console.warn('[qvac] resetCache: cache dir unreadable:', cacheDir, err)
    return []
  }
  const suffix = `_${basename}`
  const deleted = []
  for (const name of names) {
    if (!name.endsWith(suffix)) continue
    const abs = require('path').join(cacheDir, name)
    try {
      await fsPromises.unlink(abs)
      deleted.push(abs)
      console.log('[qvac] Deleted cache file:', abs)
    } catch (err) {
      // EBUSY/EPERM on Windows if the worker still holds a handle —
      // log and continue.
      console.warn('[qvac] Failed to delete cache file:', abs, err)
    }
  }
  return deleted
}

async function resetCache(entry) {
  if (entry.sourceKind === 'file' || entry.sourceKind === 'registry') {
    return { success: false, deleted: [], error: 'Cannot reset local/registry entry' }
  }
  try {
    const deleted = await findAndUnlinkCacheFile(entry)
    console.log(`[qvac] resetCache: removed ${deleted.length} file(s) for ${entry.id}`)
    return { success: true, deleted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[qvac] resetCache failed:', message)
    return { success: false, deleted: [], error: message }
  }
}

// ───────────────────────────── error mapping ─────────────────────────────

function errorName(err) {
  if (err && typeof err === 'object' && 'name' in err) {
    const n = err.name
    if (typeof n === 'string') return n
  }
  return ''
}

function errorMessage(err) {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = err.message
    if (typeof m === 'string') return m
  }
  return ''
}

function mapError(err) {
  if (err instanceof InferenceCancelledError) {
    return { code: 'CANCELLED', message: 'Cancelled', retryable: false }
  }
  if (err instanceof ContextOverflowError) {
    return {
      code: 'CONTEXT_OVERFLOW',
      message: 'Conversation too long for the current context size.',
      retryable: false
    }
  }
  if (err instanceof WorkerCrashedError || err instanceof WorkerShutdownError) {
    return {
      code: 'WORKER_DIED',
      message: 'Inference engine crashed. Reload to retry.',
      retryable: true
    }
  }

  const name = errorName(err)
  const message = errorMessage(err)

  if (name === 'DownloadCancelledError') {
    return { code: 'CANCELLED', message: 'Download cancelled', retryable: false }
  }
  if (name === 'ModelFileNotFoundError' || name === 'ModelFileNotFoundInDirError') {
    const path = err?.modelPath
    return {
      code: 'FILE_NOT_FOUND',
      message: `File not found: ${path ?? ''}`.trim(),
      retryable: false
    }
  }
  if (name === 'ModelFileLocateFailedError') {
    const meta = err
    return {
      code: 'LOCATE_FAILED',
      message: `Could not locate ${meta.modelType ?? 'model'} at ${meta.modelPath ?? ''}`.trim(),
      retryable: false
    }
  }
  if (name === 'ChecksumValidationFailedError') {
    const fileName = err?.fileName
    return {
      code: 'CHECKSUM_FAILED',
      message: `Checksum failed: ${fileName ?? 'file'}. The download will be re-attempted.`,
      retryable: true
    }
  }
  if (name === 'PartialDownloadOfflineError') {
    return {
      code: 'PARTIAL_OFFLINE',
      message: 'Saved partial download. Reconnect to the internet to resume.',
      retryable: true
    }
  }
  if (name === 'HTTPError') {
    return { code: 'HTTP_ERROR', message: message || 'HTTP error during download', retryable: true }
  }
  if (name === 'DownloadAssetFailedError') {
    return {
      code: 'DOWNLOAD_FAILED',
      message: 'Download failed: check your connection or the URL.',
      retryable: true
    }
  }
  if (name === 'ModelLoadFailedError') {
    return { code: 'LOAD_FAILED', message: message || 'Model load failed', retryable: true }
  }
  if (err && typeof err === 'object' && 'code' in err) {
    const e = err
    return { code: e.code, message: e.message ?? message, retryable: e.retryable ?? false }
  }
  if (err instanceof Error) {
    return { code: 'UNKNOWN', message: err.message || 'Unknown error', retryable: true }
  }
  return { code: 'UNKNOWN', message: 'Unknown error', retryable: true }
}

// ───────────────────────────── public API ────────────────────────────────

async function ensureModel(entry) {
  // Publish the entry as the in-flight selection up-front so the
  // upcoming progress events can be attributed to a specific row.
  currentEntry = entry
  currentModelId = null
  currentLoadedAt = null
  if (entry.sourceKind === 'file') {
    if (!existsSync(entry.source)) {
      currentEntry = null
      throw {
        code: 'FILE_NOT_FOUND',
        message: `File not found: ${entry.source}`,
        retryable: false
      }
    }
    return await loadLocal(entry)
  }
  if (entry.sourceKind === 'registry') {
    return await loadRegistry(entry)
  }
  return await downloadThenLoad(entry)
}

async function loadRegistry(entry) {
  // Runtime dispatch is correct because the descriptor itself carries
  // the engine tag; TypeScript can't narrow a Record<string, unknown>
  // lookup, so we cast at this seam.
  const modelSrc = resolveRegistrySource(entry.source)
  const op = loadModel({
    modelSrc,
    modelConfig: buildModelConfig(),
    onProgress: (p) =>
      emitProgress('loading', {
        downloaded: p.downloaded,
        total: p.total,
        percentage: p.percentage,
        requestId: op.requestId
      })
  })
  currentRequestId = op.requestId
  try {
    const modelId = await op
    currentRequestId = null
    currentModelId = modelId
    currentEntry = entry
    currentLoadedAt = Date.now()
    emitProgress('loading', {
      downloaded: 1,
      total: 1,
      percentage: 100,
      requestId: op.requestId
    })
    console.log('[qvac] Registry model loaded:', modelId, '(', entry.source, ')')
    return { modelId, fromCache: false }
  } catch (err) {
    currentRequestId = null
    throw mapError(err)
  }
}

async function loadLocal(entry) {
  const op = loadModel({
    modelSrc: entry.source,
    modelType: ModelType.llamacppCompletion,
    modelConfig: buildModelConfig(),
    onProgress: (p) =>
      emitProgress('loading', {
        downloaded: p.downloaded,
        total: p.total,
        percentage: p.percentage,
        requestId: op.requestId
      })
  })
  currentRequestId = op.requestId
  try {
    const modelId = await op
    currentRequestId = null
    currentModelId = modelId
    currentEntry = entry
    currentLoadedAt = Date.now()
    emitProgress('loading', {
      downloaded: 1,
      total: 1,
      percentage: 100,
      requestId: op.requestId
    })
    console.log('[qvac] Local model loaded:', modelId, '(', entry.source, ')')
    return { modelId, fromCache: false }
  } catch (err) {
    currentRequestId = null
    throw mapError(err)
  }
}

async function downloadThenLoad(entry) {
  // 1) Download (resume is automatic when QVAC's cacheDirectory
  //    already has a partial file for the same URL).
  const downloadOp = downloadAsset({
    assetSrc: entry.source,
    onProgress: (p) =>
      emitProgress('downloading', {
        downloaded: p.downloaded,
        total: p.total,
        percentage: p.percentage,
        requestId: downloadOp.requestId
      })
  })
  currentRequestId = downloadOp.requestId
  try {
    await downloadOp
  } catch (err) {
    currentRequestId = null
    throw mapError(err)
  }
  currentRequestId = null

  // 2) Load by passing the same URL; the SDK reuses the cached
  //    asset by its source identifier.
  const loadOp = loadModel({
    modelSrc: entry.source,
    modelType: ModelType.llamacppCompletion,
    modelConfig: buildModelConfig(),
    onProgress: (p) =>
      emitProgress('loading', {
        downloaded: p.downloaded,
        total: p.total,
        percentage: p.percentage,
        requestId: loadOp.requestId
      })
  })
  currentRequestId = loadOp.requestId
  try {
    const modelId = await loadOp
    currentRequestId = null
    currentModelId = modelId
    currentEntry = entry
    currentLoadedAt = Date.now()
    emitProgress('loading', {
      downloaded: 1,
      total: 1,
      percentage: 100,
      requestId: loadOp.requestId
    })
    console.log('[qvac] URL model loaded:', modelId, '(', entry.source, ')')
    return { modelId, fromCache: false }
  } catch (err) {
    currentRequestId = null
    throw mapError(err)
  }
}

async function cancelCurrentRequest(opts = {}) {
  if (!currentRequestId) return
  const id = currentRequestId
  currentRequestId = null
  try {
    await cancel({ requestId: id, clearCache: opts.clearCache })
  } catch (err) {
    if (!(err instanceof InferenceCancelledError)) {
      console.warn('[qvac] cancel failed:', err)
    }
  }
}

async function unloadCurrent(modelId) {
  try {
    await unloadModel({ modelId })
    if (currentModelId === modelId) {
      currentModelId = null
      currentEntry = null
      currentLoadedAt = null
    }
  } catch (e) {
    console.warn('[qvac] unload failed:', e)
  }
}

function getActiveModelId() {
  return currentModelId
}

function getActiveEntry() {
  return currentEntry
}

/**
 * Phase 7: P2P AI state awareness (Scope A). The room worker pulls
 * this snapshot from the local writer so it can broadcast it over
 * the Autobase as an `update-ai-state` dispatch. Other peers see the
 * row in their `@tamarind/ai-state` collection and surface it in
 * the Setup tab's "Chat with this peer" picker.
 *
 * `accepting` is false while a chat completion is in flight (we
 * don't want peers to route a second request at us mid-stream) or
 * when no model is loaded at all.
 */
function getLocalAiStateSnapshot() {
  const accepting = currentModelId !== null && !isStreamingNow()
  return {
    modelId: currentEntry?.id ?? null,
    modelName: currentEntry?.name ?? null,
    loadedAt: currentLoadedAt,
    accepting
  }
}

let streamingNowFlag = false
function setStreamingNow(value) {
  streamingNowFlag = !!value
}
function isStreamingNow() {
  return streamingNowFlag
}

/**
 * Builds the modelConfig snapshot for file / https loads. Reads from
 * the module-scope `activeConfig` mirror kept in sync by
 * setActiveConfig(). Registry loads use their own descriptor-driven
 * config; this helper is not invoked for them.
 */
function buildModelConfig() {
  return {
    ctx_size: activeConfig.ctx_size,
    tools: activeConfig.tools || activeConfig.knowledgeBase
  }
}

function buildStatus() {
  return {
    active: {
      id: currentEntry?.id ?? null,
      name: currentEntry?.name ?? '',
      source: currentEntry?.source ?? '',
      sourceKind: currentEntry?.sourceKind ?? null,
      loaded: currentModelId !== null,
      requestId: currentRequestId,
      loadedAt: currentLoadedAt
    },
    lastSelectedId: null, // populated by main.js from modelStore
    available: [] // populated by main.js from modelStore
  }
}

async function clearAllCache() {
  try {
    await deleteCache({ all: true })
  } catch (err) {
    console.error('[qvac] clearAllCache failed:', err)
  }
}

module.exports = {
  ensureQvacConfig,
  setMainWindow,
  setActiveConfig,
  getActiveConfig,
  ensureModel,
  cancelCurrentRequest,
  unloadCurrent,
  getActiveModelId,
  getActiveEntry,
  getLocalAiStateSnapshot,
  setStreamingNow,
  buildStatus,
  findAndUnlinkCacheFile,
  resetCache,
  clearAllCache,
  mapError
}
