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
  mapError,
  buildStatus,
  resetCache
} = require('./qvac')
const { modelStore } = require('./modelStore')
const path = require('path')
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')

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

    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    // Hand the BrowserWindow off to the QVAC layer so it can push
    // `models:progress` / `models:error` events.
    setMainWindow(BrowserWindow.getAllWindows()[0] ?? null)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
          .then(() => {
            setMainWindow(BrowserWindow.getAllWindows()[0] ?? null)
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
