// Tamarind room-worker entrypoint. Lives in Bare (pear-runtime worker
// process spawned by `electron/main.js`). Owns the data plane:
//
//   • Corestore  (Autobase + Hyperswarm replication on disk)
//   • Hyperswarm (peer discovery; replicates the store on every conn)
//   • TamarindRoom (encrypted Autobase + BlindPairing)
//   • Identity (writer key + display name → identity.json on disk)
//   • IPC pipe (FramedStream over Bare.IPC → framed JSON to renderer)
//
// Renderer-side counterpart: `renderer/src/hooks/useRoom.ts`. Wire
// protocol documented in `C:\Users\pisut\.claude\plans\nested-beaming-reef.md`.

const Autobase = require('autobase')
const Corestore = require('corestore')
const debounce = require('debounceify')
const FramedStream = require('framed-stream')
const fs = require('bare-fs')
const goodbye = require('graceful-goodbye')
const HypercoreCrypto = require('hypercore-crypto')
const Hyperswarm = require('hyperswarm')
const path = require('bare-path')
const ReadyResource = require('ready-resource')
const { command, flag } = require('paparam')
const z32 = require('z32')

const TamarindRoom = require('./tamarind-room')

const cmd = command(
  'tamarind-room',
  flag('--name|-n <name>', 'Your display name'),
  flag('--invite|-i <invite>', 'Invite code to join an existing room'),
  flag('--writer <hex>', 'Override the writer key (hex)')
)

// argv layout from electron/main.js `getWorker()`:
//   argv[0]      = bare binary
//   argv[1]      = path to this entry script
//   argv[2]      = storage dir (read below)
//   argv[3..7]   = 5 more positional args shared with the updater worker:
//                    [appPath, updates, version, upgrade, productName+ext]
//   argv[8..]    = room-worker flags: [--name N] [--invite Z] [--writer H]
// paparam must only see the flag tail — feeding it the updater positionals
// triggers `Bail: UNKNOWN_ARG` on the first non-flag (e.g. 'null'). Locate
// the first `--flag` so we don't hardcode a slice index that would drift
// if `getWorker()` adds or removes a positional later.
const storage = path.join(Bare.argv[2], 'app-storage')
const identityPath = path.join(Bare.argv[2], 'identity.json')
const firstFlag = Bare.argv.findIndex((a, i) => i >= 3 && a.startsWith('-'))
const flagArgs = firstFlag >= 0 ? Bare.argv.slice(firstFlag) : []
cmd.parse(flagArgs)
const initialName = cmd.flags.name || null
const initialInvite = cmd.flags.invite || null
const writerOverride = cmd.flags.writer || null

class TamarindRoomWorkerTask extends ReadyResource {
  constructor(pipe, opts = {}) {
    super()
    this.pipe = pipe
    this.storage = storage
    this._initialInvite = opts.invite
    this._requestedName = opts.name

    this.identity = null // { key: Buffer (writer pubkey), name: string }
    this.peers = 0

    this.store = new Corestore(storage)
    this.swarm = new Hyperswarm()
    this.swarm.on('connection', (conn) => {
      console.log(`[tamarind-room] swarm connection opened (peers=${this.peers + 1})`)
      this.store.replicate(conn)
      this._peers(1)
      conn.once('close', () => {
        console.log(`[tamarind-room] swarm connection closed (peers=${this.peers - 1})`)
        this._peers(-1)
      })
    })

    this.room = new TamarindRoom(this.store, this.swarm, this._initialInvite)
    this.debounceBroadcast = debounce(() => this._broadcast())
    this.room.on('update', () => this.debounceBroadcast())
  }

  async _open() {
    await this.store.ready()
    await this._loadIdentity()
    await this.room.ready()

    // Tell the renderer about the writer's stable pubkey + display
    // name. Used by GroupChatPanel to label "You" for messages from
    // this writer.
    this.pipe.write(
      JSON.stringify({
        type: 'me',
        key: z32.encode(this.identity.key),
        name: this.identity.name
      })
    )

    // Push the invite code as soon as the room is open. Idempotent —
    // if the host reloads, the same invite comes back; if a guest
    // joined, the host still mints one for newcomers.
    this.pipe.write(JSON.stringify({ type: 'invite', invite: await this.room.getInvite() }))
    // Role detection: a worker launched with an `--invite` joined an
    // existing room (guest). A worker with no `--invite` minted a fresh
    // room and is its host. Hardcoding `'host'` made both windows call
    // themselves host, hiding real P2P bugs behind incorrect UI state.
    const role = this._initialInvite ? 'guest' : 'host'
    console.log(
      `[tamarind-room] role resolved: ${role} (initialInvite=${this._initialInvite ? 'set' : 'null'})`
    )
    this.pipe.write(JSON.stringify({ type: 'role', role, writable: this.room.isWritable() }))
    this.pipe.write(JSON.stringify({ type: 'status', phase: 'ready' }))

    // One-shot first-time bootstrap: seed an Untitled board if the
    // Autobase is empty. This used to live in `_broadcast` but two
    // concurrent broadcasts (one for `_open`, one for the bootstrap
    // append's own `update` event) would both observe `boards.length
    // === 0` and append duplicates. Lifting it to `_open` and gating
    // with a flag keeps it strictly idempotent.
    await this._ensureDefaultBoard()

    // Listen for renderer frames.
    this.pipe.on('data', (data) => {
      let message
      try {
        message = JSON.parse(data.toString())
      } catch (err) {
        console.error('[tamarind-room] malformed frame:', err)
        return
      }
      console.log(
        `[tamarind-room] frame from renderer: type=${message && message.type}`,
        message && message.type === 'state-action'
          ? `action=${JSON.stringify(message.action).slice(0, 200)}`
          : ''
      )
      this._onFrame(message).catch((err) => {
        console.error('[tamarind-room] _onFrame threw:', err)
        this.pipe.write(JSON.stringify({ type: 'status', phase: 'error', error: err.message }))
      })
    })

    await this._broadcast()
  }

  async _close() {
    await this.room.close()
    await this.swarm.destroy()
    await this.store.close()
  }

  async _onFrame(message) {
    switch (message.type) {
      case 'state-action':
        await this._handleStateAction(message.action)
        return
      case 'send-chat':
        await this.room.addMessage(message.text, {
          name: this.identity.name,
          key: z32.encode(this.identity.key),
          at: Date.now()
        })
        return
      case 'remove-chats':
        // Mirror the canvasReducer's split: ids=[] means "clear all",
        // ids=[id1, ...] means delete those. Permission model is
        // "if you can append, you can delete" — same as add-chat above.
        if (!Array.isArray(message.ids)) return
        await this.room.appendRemoveChats(message.ids)
        return
      case 'join-invite':
        // Joining after open is a no-op in v1 (a guest must restart
        // with --invite). Stays as a stub so the renderer can call
        // it without a runtime crash.
        return
      case 'create-invite':
        // Always returns the existing invite in v1.
        this.pipe.write(JSON.stringify({ type: 'invite', invite: await this.room.getInvite() }))
        return
      case 'rename-self':
        this.identity.name = message.name || this.identity.name
        await this._persistIdentity()
        // Re-push the `me` event so the renderer's `useRoom.me` updates
        // and the splash's "Signed in as <name>" label reflects the
        // rename immediately. Otherwise `me` stays at its boot-time
        // value (the writer-pubkey-derived default) until the next
        // worker restart.
        this.pipe.write(
          JSON.stringify({
            type: 'me',
            key: z32.encode(this.identity.key),
            name: this.identity.name
          })
        )
        return
      default:
        return
    }
  }

  async _handleStateAction(action) {
    if (!action || !action.type) return
    console.log(`[tamarind-room] _handleStateAction: type=${action.type}`)
    // Local-only actions — never appended, never sent.
    const localOnly = new Set(['undo', 'redo', 'snapshot', 'set-active', 'reorder-boards'])
    if (localOnly.has(action.type)) return
    if (action.type === 'update-item' && action.meta && action.meta.transient) return
    const { meta: _meta, ...clean } = action
    if (clean.type === 'update-item') {
      // Strip transient flag off the wire payload.
      delete clean.meta
    }

    if (
      clean.type === 'add-board' ||
      clean.type === 'rename-board' ||
      clean.type === 'delete-board'
    ) {
      console.log(`[tamarind-room] appending ${clean.type}:`, JSON.stringify(clean).slice(0, 200))
      await this.room.appendBoard(clean)
      return
    }
    if (
      clean.type === 'add-item' ||
      clean.type === 'add-items' ||
      clean.type === 'update-item' ||
      clean.type === 'reorder' ||
      clean.type === 'remove-item' ||
      clean.type === 'remove-items'
    ) {
      console.log(`[tamarind-room] appending ${clean.type}:`, JSON.stringify(clean).slice(0, 200))
      await this.room.appendItem(clean)
    }
  }

  async _broadcast() {
    try {
      const boards = await this.room.getBoards()
      console.log(
        `[tamarind-room] _broadcast start (peers=${this.peers}, boards=${boards.length}, writable=${this.room.isWritable()})`
      )
      const [snapshot, messages] = await Promise.all([
        this.room.buildSnapshot(),
        this.room.getMessages()
      ])
      messages.sort((a, b) => {
        const aAt = a.info?.at ?? 0
        const bAt = b.info?.at ?? 0
        return aAt - bAt
      })
      console.log(
        `[tamarind-room] _broadcast emit (boards=${snapshot.boards.length}, items=${snapshot.items.length}, chat=${messages.length})`
      )
      this.pipe.write(JSON.stringify({ type: 'snapshot', state: snapshot }))
      this.pipe.write(JSON.stringify({ type: 'chat', messages }))
    } catch (err) {
      this.pipe.write(JSON.stringify({ type: 'status', phase: 'error', error: err.message }))
    }
  }

  // One-shot: seed a single Untitled board the first time a host
  // worker opens an empty Autobase. Gated by a flag so concurrent
  // openings (multiple broadcasts of the same state) can't both append.
  async _ensureDefaultBoard() {
    if (this._defaultBoardBootstrapped) return
    this._defaultBoardBootstrapped = true
    if (!this.room.isWritable()) return
    const existing = await this.room.getBoards()
    if (existing.length > 0) return
    const b4a = require('b4a')
    const now = Date.now()
    const id = Buffer.alloc(16)
    id.writeUInt32BE(now >>> 0, 12)
    console.log('[tamarind-room] seeding default Untitled board')
    await this.room.appendBoard({
      type: 'add-board',
      board: {
        id: b4a.toString(id, 'hex'),
        name: 'Untitled',
        createdAt: now,
        updatedAt: now,
        order: 0
      }
    })
  }

  _peers(delta) {
    this.peers = Math.max(0, this.peers + delta)
    this.pipe.write(JSON.stringify({ type: 'peers', count: this.peers }))
  }

  // Generate a fresh Hyperswarm keypair on first launch and stash the
  // writer pubkey + display name in <userData>/identity.json. The
  // renderer reads this back so the splash can pre-fill the name
  // modal. Subsequent launches reuse the same key so the same writer
  // always shows the same "You" key in chat attribution.
  async _loadIdentity() {
    if (writerOverride) {
      const key = Buffer.from(writerOverride, 'hex')
      if (key.length !== 32) throw new Error('writer override must be 32-byte hex')
      this.identity = { key, name: this._requestedName || `User-${key.toString('hex').slice(-4)}` }
      return
    }
    let existing = null
    try {
      const raw = await fs.promises.readFile(identityPath)
      existing = JSON.parse(raw.toString())
    } catch {
      existing = null
    }
    if (existing && Buffer.isBuffer(existing.key)) {
      this.identity = {
        key: existing.key,
        name:
          this._requestedName || existing.name || `User-${existing.key.toString('hex').slice(-4)}`
      }
    } else {
      const { publicKey } = HypercoreCrypto.keyPair()
      this.identity = {
        key: publicKey,
        name: this._requestedName || `User-${publicKey.toString('hex').slice(-4)}`
      }
      await this._persistIdentity()
    }
  }

  async _persistIdentity() {
    const tmp = identityPath + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify(this.identity))
    await fs.promises.rename(tmp, identityPath)
  }
}

async function main() {
  const pipe = new FramedStream(Bare.IPC)
  pipe.pause()

  // Build / load the userData dir up-front so identity.json has
  // somewhere to land before the worker task opens.
  await fs.promises.mkdir(storage, { recursive: true })
  await fs.promises.mkdir(path.dirname(identityPath), { recursive: true })

  // When this worker was spawned with --invite (host → guest mid-
  // session swap via the splash's "Join existing board" toggle) the
  // local Corestore may already have an Autobase from the previous
  // host-mode boot. TamarindRoom's `addCandidate` branch is gated on
  // an empty local core (see tamarind-room.js:48) — so without this
  // wipe, the new worker would skip the actual join and stay on its
  // old local key with role=guest + 0 peers. Wiping the Corestore
  // directory before constructing the task forces addCandidate to
  // actually run. `identity.json` lives outside `app-storage` so the
  // writer key + display name survive the wipe.
  if (initialInvite) {
    const probeStore = new Corestore(storage)
    const probe = Autobase.getLocalCore(probeStore)
    await probe.ready()
    const len = probe.length
    await probe.close()
    await probeStore.close()
    if (len > 0) {
      console.log(`[tamarind-room] wiping local storage (length=${len}) to honor --invite`)
      await fs.promises.rm(storage, { recursive: true, force: true })
      await fs.promises.mkdir(storage, { recursive: true })
    }
  }

  const task = new TamarindRoomWorkerTask(pipe, {
    invite: initialInvite,
    name: initialName
  })
  goodbye(() => task.close())

  await task.ready()
  pipe.resume()

  console.log(`[tamarind-room] storage: ${storage}`)
  console.log(`[tamarind-room] invite: ${await task.room.getInvite()}`)
}

main().catch((err) => {
  console.error('[tamarind-room] fatal:', err)
  Bare.exit(1)
})
