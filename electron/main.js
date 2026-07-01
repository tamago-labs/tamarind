const { app, BrowserWindow, ipcMain } = require('electron')
const os = require('os')
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
    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
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
}
