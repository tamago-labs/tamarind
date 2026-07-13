// Tamarind room-worker entrypoint. Lives in Bare (pear-runtime worker
// process spawned by `electron/main.js`). Owns the data plane:
//
//   • Corestore  (Autobase + Hyperswarm replication on disk)
//   • Hyperswarm (peer discovery; replicates the store on every conn)
//   • TamarindRoom (encrypted Autobase + BlindPairing)
//   • Identity (writer key + display name → identity.json on disk)
//   • IPC pipe (FramedStream over Bare.IPC → framed JSON to renderer)
//
// Renderer-side counterpart: `renderer/src/hooks/useRoom.ts`. 

const Autobase = require('autobase')
const b4a = require('b4a')
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
    // Alias for the local writer's keypair. The actual instance
    // lives on the room (`this.room.localBase`); aliasing here so
    // `this.localBase.key` works the same in the entry file as it
    // does in `tamarind-room.js` itself. The original identity
    // design stored a separate keypair on the task, so this alias
    // didn't exist — the new design uses the Corestore's writer
    // key everywhere.
    this.localBase = this.room.localBase
    this.debounceBroadcast = debounce(() => this._broadcast())
    this.room.on('update', () => this.debounceBroadcast())

    // Initialize Hyperblobs and blob server for video streaming (per Pear docs)
    const Hyperblobs = require('hyperblobs')
    const BlobServer = require('hypercore-blob-server')
    this.blobs = new Hyperblobs(this.store.get({ name: 'blobs' }))
    this.blobServer = new BlobServer(this.store.session(), { sandbox: false })
    this.blobsCores = {}
  }

  async _open() {
    await this.store.ready()
    // _loadIdentity reads `this.localBase.key` (via `localBase.key`),
    // which is only available after the room is open. The
    // constructor sets `localBase` synchronously but the key is
    // populated during `room.ready()`. The previous identity
    // design generated a fresh `HypercoreCrypto.keyPair()` here
    // so it didn't need the localBase, but the new design (where
    // the identity is just a display name and the key is
    // `localBase.key` everywhere) requires the room to be ready
    // first.
    await this.room.ready()
    await this._loadIdentity()

    // Start blob server for video streaming (per Pear docs)
    await this.blobs.ready()
    await this.blobServer.listen()
    console.log(`[tamarind-room] blob server listening`)

    await this.blobServer.listen()
    console.log(`[tamarind-room] blob server listening`)

    // Append identity to Autobase so remote peers see the display name.
    await this.room.appendIdentity({ displayName: this.identity.name })

    // Tell the renderer about the writer's stable pubkey + display
    // name. Used by GroupChatPanel to label "You" for messages from
    // this writer. The key MUST be `this.localBase.key` (not
    // `this.identity.key`) so the renderer's `me.key` matches the
    // writer key broadcast in `peerAiStates` (which is keyed by
    // `localBase.key` in `appendAiState`). The two are independent
    // random keys — using `identity.key` here silently breaks the
    // Setup tab's local-writer filter and the relay-routing match
    // in `onRelayRequest` (request toKey comes from peerAiStates).
    this.pipe.write(
      JSON.stringify({
        type: 'me',
        key: z32.encode(this.localBase.key),
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
        `[tamarind-room] frame: type=${message && message.type}`,
        message && message.type === 'state-action'
          ? `action=${JSON.stringify(message.action).slice(0, 200)}`
          : ''
      )
      // Phase 7 + 8: these frames come from main (not the renderer)
      // and trigger P2P actions on the local writer's behalf.
      if (message && message.type === 'ai-state-snapshot') {
        this.room
          .appendAiState(message.snapshot || {})
          .then(() => this.debounceBroadcast())
          .catch((err) => console.error('[tamarind-room] appendAiState failed:', err))
        return
      }
      if (message && message.type === 'relay-request') {
        console.log(
          '[tamarind-room] relay: appendRelayRequest',
          JSON.stringify({
            requestId: message.requestId,
            toKey: (message.toKey || '').slice(0, 8)
          }).slice(0, 200)
        )
        this.room
          .appendRelayRequest(message)
          .catch((err) => console.error('[tamarind-room] appendRelayRequest failed:', err))
        return
      }
      if (message && message.type === 'relay-response') {
        // The host (or whoever is running the completion) sends a
        // `relay-response` pipe frame per token / kind / done. We
        // append it to the Autobase as a `@tamarind/relay-response`
        // dispatch so the requester can read it back via the
        // `onRelayResponse` route handler. Without this handler the
        // host's response stream is silently dropped — the requester
        // never sees any tokens.
        console.log(
          '[tamarind-room] relay: appendRelayResponse',
          JSON.stringify({ requestId: message.requestId, kind: message.kind }).slice(0, 200)
        )
        this.room
          .appendRelayResponse(message)
          .catch((err) => console.error('[tamarind-room] appendRelayResponse failed:', err))
        return
      }
      if (message && message.type === 'relay-cancel') {
        console.log(
          '[tamarind-room] relay: appendRelayCancel',
          JSON.stringify({ requestId: message.requestId }).slice(0, 200)
        )
        this.room
          .appendRelayCancel(message)
          .catch((err) => console.error('[tamarind-room] appendRelayCancel failed:', err))
        return
      }
      this._onFrame(message).catch((err) => {
        console.error('[tamarind-room] _onFrame threw:', err)
        this.pipe.write(JSON.stringify({ type: 'status', phase: 'error', error: err.message }))
      })
    })

    // Phase 8: relay route handlers. When a peer's `relay-request`
    // lands at this writer (`toKey === myKey`), ask main to run a
    // local completion. When a `relay-response` from a peer arrives,
    // forward to main so it can push to the renderer's
    // `ai:chat:relay-event` channel.
    //
    // The dispatch decoder returns **Buffer** for `buffer`-typed
    // fields (see `spec/dispatch/messages.js` `c.buffer.decode`).
    // The local identity key is a Buffer too. We compare buffers
    // directly — DON'T compare to `z32.encode(...)` because that
    // would compare a Buffer to a string, which is always false and
    // would silently drop every relay request.
    this.room.onRelayRequest = (data) => {
      // Compare against `localBase.key` so it matches the writer
      // key broadcast in `peerAiStates` (which is `localBase.key`).
      // See the `me` event comment above.
      const myKey = this.localBase.key
      if (!b4a.equals(data.toKey, myKey)) {
        console.log(
          '[tamarind-room] relay: onRelayRequest not for me',
          JSON.stringify({
            requestId: data.requestId,
            myKey: z32.encode(myKey).slice(0, 8),
            toKey: z32.encode(data.toKey).slice(0, 8)
          }).slice(0, 200)
        )
        return
      }
      console.log(
        '[tamarind-room] relay: onRelayRequest matched',
        JSON.stringify({
          requestId: data.requestId,
          fromKey: z32.encode(data.fromKey).slice(0, 8)
        }).slice(0, 200)
      )
      this.pipe.write(
        JSON.stringify({
          type: 'relay-run',
          requestId: data.requestId,
          // Send the fromKey as z32 — main keeps the canonical
          // writer-key in z32 form for chat-attribution parity.
          fromKey: z32.encode(data.fromKey),
          messages: data.messages,
          modelId: data.modelId
        })
      )
    }
    this.room.onRelayResponse = (data) => {
      // I'm the requester. Push the event to the renderer via main.
      console.log(
        '[tamarind-room] relay: onRelayResponse (I am requester)',
        JSON.stringify({ requestId: data.requestId, kind: data.kind }).slice(0, 200)
      )
      this.pipe.write(
        JSON.stringify({
          type: 'relay-event',
          requestId: data.requestId,
          kind: data.kind,
          text: data.text ?? null,
          error: data.error ?? null
        })
      )
    }
    this.room.onRelayCancel = (data) => {
      // Compare against `localBase.key` — see `onRelayRequest`.
      const myKey = this.localBase.key
      if (!b4a.equals(data.toKey, myKey)) {
        console.log(
          '[tamarind-room] relay: onRelayCancel not for me',
          JSON.stringify({
            requestId: data.requestId,
            myKey: z32.encode(myKey).slice(0, 8),
            toKey: z32.encode(data.toKey).slice(0, 8)
          }).slice(0, 200)
        )
        return
      }
      console.log(
        '[tamarind-room] relay: onRelayCancel matched',
        JSON.stringify({ requestId: data.requestId }).slice(0, 200)
      )
      this.pipe.write(JSON.stringify({ type: 'relay-cancel', requestId: data.requestId }))
    }

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
          // Use `localBase.key` so the chat's `info.key` matches the
          // local writer's `me.key` (also `localBase.key` now). The
          // previous `this.identity.key` was a separate random
          // keypair that no longer aligned.
          key: z32.encode(this.localBase.key),
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
        // Append identity to Autobase so remote peers see the new name.
        await this.room.appendIdentity({ displayName: this.identity.name })
        // Re-push the `me` event so the renderer's `useRoom.me` updates
        // and the splash's "Signed in as <name>" label reflects the
        // rename immediately. Otherwise `me` stays at its boot-time
        // value (the writer-pubkey-derived default) until the next
        // worker restart.
        this.pipe.write(
          JSON.stringify({
            type: 'me',
            key: z32.encode(this.localBase.key),
            name: this.identity.name
          })
        )
        return
      case 'upload-media':
        // Handle video upload from renderer
        await this._handleUploadMedia(message)
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

  async _handleUploadMedia({ boardId, fileName, mimeType, size, data }) {
    try {
      // Send progress: starting
      this.pipe.write(JSON.stringify({ type: 'upload-progress', phase: 'writing', fileName }))

      // Write file to Hyperblobs using put method (per Pear docs)
      const idEnc = require('hypercore-id-encoding')
      const buffer = Buffer.from(data)
      const blobId = await this.blobs.put(buffer)

      // Create blob descriptor per docs
      const blob = { key: idEnc.normalize(this.blobs.core.key), ...blobId }

      // Send progress: adding to Autobase
      this.pipe.write(JSON.stringify({ type: 'upload-progress', phase: 'indexing', fileName }))

      // Add media reference to Autobase with blob descriptor
      await this.room.addMedia({
        boardId,
        type: 'video',
        blob,
        fileName,
        mimeType,
        size
      })

      // Construct HTTP URL using blobServer.getLink with blob descriptor
      const videoUrl = this.blobServer.getLink(blob.key, { blob, type: mimeType })

      // Find the video item by fileName and update it
      const items = await this.room.getItems()
      const videoItem = items.find(
        (item) => item.type === 'video' && item.videoFileName === fileName
      )

      if (videoItem) {
        await this.room.appendItem({
          type: 'update-item',
          id: b4a.toString(videoItem.id, 'hex'),
          patch: { videoUrl },
          at: Date.now()
        })
        console.log(`[tamarind-room] updated video item with HTTP URL`)
      } else {
        console.log(`[tamarind-room] video item not found for ${fileName}`)
      }

      console.log(`[tamarind-room] uploaded video: ${fileName} (${size} bytes)`)
    } catch (err) {
      console.error('[tamarind-room] upload failed:', err)
      this.pipe.write(JSON.stringify({ type: 'upload-error', fileName, error: err.message }))
    }
  }

  async _broadcast() {
    try {
      const boards = await this.room.getBoards()
      console.log(
        `[tamarind-room] _broadcast start (peers=${this.peers}, boards=${boards.length}, writable=${this.room.isWritable()})`
      )
      const [snapshot, messages, aiStatesRaw, identities] = await Promise.all([
        this.room.buildSnapshot(),
        this.room.getMessages(),
        this.room.getAiStates(),
        this.room.getIdentities()
      ])
      messages.sort((a, b) => {
        const aAt = a.info?.at ?? 0
        const bAt = b.info?.at ?? 0
        return aAt - bAt
      })
      // Map writerKey from hex (storage format) to z32 (chat-attribution
      // format) so the renderer can join against `useRoom.me.key`
      // without an extra lookup. We also need the display name of each
      // writer; the local worker has only its own name. Remote names
      // fall back to the z32 key prefix — same convention as chat.
      const aiStates = aiStatesRaw.map((s) => ({
        writerKey: z32.encode(b4a.from(s.writerKey, 'hex')),
        modelId: s.modelId,
        modelName: s.modelName,
        loadedAt: s.loadedAt,
        accepting: s.accepting
      }))
      // Map identities to z32 keys for renderer lookup.
      const identitiesMap = identities.map((id) => ({
        writerKey: z32.encode(b4a.from(id.writerKey, 'hex')),
        displayName: id.displayName,
        updatedAt: id.updatedAt
      }))
      console.log(
        `[tamarind-room] _broadcast emit (boards=${snapshot.boards.length}, items=${snapshot.items.length}, chat=${messages.length}, ai=${aiStates.length}, identities=${identitiesMap.length})`
      )
      this.pipe.write(JSON.stringify({ type: 'snapshot', state: snapshot }))
      this.pipe.write(JSON.stringify({ type: 'chat', messages }))
      this.pipe.write(JSON.stringify({ type: 'ai-states', states: aiStates }))
      this.pipe.write(JSON.stringify({ type: 'identities', identities: identitiesMap }))
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

  // Load the display name from <userData>/identity.json if it
  // exists, otherwise pick a default based on the local writer's
  // key suffix. The writer key is **not** persisted here — it's
  // `this.localBase.key` everywhere. The previous design stored a
  // separate `HypercoreCrypto.keyPair()` in this file, but the
  // Corestore's localBase already provides a keypair; persisting a
  // second one caused the relay-routing identity check to diverge
  // from the ai-state's writerKey (they were two independent
  // random keys), which silently dropped every relay request.
  async _loadIdentity() {
    if (writerOverride) {
      // `--writer <hex>` still wins. The identity here is treated
      // as a display-only name; the actual writer key for routing
      // is `this.localBase.key` (set up via Corestore).
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
    const persistedName = existing && typeof existing.name === 'string' ? existing.name : null
    const defaultSuffix = this.localBase.key.toString('hex').slice(-4)
    this.identity = {
      key: this.localBase.key,
      name: this._requestedName || persistedName || `User-${defaultSuffix}`
    }
    // Persist the display name on first boot so the same name
    // shows up across launches. The key is `this.localBase.key`
    // (not stored) — it's regenerated by Corestore if storage is
    // wiped, so storing it would be stale on the next boot
    // anyway.
    if (!persistedName) {
      await this._persistIdentity()
    }
  }

  async _persistIdentity() {
    // Only persist the display name — the writer key is
    // `this.localBase.key`, regenerated by Corestore if storage is
    // wiped. Storing the key would just leave a stale field in the
    // JSON for a future bug to read.
    const tmp = identityPath + '.tmp'
    await fs.promises.writeFile(tmp, JSON.stringify({ name: this.identity.name }))
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
