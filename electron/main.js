const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const os = require('os')
const {
  ensureQvacConfig,
  setMainWindow,
  setActiveConfig,
  ensureModel,
  cancelCurrentRequest,
  unloadCurrent,
  getActiveModelId,
  getActiveEntry,
  getLocalAiStateSnapshot,
  setStreamingNow,
  mapError,
  buildStatus,
  resetCache
} = require('./qvac')
const { modelStore } = require('./modelStore')
const aiChat = require('./aiChat')
const sessions = require('./sessions')
const path = require('path')
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')
const b4a = require('b4a')
const z32 = require('z32')

// Smoke-test harness opt-in. Electron's CLI parser rejects these as
// unknown switches (the port flag interferes with --inspect; modern
// Electron tightened --no-sandbox too). Forwarding them via
// `app.commandLine.appendSwitch` is the documented programmatic path —
// gated by env vars so production CLI parsing stays untouched.
if (process.env.TAMARIND_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    String(process.env.TAMARIND_REMOTE_DEBUGGING_PORT)
  )
}
if (process.env.TAMARIND_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
}

const { isMac, isLinux, isWindows } = require('which-runtime')
const { command, flag } = require('paparam')
const pkg = require('../package.json')
const { name, productName, version, upgrade } = pkg

const protocol = name
const mainWorkerSpecifier = '/workers/main.js'
const roomWorkerSpecifier = '/workers/tamarind-room-entry.js'

const workers = new Map()

const appName = productName ?? name

const cmd = command(
  appName,
  flag('--storage <dir>', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates'),
  flag('--no-sandbox', 'start without Chromium sandbox').hide(),
  flag('--name <name>', 'Your display name (shown in chat)'),
  flag('--invite <invite>', 'Join an existing Tamarind room via invite code'),
  flag('--writer <hex>', 'Override the writer key (hex) for testing')
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

// Resolve to absolute so callers can pass either form — e.g.
// `start:guest` uses `--storage ./tmp-tamarind-guest`. Electron's
// `app.setPath` rejects relative paths and `PearRuntime.run`'s argv
// doesn't normalize either, so binding the resolved form once here
// keeps `getWorker()`'s `dir = pearStore` and `setPath` consistent.
const pearStore = cmd.flags.storage ? path.resolve(cmd.flags.storage) : null
const updates = cmd.flags.updates
const displayName = cmd.flags.name || null
// `currentJoinInvite` is mutable so the renderer can swap host → guest
// mid-session via the splash's "Join existing board" toggle (see
// `pear:joinWithInvite`). The CLI `--invite` flag still seeds the
// initial value for tests / automation.
let currentJoinInvite = cmd.flags.invite || null
const writerKey = cmd.flags.writer || null

if (pearStore) app.setPath('userData', pearStore)

ipcMain.on('pkg', (evt) => {
  evt.returnValue = pkg
})

function getAppPath() {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function sendToAll(name, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(name, data)
  }
}

function getWorker(specifier) {
  if (workers.has(specifier)) return workers.get(specifier).pipe
  const appPath = getAppPath()
  let dir = null
  if (pearStore) {
    console.log('pear store: ' + pearStore)
    dir = pearStore
  } else if (appPath === null) {
    dir = path.join(os.tmpdir(), 'pear', appName)
  } else {
    const isSnap = !!process.env.SNAP_USER_COMMON
    const linuxConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    dir = isMac
      ? path.join(os.homedir(), 'Library', 'Application Support', appName)
      : isLinux
        ? isSnap
          ? path.join(process.env.SNAP_USER_COMMON, appName)
          : path.join(linuxConfigHome, appName)
        : path.join(os.homedir(), 'AppData', 'Roaming', appName)
  }

  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'

  // Default argv = the updater worker's positional args. The data-plane
  // (room) worker reads its own argv layout — see
  // workers/tamarind-room-entry.js — so we extend the base argv with
  // the room-only flags (`--name`, `--invite`, `--writer`).
  const argv = [dir, appPath, updates, version, upgrade, productName + extension]
  if (specifier === roomWorkerSpecifier) {
    if (displayName) argv.push('--name', displayName)
    if (currentJoinInvite) argv.push('--invite', currentJoinInvite)
    if (writerKey) argv.push('--writer', writerKey)
  }

  const worker = PearRuntime.run(require.resolve('..' + specifier), argv)
  const pipe = new FramedStream(worker)

  function sendWorkerStdout(data) {
    // Mirror the worker stdout to the main process terminal too — same
    // tee as example-2's main.js — so `npm start -- --storage X` shows
    // the worker's `[tamarind-room] invite: …` line in the launching
    // shell. Without this, the only place to read worker logs is the
    // renderer's DevTools console.
    process.stdout.write(data)
    sendToAll('pear:worker:stdout:' + specifier, data)
  }
  function sendWorkerStderr(data) {
    process.stderr.write(data)
    sendToAll('pear:worker:stderr:' + specifier, data)
  }
  function sendWorkerIPC(data) {
    // Phase 7 + 8: intercept worker-bound frames that need to be
    // handled in main (rather than forwarded to the renderer). The
    // worker writes JSON to its pipe; main parses and routes. The
    // `me` frame carries the local writer's z32 key (relay routing
    // needs it). `relay-run` and `relay-cancel` are incoming from
    // the worker when a peer's relay request is addressed at us.
    // `ai-states` is a snapshot push with the current peer AI
    // states (forwarded to renderers below). `relay-event` is the
    // peer's response stream arriving for the local requester; we
    // forward to the renderer's `ai:chat:relay-event` channel.
    if (specifier === roomWorkerSpecifier) {
      const text = data.toString()
      try {
        const frame = JSON.parse(text)
        if (frame && typeof frame === 'object') {
          if (frame.type === 'me' && typeof frame.key === 'string') {
            setLocalWriterKey(frame.key)
          } else if (frame.type === 'relay-run') {
            handleRelayRun(frame).catch((err) => {
              console.error('[main] handleRelayRun failed:', err)
            })
            return
          } else if (frame.type === 'relay-cancel') {
            handleRelayCancel(frame)
            return
          } else if (frame.type === 'ai-states') {
            setLastPeerAiStates(frame.states)
            // Fall through to forward the frame to renderers too —
            // they listen on `pear:worker:ipc:` and parse themselves.
          } else if (frame.type === 'relay-event') {
            // Don't forward the raw `relay-event` to the renderer;
            // re-emit on the dedicated `ai:chat:relay-event` channel
            // that the renderer's `bridge.onRelayEvent` subscribes to.
            console.log(
              '[main] relay: relay-event from worker',
              JSON.stringify({ requestId: frame.requestId, kind: frame.kind }).slice(0, 200)
            )
            sendToAll('ai:chat:relay-event', {
              requestId: frame.requestId,
              kind: frame.kind,
              text: frame.text ?? null,
              error: frame.error ?? null
            })
            return
          }
        }
      } catch {
        // Not JSON or unparseable — forward as-is.
      }
    }
    sendToAll('pear:worker:ipc:' + specifier, data)
  }
  function onBeforeQuit() {
    pipe.destroy()
  }
  ipcMain.handle('pear:worker:writeIPC:' + specifier, (evt, data) => {
    return pipe.write(data)
  })
  // Wraps the pipe + a torn flag. `restartRoomWorker` flips `torn=true`
  // synchronously before its `pipe.destroy()` so the trailing exit
  // handler below short-circuits and doesn't strip the handlers the
  // subsequent `getWorker()` call is about to register.
  const entry = { pipe, torn: false }
  workers.set(specifier, entry)
  pipe.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)
  worker.once('exit', (code) => {
    if (entry.torn) return
    entry.torn = true
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    pipe.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })
  app.on('before-quit', onBeforeQuit)
  return pipe
}

// Tear down the current room worker (if any) and spawn a fresh one with
// the given invite. The renderer drives this via `bridge.joinWithInvite`
// to switch host → guest without restarting Electron. The renderer's
// `useRoom` hook subscribes to `pear:worker:exit` to reset its store
// before the new worker's `status` / `role` / `invite` events arrive.
function restartRoomWorker(invite) {
  const existing = workers.get(roomWorkerSpecifier)
  if (existing) {
    // `pipe.destroy()` is async — the worker's `once('exit')` cleanup
    // (registered inside getWorker) fires on a future tick and would
    // race with the getWorker() call below. We do the teardown work
    // synchronously here, flip `entry.torn` so the trailing cleanup
    // short-circuits, and fire `pear:worker:exit` eagerly so the
    // renderer's `useRoom` resets its singleton store before the new
    // worker's frames arrive. The dup `ipcMain.handle` would otherwise
    // throw "Attempted to register a second handler for ...".
    existing.torn = true
    ipcMain.removeHandler('pear:worker:writeIPC:' + roomWorkerSpecifier)
    existing.pipe.removeAllListeners('data')
    workers.delete(roomWorkerSpecifier)
    sendToAll('pear:worker:exit:' + roomWorkerSpecifier, null)
    existing.pipe.destroy()
  }
  currentJoinInvite = invite || null
  return getWorker(roomWorkerSpecifier)
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL

  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    return
  }

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'))
}

ipcMain.handle('pear:applyUpdate', () => {
  const pipe = getWorker(mainWorkerSpecifier)

  return new Promise((resolve, reject) => {
    function onData(data) {
      const message = data.toString()

      if (message === 'pear:updateApplied') {
        pipe.removeListener('data', onData)
        resolve()
      }
    }

    pipe.on('data', onData)
    pipe.write('pear:applyUpdate')
  })
})
ipcMain.handle('pear:startWorker', (evt, filename) => {
  getWorker(filename)
  return true
})
ipcMain.handle('pear:joinWithInvite', (_evt, invite) => {
  return restartRoomWorker(invite)
})
ipcMain.handle('app:afterUpdate', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv.slice(1).filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else if (!isWindows) {
    app.relaunch()
  }
  app.quit()
})

// ============================================
// AI / Models IPC Handlers (Phase 5)
// ============================================
//
// Backed by qvac.js (SDK chokepoint) and modelStore.js (persisted
// registry). Mirrors the surface of `desktop-app/src/main/index.ts`
// at C:\projects\tamaflow adapted for Tamarind's CommonJS main + the
// window.bridge IPC shape.
//
// The ai-config:* pair carries per-load model configuration
// (ctx_size + tools); persisted in <userData>/models.json under the
// `aiConfig` key so the modal's "Model configuration" section
// survives reloads.

function buildModelsStatus() {
  const s = buildStatus()
  return {
    active: s.active,
    lastSelectedId: modelStore.getLastSelected()?.id ?? null,
    available: modelStore.getAll()
  }
}

function registerModelsIpc() {
  ipcMain.handle('models:list', () => modelStore.getAll())
  ipcMain.handle('models:add', (_evt, entry) => {
    if (!entry?.name?.trim() || !entry?.source?.trim()) {
      throw new Error('Both name and source are required')
    }
    return modelStore.add({
      name: entry.name.trim(),
      source: entry.source.trim(),
      description: entry.description?.trim(),
      quantization: entry.quantization?.trim(),
      params: entry.params?.trim()
    })
  })
  ipcMain.handle('models:remove', (_evt, id) => modelStore.remove(id))
  ipcMain.handle('models:status', () => buildModelsStatus())

  // Open a file picker so the renderer can add a local .gguf model.
  ipcMain.handle('models:pickFile', async () => {
    const cur = BrowserWindow.getFocusedWindow()
    if (!cur) return null
    const result = await dialog.showOpenDialog(cur, {
      title: 'Select a GGUF model file',
      properties: ['openFile'],
      filters: [
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    if (!picked.toLowerCase().endsWith('.gguf')) {
      throw new Error('Selected file is not a .gguf model')
    }
    return picked
  })

  // Drive the actual download + load for the selected entry.
  ipcMain.handle('models:select', async (_evt, id) => {
    const entry = modelStore.getById(id)
    if (!entry) return { success: false, error: 'Unknown model id' }
    try {
      await cancelCurrentRequest()
      const prevId = getActiveModelId()
      if (prevId) await unloadCurrent(prevId)
      modelStore.setLastSelected(entry.id)
      // Push the active config into qvac before the load; ensureModel
      // builds its modelConfig from this snapshot. Persisted in
      // modelStore so the next launch picks up the same defaults.
      const config = modelStore.getAiConfig()
      setActiveConfig(config)
      await ensureModel(entry)
      // Phase 7: broadcast the new AI state to peers via the worker.
      pushAiStateToRoomWorker()
      return { success: true }
    } catch (err) {
      const mapped = mapError(err)
      sendToAll('models:error', mapped)
      return { success: false, error: mapped.message }
    }
  })
  ipcMain.handle('models:cancel', async (_evt, opts) => {
    await cancelCurrentRequest({ clearCache: opts?.clearCache })
    return { success: true }
  })
  ipcMain.handle('models:resetCache', async (_evt, id) => {
    const entry = modelStore.getById(id)
    if (!entry) return { success: false, deleted: [], error: 'Unknown model id' }
    return resetCache(entry)
  })

  // ai:unload → unload current model.
  ipcMain.handle('ai:unload', async () => {
    const id = getActiveModelId()
    if (!id) return { success: true }
    try {
      await unloadCurrent(id)
      // Phase 7: broadcast the cleared AI state to peers.
      pushAiStateToRoomWorker()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to unload model'
      return { success: false, error: message }
    }
  })

  // Lightweight status shim for renderer polling / hydration.
  ipcMain.handle('ai:getStatus', () => {
    const s = buildModelsStatus()
    return {
      isReady: s.active.loaded,
      modelName: s.active.name || (s.active.loaded ? 'Model' : ''),
      uptime: s.active.loadedAt ? Math.floor((Date.now() - s.active.loadedAt) / 1000) : 0,
      downloading: s.active.requestId !== null,
      downloadProgress: 0
    }
  })

  // Per-load configuration (ctx_size + tools). Mirrored into qvac
  // so the modal can change settings without first unloading.
  ipcMain.handle('ai-config:get', () => modelStore.getAiConfig())
  ipcMain.handle('ai-config:set', (_evt, config) => {
    const ctx = Number(config?.ctx_size)
    if (![2048, 4096, 8192].includes(ctx)) {
      throw new Error(`Unsupported ctx_size: ${config?.ctx_size}`)
    }
    const tools = !!config?.tools
    modelStore.setAiConfig({ ctx_size: ctx, tools })
    setActiveConfig({ ctx_size: ctx, tools })
    return { success: true }
  })

  console.log('Models / AI IPC handlers registered')
}

// ============================================
// AI Chat + Sessions IPC Handlers (Phase 6 — local AI chat)
// ============================================
//
// `aiChat` is the streaming chokepoint; it pushes events directly to
// the renderer (`ai:chat:token`, `ai:chat:thinking`, `ai:chat:done`,
// `ai:chat:error`, `ai:chat:status`) so we don't need to bridge
// anything here — `electron/aiChat.js` holds the BrowserWindow ref
// handed in by `setMainWindow` below.
//
// `sessions` is the file-based AI-chat session store. The 'main'
// session is auto-created on boot (pinned, cannot delete, can clear).
// Other sessions are created programmatically with `chat-<timestamp>`
// slugs (the user's locked-in decision).

function registerChatIpc() {
  ipcMain.handle('chat:send', async (_evt, args) => {
    return aiChat.sendMessage({ messages: args?.messages ?? [] })
  })
  ipcMain.handle('chat:cancel', () => aiChat.cancelMessage())
  ipcMain.handle('chat:status', () => aiChat.getStatus())

  // Phase 8: route a chat completion to a peer's loaded model over
  // the Autobase. `args.targetWriterKey` is the z32-encoded writer
  // pubkey. The worker attaches the `relay-request` dispatch to the
  // Autobase; the peer's worker routes it to its own `aiChat` chokepoint.
  ipcMain.handle('chat:route', async (_evt, args) => {
    return routeChatCompletion(args)
  })
  ipcMain.handle('chat:routeCancel', async (_evt, args) => {
    return cancelRouteChat(args?.requestId)
  })

  ipcMain.handle('sessions:list', () => sessions.listSessions())
  ipcMain.handle('sessions:create', () => sessions.createSession())
  ipcMain.handle('sessions:delete', (_evt, slug) => sessions.deleteSession(slug))
  ipcMain.handle('sessions:clear', (_evt, slug) => sessions.clearMessages(slug))
  ipcMain.handle('sessions:load', (_evt, slug) => {
    try {
      return { success: true, messages: sessions.loadMessages(slug) }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Load failed',
        messages: []
      }
    }
  })
  ipcMain.handle('sessions:save', (_evt, slug, messages) => sessions.saveMessages(slug, messages))

  // Phase 7: peer AI states for the Setup tab's "Chat with this
  // peer" picker. The worker pushes a fresh `ai-states` frame on
  // every Autobase update that touches `@tamarind/ai-state`; we
  // forward to the renderer.
  ipcMain.handle('aiSourcePeers:list', () => lastPeerAiStates)
  // Push channel subscription — see `onPeerAiStates` below.

  console.log('AI chat / sessions IPC handlers registered')
}

// ──────────────────── AI state broadcast (Phase 7) ────────────────────

// Phase 7: push the local AI state to the room worker. The worker
// dispatches `update-ai-state` over the Autobase so peers see the
// new row in their `@tamarind/ai-state` collection. Called from
// `models:select` (after a successful load), `ai:unload` (after a
// successful unload), and once on app start (with the no-model
// snapshot so the row exists from the first frame).
function pushAiStateToRoomWorker() {
  const pipe = workers.get(roomWorkerSpecifier)?.pipe
  if (!pipe) {
    // The room worker is started lazily by the renderer's `useRoom`
    // (via `bridge.startWorker`). The 250ms-timed seed in
    // `app.whenReady` can fire before the renderer mounts, dropping
    // the very first push — but `models:select` only runs after the
    // user picks a model in the UI, by which point the worker is up.
    // Logged at warn so a regression is visible in the dev console.
    console.warn('[main] pushAiStateToRoomWorker: room worker pipe not ready, push dropped')
    return
  }
  const snapshot = getLocalAiStateSnapshot()
  try {
    pipe.write(JSON.stringify({ type: 'ai-state-snapshot', snapshot }))
  } catch (err) {
    console.warn('[main] pushAiStateToRoomWorker write failed:', err)
  }
}

// ──────────────────── Relay routing (Phase 8) ────────────────────

// Phase 8: in-flight relay requests, keyed by requestId. Each entry
// owns a 50ms token coalescer + a list of buffered text so we don't
// flood the Autobase with one append per token.
const relayHandlers = new Map()

// The worker pipe uses **hex** strings for writer keys (the worker's
// `appendRelayRequest` / `appendRelayResponse` / `appendRelayCancel`
// all do `b4a.from(key, 'hex')` before encoding the dispatch). But
// writer keys arrive in main.js in **z32** format — the worker's
// `me` frame emits z32, and the renderer's `peerAiStates` writer
// keys are z32. Convert at the boundary so the worker never sees a
// mismatched encoding. Passing a z32 string into `b4a.from(_, 'hex')`
// throws "Invalid input" (this is the bug the user hit).
function z32ToHex(z32Key) {
  if (typeof z32Key !== 'string' || z32Key.length === 0) return null
  try {
    return b4a.toString(z32.decode(z32Key), 'hex')
  } catch {
    return null
  }
}

// 50ms coalescing window — locked-in decision 1.
const RELAY_COALESCE_MS = 50

function routeChatCompletion({ requestId, targetWriterKey, messages, modelId }) {
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return { success: false, error: 'requestId required' }
  }
  if (typeof targetWriterKey !== 'string' || targetWriterKey.length === 0) {
    return { success: false, error: 'targetWriterKey required' }
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: false, error: 'messages required' }
  }
  if (typeof modelId !== 'string' || modelId.length === 0) {
    return { success: false, error: 'modelId required' }
  }
  const pipe = workers.get(roomWorkerSpecifier)?.pipe
  if (!pipe) return { success: false, error: 'Worker not running' }
  const myKeyZ32 = getLocalWriterKey()
  if (!myKeyZ32) return { success: false, error: 'Local writer key not ready' }
  // Convert z32 → hex for the worker pipe (see z32ToHex comment).
  const myKey = z32ToHex(myKeyZ32)
  const toKey = z32ToHex(targetWriterKey)
  if (!myKey || !toKey) {
    return { success: false, error: 'Writer key encoding failed' }
  }
  console.log(
    '[main] relay: routeChatCompletion',
    JSON.stringify({
      requestId,
      fromKey: myKey.slice(0, 8),
      toKey: toKey.slice(0, 8),
      modelId,
      messageCount: messages.length
    }).slice(0, 200)
  )
  try {
    pipe.write(
      JSON.stringify({
        type: 'relay-request',
        requestId,
        fromKey: myKey,
        toKey,
        messages,
        modelId,
        createdAt: Date.now()
      })
    )
    return { success: true, requestId }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Write failed'
    }
  }
}

function cancelRouteChat(requestId) {
  if (typeof requestId !== 'string') return { success: false, error: 'requestId required' }
  const pipe = workers.get(roomWorkerSpecifier)?.pipe
  if (!pipe) return { success: false }
  const myKeyZ32 = getLocalWriterKey()
  if (!myKeyZ32) return { success: false }
  // Convert z32 → hex for the worker pipe (see z32ToHex comment).
  const myKey = z32ToHex(myKeyZ32)
  if (!myKey) return { success: false, error: 'Writer key encoding failed' }
  // The worker's relay-cancel route needs to know which peer to send
  // to, so we look up the in-flight handler for the toKey.
  const handler = relayHandlers.get(requestId)
  const toKey = handler?.toKey ? z32ToHex(handler.toKey) : null
  try {
    pipe.write(
      JSON.stringify({
        type: 'relay-cancel',
        requestId,
        fromKey: myKey,
        toKey
      })
    )
  } catch {
    // best-effort
  }
  return { success: true }
}

// Phase 8: called by the room worker's `relay-run` frame. Runs a
// local completion and streams the events back as `relay-response`
// frames (one per kind with 50ms coalescing for token text).
async function handleRelayRun({ requestId, fromKey, messages, modelId }) {
  console.log(
    '[main] relay: handleRelayRun',
    JSON.stringify({
      requestId,
      fromKey: (fromKey || '').slice(0, 8),
      modelId,
      messageCount: (messages || []).length
    }).slice(0, 200)
  )
  if (relayHandlers.has(requestId)) {
    // Duplicate — drop. Single-flight per requestId.
    console.log('[main] relay: handleRelayRun duplicate, dropping')
    return
  }
  const entry = {
    requestId,
    fromKey,
    toKey: getLocalWriterKey(),
    pendingText: null,
    pendingKind: null,
    flushTimer: null,
    closed: false
  }
  relayHandlers.set(requestId, entry)

  // Convert the z32 writer keys to hex for the worker pipe (see
  // z32ToHex comment). The host stores them in z32 (canonical form)
  // for chat-attribution parity; the worker only deals in hex.
  entry.fromKeyHex = z32ToHex(entry.fromKey)
  entry.toKeyHex = z32ToHex(entry.toKey)
  if (!entry.fromKeyHex || !entry.toKeyHex) {
    sendImmediate('error', {
      error: { code: 'BAD_KEY', message: 'Writer key encoding failed', retryable: false }
    })
    sendImmediate('done')
    close()
    return
  }

  function flushBuffered() {
    if (entry.closed) return
    if (entry.pendingText === null && entry.pendingKind === null) return
    const pipe = workers.get(roomWorkerSpecifier)?.pipe
    if (!pipe) return
    try {
      pipe.write(
        JSON.stringify({
          type: 'relay-response',
          requestId: entry.requestId,
          fromKey: entry.toKeyHex,
          toKey: entry.fromKeyHex,
          kind: entry.pendingKind,
          ...(entry.pendingText !== null ? { text: entry.pendingText } : {})
        })
      )
    } catch (err) {
      console.warn('[main] relay-response write failed:', err)
    }
    entry.pendingText = null
    entry.pendingKind = null
    entry.flushTimer = null
  }
  function buffer(kind, text) {
    if (entry.closed) return
    if (entry.pendingKind && entry.pendingKind !== kind) flushBuffered()
    entry.pendingKind = kind
    entry.pendingText = (entry.pendingText ?? '') + (text ?? '')
    if (entry.flushTimer) return
    entry.flushTimer = setTimeout(flushBuffered, RELAY_COALESCE_MS)
  }
  function sendImmediate(kind, extra) {
    if (entry.closed) return
    flushBuffered()
    const pipe = workers.get(roomWorkerSpecifier)?.pipe
    if (!pipe) return
    try {
      pipe.write(
        JSON.stringify({
          type: 'relay-response',
          requestId: entry.requestId,
          fromKey: entry.toKeyHex,
          toKey: entry.fromKeyHex,
          kind,
          ...(extra || {})
        })
      )
    } catch (err) {
      console.warn('[main] relay-response write failed:', err)
    }
  }
  function close() {
    if (entry.closed) return
    entry.closed = true
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer)
      entry.flushTimer = null
    }
    flushBuffered()
    relayHandlers.delete(requestId)
  }

  // Run the local completion via aiChat, but subscribe to its
  // private stream so we can re-emit as relay-response. We can't
  // re-use the public `sendMessage` because that targets the
  // renderer's IPC channels, not the worker pipe.
  // Instead, we run a *parallel* drive that uses the same SDK
  // completion call but writes to our buffer/sendImmediate/close.
  try {
    const { completion } = require('@qvac/sdk')
    // The requester's `modelId` is the modelStore entry id (propagated
    // through `peerAiStates`), so compare against the same id locally.
    // The SDK uses its own internal `currentModelId` (`modelIdLive`),
    // which is a different identifier and must not be compared here.
    const entryIdLive = getActiveEntry()?.id ?? null
    const modelIdLive = getActiveModelId()
    console.log(
      '[main] relay: handleRelayRun model check',
      JSON.stringify({ modelId, entryIdLive, modelIdLive, match: entryIdLive === modelId }).slice(
        0,
        200
      )
    )
    if (!modelIdLive || !entryIdLive || entryIdLive !== modelId) {
      sendImmediate('error', {
        error: { code: 'MODEL_MISMATCH', message: 'Model not loaded here', retryable: false }
      })
      sendImmediate('done')
      close()
      return
    }
    if (!getLocalAiStateSnapshot().accepting) {
      console.log('[main] relay: handleRelayRun busy')
      sendImmediate('busy')
      sendImmediate('done')
      close()
      return
    }
    setStreamingNow(true)
    const history = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .map((m) => ({ role: m.role, content: m.content }))
    const run = completion({
      modelId: modelIdLive,
      history,
      stream: true,
      kvCache: true,
      captureThinking: true
    })
    sendImmediate('started', { requestId })
    for await (const event of run.events) {
      if (entry.closed) break
      if (event.type === 'contentDelta') {
        buffer('token', event.text)
      } else if (event.type === 'thinkingDelta') {
        buffer('thinking', event.text)
      } else if (event.type === 'completionDone') {
        flushBuffered()
        if (event.stopReason === 'error' && event.error) {
          sendImmediate('error', {
            error: { code: 'COMPLETION_ERROR', message: event.error.message, retryable: true }
          })
        }
        sendImmediate('done', { stopReason: event.stopReason ?? 'eos' })
        break
      }
    }
    setStreamingNow(false)
    pushAiStateToRoomWorker()
  } catch (err) {
    setStreamingNow(false)
    const mapped = mapError(err)
    sendImmediate('error', { error: mapped })
    sendImmediate('done')
  } finally {
    close()
  }
}

function handleRelayCancel({ requestId }) {
  const entry = relayHandlers.get(requestId)
  if (!entry) return
  entry.closed = true
  if (entry.flushTimer) {
    clearTimeout(entry.flushTimer)
    entry.flushTimer = null
  }
  // Best-effort: ask the SDK to cancel whatever the current model is
  // running. We don't track per-relay requestIds in the SDK, so this
  // is a coarse cancel — the owner's next drive loop iteration will
  // see `entry.closed` and break out.
  try {
    require('@qvac/sdk')
      .cancel({})
      .catch(() => {})
  } catch {
    // ignore
  }
  relayHandlers.delete(requestId)
}

let lastPeerAiStates = []

function setLastPeerAiStates(states) {
  lastPeerAiStates = Array.isArray(states) ? states : []
  // Push to every renderer.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('ai:peerStates', lastPeerAiStates)
    }
  }
}

// Local writer key (z32) — the room worker publishes this in its
// initial `me` frame; main caches it here for relay routing.
let localWriterKey = null
function setLocalWriterKey(z32key) {
  localWriterKey = z32key
}
function getLocalWriterKey() {
  return localWriterKey
}

function handleDeepLink(url) {
  console.log('deep link:', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
    // Write qvac.config.json BEFORE any SDK call so the worker writes
    // its cache to a path we can inspect + reset.
    ensureQvacConfig()

    // AI / Models IPC must be registered before the renderer fires its
    // first invoke; the renderer's useAI() hydrates status() on mount.
    registerModelsIpc()
    registerChatIpc()

    // Create the 'main' AI chat session directory + empty
    // messages.json so the first `sessions:list` from the renderer
    // always finds at least the pinned entry.
    sessions.ensureMainSession()

    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    // Hand the BrowserWindow off to the QVAC layer so it can push
    // `models:progress` / `models:error` events, and to aiChat so it
    // can push `ai:chat:*` streaming events.
    const win = BrowserWindow.getAllWindows()[0] ?? null
    setMainWindow(win)
    aiChat.setMainWindow(win)

    // Phase 7: seed the no-model row so the `@tamarind/ai-state`
    // collection has a record for this writer from the first frame.
    // The worker reads this and dispatches `update-ai-state`. Once
    // the worker is up the per-window writer key is captured by the
    // `me` frame interceptor above.
    setTimeout(() => pushAiStateToRoomWorker(), 250)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
          .then(() => {
            const w = BrowserWindow.getAllWindows()[0] ?? null
            setMainWindow(w)
            aiChat.setMainWindow(w)
          })
          .catch((err) => {
            console.error('Failed to create window:', err)
          })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Cancel any in-flight request and unload the model on quit so we
  // don't leave partial cache files behind or a hanging worker.
  app.on('before-quit', async () => {
    try {
      await cancelCurrentRequest({ clearCache: true })
    } catch (e) {
      console.warn('[qvac] before-quit cancel failed:', e)
    }
    try {
      await aiChat.cancelMessage()
    } catch (e) {
      console.warn('[aiChat] before-quit cancel failed:', e)
    }
    const modelId = getActiveModelId()
    if (modelId) {
      try {
        await unloadCurrent(modelId)
        console.log('[qvac] Model unloaded on exit')
      } catch (error) {
        console.error('Failed to unload model:', error)
      }
    }
  })
}
