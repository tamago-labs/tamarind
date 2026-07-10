// TamarindRoom — the data plane for a Tamarind P2P room.
//
// Wraps an encrypted Autobase with a HyperDB view of four collections
// (boards, items, chat, invites) and BlindPairing for inviting new
// peers. Mirrors example-2-pear-chat/workers/chat-room.js but adds
// boards + items persistence plus a snapshot builder that the
// renderer dispatches into the canvasReducer via its existing
// `snapshot` action.
//
// Lifecycle: ReadyResource — caller awaits `room.ready()` before
// assuming the Autobase is writable.

const Autobase = require('autobase')
const b4a = require('b4a')
const BlindPairing = require('blind-pairing')
const HyperDB = require('hyperdb')
const ReadyResource = require('ready-resource')
const z32 = require('z32')

const TamarindDispatch = require('../spec/dispatch')
const TamarindDb = require('../spec/db')

class TamarindRoom extends ReadyResource {
  constructor(store, swarm, invite) {
    super()

    this.store = store
    this.swarm = swarm
    this.invite = invite

    this.pairing = new BlindPairing(swarm)

    this.router = new TamarindDispatch.Router()
    this._setupRouter()

    this.localBase = Autobase.getLocalCore(this.store)
    this.base = null
    this.pairMember = null
  }

  async _open() {
    await this.localBase.ready()
    const localKey = this.localBase.key
    const isEmpty = this.localBase.length === 0

    let key
    let encryptionKey
    if (isEmpty && this.invite) {
      const res = await new Promise((resolve) => {
        this.pairing.addCandidate({
          invite: z32.decode(this.invite),
          userData: localKey,
          onadd: resolve
        })
      })
      key = res.key
      encryptionKey = res.encryptionKey
    }

    await this.localBase.close()
    this.base = new Autobase(this.store, key, {
      encrypt: true,
      encryptionKey,
      open: this._openBase.bind(this),
      close: this._closeBase.bind(this),
      apply: this._applyBase.bind(this)
    })

    const writablePromise = new Promise((resolve) => {
      this.base.on('update', () => {
        if (this.base.writable) resolve()
        if (!this.base._interrupting) this.emit('update')
      })
    })
    await this.base.ready()
    this.swarm.join(this.base.discoveryKey)
    if (!this.base.writable) await writablePromise

    this.view.core.download({ start: 0, end: -1 })

    this.pairMember = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: async (request) => {
        const inv = await this.view.findOne('@tamarind/invites', { id: request.inviteId })
        if (!inv) return
        request.open(inv.publicKey)
        await this.addWriter(request.userData)
        request.confirm({
          key: this.base.key,
          encryptionKey: this.base.encryptionKey
        })
      }
    })
  }

  async _close() {
    await this.pairMember?.close()
    await this.base?.close()
    await this.localBase.close()
    await this.pairing.close()
  }

  _openBase(store) {
    return HyperDB.bee(store.get('view'), TamarindDb, { extension: false, autoUpdate: true })
  }

  async _closeBase(view) {
    await view.close()
  }

  async _applyBase(nodes, view, base) {
    for (const node of nodes) {
      console.log(
        `[tamarind-room] apply node (length=${base.length}, value=${JSON.stringify(node.value).slice(0, 80)})`
      )
      await this.router.dispatch(node.value, { view, base })
    }
    await view.flush()
  }

  _setupRouter() {
    // Membership + invite plumbing.
    this.router.add('@tamarind/add-writer', async (data, context) => {
      await context.base.addWriter(data.key)
    })
    this.router.add('@tamarind/add-invite', async (data, context) => {
      await context.view.insert('@tamarind/invites', data)
    })

    // Canvas state — one route per canvasReducer action.
    this.router.add('@tamarind/add-board', async (data, context) => {
      await context.view.insert('@tamarind/boards', data)
    })
    this.router.add('@tamarind/rename-board', async (data, context) => {
      // HyperDB has no `update` — get + delete + insert. Without this,
      // the old `view.update` call silently treated the {id} arg as a
      // bee.update(opts) and did nothing, so board renames appeared to
      // succeed locally but never round-tripped through the autobase.
      await applyUpdate(context.view, '@tamarind/boards', { id: data.id }, (b) => ({
        ...b,
        name: data.name,
        updatedAt: data.at
      }))
    })
    this.router.add('@tamarind/delete-board', async (data, context) => {
      // Last-board guard: refuse to delete the only remaining board.
      // Mirrors the same guard in canvasReducer (renderer) and the
      // BoardsMenu UI hide. Without this a peer's stray delete-board
      // could empty the autobase and leave every peer without an
      // active board on the next snapshot.
      const existingBoards = await context.view.find('@tamarind/boards', {}).toArray()
      if (existingBoards.length <= 1) return
      const targetExists = existingBoards.some((b) => b4a.equals(b.id, data.id))
      if (!targetExists) return
      // Cascade-delete shapes on this board; mirrors the reducer's
      // delete-board branch so peers converge identically. Pass the
      // id wrapped in a query object — `view.delete(name, buffer)`
      // routes through collection.encodeKey(buffer) which then does
      // `buffer.id`, and Buffer has no .id field, so the call throws
      // `Cannot read properties of undefined (reading 'buffer')` (see
      // smoke stack at tamarind-room.js:161).
      const items = await context.view.find('@tamarind/items', {}).toArray()
      for (const item of items) {
        if (b4a.equals(item.boardId, data.id)) {
          await context.view.delete('@tamarind/items', { id: item.id })
        }
      }
      await context.view.delete('@tamarind/boards', { id: data.id })
    })

    this.router.add('@tamarind/add-item', async (data, context) => {
      await context.view.insert('@tamarind/items', data)
    })
    this.router.add('@tamarind/add-items', async (data, context) => {
      // `data.items` is a JSON array of full items.
      for (const item of data.items) {
        await context.view.insert('@tamarind/items', item)
      }
    })
    this.router.add('@tamarind/update-item', async (data, context) => {
      // `data.patch` is JSON; the reducer expects Partial<BoardScopedItem>.
      // Connector endpoints (`start`, `end`) come from the renderer as
      // parsed objects — they need to be re-stringified before insert so
      // the schema's string-encoded fields stay consistent across peers.
      await applyUpdate(context.view, '@tamarind/items', { id: data.id }, (existing) => ({
        ...existing,
        ...data.patch,
        updatedAt: data.at
      }))
    })
    this.router.add('@tamarind/reorder', async (data, context) => {
      await applyUpdate(context.view, '@tamarind/items', { id: data.id }, (existing) => ({
        ...existing,
        order: data.order,
        updatedAt: data.at
      }))
    })
    this.router.add('@tamarind/remove-item', async (data, context) => {
      // `data.id` arrives as a Buffer from the `board-delete`/`item-remove`
      // encoding (single buffer field). Pass `{id: buffer}` so the
      // collection's encodeKey extracts `record.id` — passing the buffer
      // bare routes through `buffer.id` which is undefined and throws
      // "Cannot read properties of undefined (reading 'buffer')" inside
      // the IndexEncoder preencode path.
      await context.view.delete('@tamarind/items', { id: data.id })
    })
    this.router.add('@tamarind/remove-items', async (data, context) => {
      // `data.ids` is json-encoded `string[]`. Items are keyed by Buffer,
      // so each id has to be hex-decoded back into a Buffer before it
      // can be matched against the index.
      for (const id of data.ids) {
        await context.view.delete('@tamarind/items', { id: hexId(id) })
      }
    })

    this.router.add('@tamarind/add-chat', async (data, context) => {
      await context.view.insert('@tamarind/chat', data)
    })
    this.router.add('@tamarind/remove-chats', async (data, context) => {
      // Batch chat deletion. `data.ids` is a JSON array of message ids.
      // An empty array means "clear all" — the worker walks the whole
      // collection and deletes every message. Anything that isn't a
      // string array is ignored (defensive — renderer validates but the
      // worker shouldn't crash on malformed frames).
      const ids = Array.isArray(data.ids) ? data.ids : null
      if (ids === null) return
      if (ids.length === 0) {
        const all = await context.view.find('@tamarind/chat', {}).toArray()
        for (const m of all) {
          await context.view.delete('@tamarind/chat', { id: m.id })
        }
        return
      }
      // Specific ids — delete each. Missing ids are no-ops, matching
      // the existing `remove-item`/`remove-items` semantics (peer may
      // have already deleted via their own frame).
      for (const id of ids) {
        if (typeof id !== 'string') continue
        await context.view.delete('@tamarind/chat', { id })
      }
    })

    // Phase 7: per-writer AI state. `data._writerKey` is the local
    // writer's public key encoded as a hex string (the underscore
    // prefix avoids the schema's `writerKey: buffer` field, which
    // would otherwise force us to ship a Buffer through the dispatch
    // payload). Convert back to a Buffer here for the HyperDB key
    // encoder — `view.get` / `view.insert` expect a Buffer for any
    // `buffer`-typed key field.
    //
    // Upsert by writerKey: if no row exists yet (first push from
    // this writer), insert. Otherwise apply the update. `applyUpdate`
    // alone is a no-op when the record is missing, so without the
    // insert branch the first push silently drops and the
    // `@tamarind/ai-state` collection stays empty on every peer.
    // (This is why the host's model never showed up in the guest's
    // "Pick a source" UI: the first `pushAiStateToRoomWorker` after
    // boot was a no-op, and only subsequent pushes hit the
    // already-existing row — but the row was never created, so
    // every push was a no-op.)
    this.router.add('@tamarind/update-ai-state', async (data, context) => {
      if (typeof data._writerKey !== 'string' || data._writerKey.length === 0) {
        // `_writerKey` is required by the protocol — the local worker
        // always stamps it in `appendAiState`. If it's missing here,
        // either the dispatch schema lost the field (silently dropped
        // by the encoder) or something upstream stripped it. Either
        // way, refusing to insert is better than inserting an empty
        // Buffer that no peer can match against. Logged loudly so
        // the regression is visible in the worker console.
        console.error(
          '[tamarind-room] update-ai-state: missing _writerKey in dispatch payload, refusing to insert'
        )
        return
      }
      const writerKey = b4a.from(data._writerKey, 'hex')
      const next = {
        writerKey,
        modelId: data.modelId ?? null,
        modelName: data.modelName ?? null,
        loadedAt: data.loadedAt ?? null,
        accepting: !!data.accepting
      }
      const existing = await context.view.get('@tamarind/ai-state', { writerKey })
      if (existing) {
        await applyUpdate(context.view, '@tamarind/ai-state', { writerKey }, () => next)
      } else {
        await context.view.insert('@tamarind/ai-state', next)
      }
    })

    // Phase 8: P2P completion relay. The route handlers run inside
    // the worker (not in main), so the actual `completion()` call
    // has to bounce through main via a `relay-run` frame. The
    // route's job is just to forward — `onRelayRequest` and
    // `onRelayResponse` are wired in the entry file.
    this.router.add('@tamarind/relay-request', async (data, context) => {
      if (typeof this.onRelayRequest === 'function') {
        this.onRelayRequest(data)
      }
    })
    this.router.add('@tamarind/relay-response', async (data, context) => {
      if (typeof this.onRelayResponse === 'function') {
        this.onRelayResponse(data)
      }
    })
    this.router.add('@tamarind/relay-cancel', async (data, context) => {
      if (typeof this.onRelayCancel === 'function') {
        this.onRelayCancel(data)
      }
    })
  }

  get view() {
    return this.base.view
  }

  // Idempotent — returns the existing invite if one is already
  // persisted, otherwise mints a fresh one.
  async getInvite() {
    const existing = await this.view.findOne('@tamarind/invites', {})
    if (existing) return z32.encode(existing.invite)
    const { id, invite, publicKey, expires } = BlindPairing.createInvite(this.base.key)
    await this.base.append(
      TamarindDispatch.encode('@tamarind/add-invite', { id, invite, publicKey, expires })
    )
    return z32.encode(invite)
  }

  async addWriter(key) {
    await this.base.append(
      TamarindDispatch.encode('@tamarind/add-writer', {
        key: b4a.isBuffer(key) ? key : b4a.from(key)
      })
    )
  }

  // `null` until the Autobase is ready (matches `base.writable` from
  // the caller).
  isWritable() {
    return Boolean(this.base && this.base.writable)
  }

  async getBoards() {
    return await this.view.find('@tamarind/boards', {}).toArray()
  }

  async getItems() {
    return await this.view.find('@tamarind/items', {}).toArray()
  }

  async getMessages({ reverse = true, limit = 100 } = {}) {
    return await this.view.find('@tamarind/chat', { reverse, limit }).toArray()
  }

  // Build the `CanvasState` snapshot the renderer dispatches into the
  // reducer's `snapshot` action. Buffers are turned into hex strings
  // (matching renderer.ts BoardScopedItem.id/boardId types); connector
  // endpoints are parsed back from the JSON-string shortcut.
  async buildSnapshot() {
    const [rawBoards, rawItems] = await Promise.all([this.getBoards(), this.getItems()])
    const boards = rawBoards
      .map((b) => ({
        id: b4a.toString(b.id, 'hex'),
        name: b.name,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        order: b.order
      }))
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order
        return a.createdAt - b.createdAt
      })
    const items = rawItems.map((it) => decodeItem(it))
    const activeBoardId = boards[0]?.id ?? null
    return { boards, items, activeBoardId, orderCounter: 0 }
  }

  async addMessage(text, info) {
    const id = Math.random().toString(16).slice(2)
    await this.base.append(TamarindDispatch.encode('@tamarind/add-chat', { id, text, info }))
  }

  // Phase 7: append the local writer's AI state. Stamps the
  // `writerKey` from `this.localBase.key` so the row is always
  // keyed by the writer that produced the dispatch.
  async appendAiState({ modelId, modelName, loadedAt, accepting }) {
    const writerKey = b4a.toString(this.localBase.key, 'hex')
    await this.base.append(
      TamarindDispatch.encode('@tamarind/update-ai-state', {
        _writerKey: writerKey,
        modelId: modelId ?? null,
        modelName: modelName ?? null,
        loadedAt: loadedAt ?? null,
        accepting: !!accepting
      })
    )
  }

  // Phase 7: read every `@tamarind/ai-state` row. Returned as
  // {writerKey, modelId, modelName, loadedAt, accepting}; the
  // `writerKey` is the hex writer pubkey. The entry file maps to
  // z32 for chat-attribution parity.
  async getAiStates() {
    const rows = await this.view.find('@tamarind/ai-state', {}).toArray()
    return rows.map((r) => ({
      writerKey: b4a.toString(r.writerKey, 'hex'),
      modelId: r.modelId ?? null,
      modelName: r.modelName ?? null,
      loadedAt: r.loadedAt ?? null,
      accepting: !!r.accepting
    }))
  }

  // Phase 8: append a relay request addressed to a specific writer.
  // The owner's worker route handler picks it up and writes a
  // `relay-run` frame to its main process.
  async appendRelayRequest({ requestId, fromKey, toKey, messages, modelId }) {
    await this.base.append(
      TamarindDispatch.encode('@tamarind/relay-request', {
        requestId,
        fromKey: b4a.from(fromKey, 'hex'),
        toKey: b4a.from(toKey, 'hex'),
        messages,
        modelId,
        createdAt: Date.now()
      })
    )
  }

  async appendRelayResponse({ requestId, fromKey, toKey, kind, text, error }) {
    await this.base.append(
      TamarindDispatch.encode('@tamarind/relay-response', {
        requestId,
        fromKey: b4a.from(fromKey, 'hex'),
        toKey: b4a.from(toKey, 'hex'),
        kind,
        text: text ?? null,
        error: error ?? null
      })
    )
  }

  async appendRelayCancel({ requestId, fromKey, toKey }) {
    await this.base.append(
      TamarindDispatch.encode('@tamarind/relay-cancel', {
        requestId,
        fromKey: b4a.from(fromKey, 'hex'),
        toKey: b4a.from(toKey, 'hex')
      })
    )
  }

  // Per-message + clear-all chat deletion. Empty `ids` means "clear
  // all". The router handler in `_setupRouter` does the actual work;
  // this helper exists so the worker entry can fire the same encoded
  // route that any other peer would emit.
  async appendRemoveChats(ids) {
    await this.base.append(TamarindDispatch.encode('@tamarind/remove-chats', { ids: ids.slice() }))
  }

  // Dispatch a single board action through the encoded route. Each
  // canvasReducer action maps 1:1 to one of these helpers.
  async appendBoard(action) {
    switch (action.type) {
      case 'add-board':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/add-board', encodeBoard(action.board))
        )
        return
      case 'rename-board':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/rename-board', {
            id: hexId(action.id),
            name: action.name,
            at: action.at
          })
        )
        return
      case 'delete-board':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/delete-board', { id: hexId(action.id) })
        )
        return
      default:
        // `reorder-boards`, `set-active` are UI-only / local — no wire append.
        return
    }
  }

  async appendItem(action) {
    switch (action.type) {
      case 'add-item':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/add-item', encodeItem(action.item))
        )
        return
      case 'add-items':
        // Per-item dispatch — the `@tamarind/add-items` route uses the
        // `item-batch` schema with `items: json` (hyperschema has no v1
        // arrays-of-named-records), and `JSON.stringify(buffer)` produces
        // `{type:"Buffer", data:[…]}` which parses back as a plain object —
        // not a Buffer. HyperDB then tries to `BUFFER.preencode` the id,
        // hits `id.byteLength === undefined`, sets `state.end` to NaN, and
        // `allocUnsafe(NaN)` throws "Array buffer allocation failed" inside
        // `IndexEncoder._encode`. Templates were the first path to hit this
        // because the toolbar's add-rect/add-ellipse/add-arrow all use the
        // singular `add-item` (proper buffers); paste/duplicate uses
        // `add-items` too and had the same latent bug, but the user hadn't
        // pasted a buffer-bearing item yet. Workaround: emit one
        // `add-item` per item so each rides the `@tamarind/item` schema
        // where id/boardId are real Buffers.
        for (const item of action.items) {
          await this.base.append(TamarindDispatch.encode('@tamarind/add-item', encodeItem(item)))
        }
        return
      case 'update-item':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/update-item', {
            id: hexId(action.id),
            patch: action.patch,
            at: action.at
          })
        )
        return
      case 'reorder':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/reorder', {
            id: hexId(action.id),
            order: action.order,
            at: action.at
          })
        )
        return
      case 'remove-item':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/remove-item', { id: hexId(action.id) })
        )
        return
      case 'remove-items':
        await this.base.append(
          TamarindDispatch.encode('@tamarind/remove-items', { ids: action.ids })
        )
        return
      default:
        return
    }
  }
}

// Strip dashes that show up when callers pass UUID strings
// (e.g. `crypto.randomUUID()` → `"0a377ce0-01da-490e-9a4d-555ad810ca4a"`).
// Node's `Buffer.from(str, 'hex')` silently truncates at the first non-hex
// char; Bare's runtime throws "Invalid input" on the same input. Either
// behaviour would silently mangle ids; normalising here keeps the worker
// robust to whichever id scheme the renderer chooses.
function hexId(s) {
  return b4a.from(String(s).replace(/-/g, ''), 'hex')
}

// HyperDB doesn't expose an `update(collection, query, mutator)` API —
// only `get`, `insert`, `delete`. Earlier code in this file called
// `view.update(...)` expecting an updater callback, but Bee.update()
// treats its first arg as a core refresh options object and silently
// does nothing. That made board renames, item edits, and item reorders
// appear to succeed locally while never round-tripping through the
// Autobase — every snapshot echoed back stale data and reverted the
// renderer's optimistic update.
//
// Apply the same effect via get → mutate → delete → insert. Connector
// endpoints (`start`, `end`) and connector labels (`label`) are stored
// as JSON strings on the wire because hyperschema lacks a v1 any-of;
// the renderer hands us the parsed object, so re-stringify before
// re-insert.
async function applyUpdate(view, collectionName, query, mutate) {
  const existing = await view.get(collectionName, query)
  if (!existing) return
  const next = mutate(existing)
  if (next === null || next === undefined) return
  for (const key of ['start', 'end', 'label']) {
    const v = next[key]
    if (v !== undefined && v !== null && typeof v !== 'string') {
      next[key] = JSON.stringify(v)
    }
  }
  await view.delete(collectionName, query)
  await view.insert(collectionName, next)
}

// Hex-encode the string ids into buffers for hyperschema records.
function encodeBoard(b) {
  return {
    id: hexId(b.id),
    name: b.name,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    order: b.order
  }
}

function encodeItem(it) {
  const encoded = {
    id: hexId(it.id),
    boardId: hexId(it.boardId),
    type: it.type,
    x: it.x,
    y: it.y,
    stroke: it.stroke,
    strokeWidth: it.strokeWidth,
    order: it.order,
    updatedAt: it.updatedAt
  }
  if (it.w !== undefined) encoded.w = it.w
  if (it.h !== undefined) encoded.h = it.h
  if (it.text !== undefined) encoded.text = it.text
  if (it.fill !== undefined) encoded.fill = it.fill
  if (it.lineCap !== undefined) encoded.lineCap = it.lineCap
  if (it.fontSize !== undefined) encoded.fontSize = it.fontSize
  // Connector endpoints: serialise the ConnectorEnd union as JSON.
  if (it.start !== undefined) encoded.start = JSON.stringify(it.start)
  if (it.end !== undefined) encoded.end = JSON.stringify(it.end)
  // Phase 3 connector styling — string fields are passed through as-is;
  // `label` is a structured object so it rides the same JSON workaround
  // as `start` / `end`.
  if (it.arrowStart !== undefined) encoded.arrowStart = it.arrowStart
  if (it.arrowEnd !== undefined) encoded.arrowEnd = it.arrowEnd
  if (it.strokePattern !== undefined) encoded.strokePattern = it.strokePattern
  if (it.curve !== undefined) encoded.curve = it.curve
  if (it.label !== undefined) encoded.label = JSON.stringify(it.label)
  return encoded
}

// Reverse the above for the renderer's snapshot path. Buffers → hex;
// JSON-string connector endpoints + labels → parsed objects.
function decodeItem(raw) {
  const item = {
    id: b4a.toString(raw.id, 'hex'),
    boardId: b4a.toString(raw.boardId, 'hex'),
    type: raw.type,
    x: raw.x,
    y: raw.y,
    stroke: raw.stroke,
    strokeWidth: raw.strokeWidth,
    order: raw.order,
    updatedAt: raw.updatedAt
  }
  if (raw.w !== undefined && raw.w !== null) item.w = raw.w
  if (raw.h !== undefined && raw.h !== null) item.h = raw.h
  if (raw.text !== undefined && raw.text !== null) item.text = raw.text
  if (raw.fill !== undefined && raw.fill !== null) item.fill = raw.fill
  if (raw.lineCap !== undefined && raw.lineCap !== null) item.lineCap = raw.lineCap
  if (raw.fontSize !== undefined && raw.fontSize !== null) item.fontSize = raw.fontSize
  if (raw.start !== undefined && raw.start !== null) {
    try {
      item.start = typeof raw.start === 'string' ? JSON.parse(raw.start) : raw.start
    } catch {
      item.start = undefined
    }
  }
  if (raw.end !== undefined && raw.end !== null) {
    try {
      item.end = typeof raw.end === 'string' ? JSON.parse(raw.end) : raw.end
    } catch {
      item.end = undefined
    }
  }
  if (raw.arrowStart !== undefined && raw.arrowStart !== null) item.arrowStart = raw.arrowStart
  if (raw.arrowEnd !== undefined && raw.arrowEnd !== null) item.arrowEnd = raw.arrowEnd
  if (raw.strokePattern !== undefined && raw.strokePattern !== null) {
    item.strokePattern = raw.strokePattern
  }
  if (raw.curve !== undefined && raw.curve !== null) item.curve = raw.curve
  if (raw.label !== undefined && raw.label !== null) {
    try {
      item.label = typeof raw.label === 'string' ? JSON.parse(raw.label) : raw.label
    } catch {
      item.label = undefined
    }
  }
  return item
}

module.exports = TamarindRoom
