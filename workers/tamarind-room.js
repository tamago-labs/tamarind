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
      await applyUpdate(
        context.view,
        '@tamarind/boards',
        { id: data.id },
        (b) => ({ ...b, name: data.name, updatedAt: data.at })
      )
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

  // Per-message + clear-all chat deletion. Empty `ids` means "clear
  // all". The router handler in `_setupRouter` does the actual work;
  // this helper exists so the worker entry can fire the same encoded
  // route that any other peer would emit.
  async appendRemoveChats(ids) {
    await this.base.append(
      TamarindDispatch.encode('@tamarind/remove-chats', { ids: ids.slice() })
    )
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
        await this.base.append(
          TamarindDispatch.encode('@tamarind/add-items', { items: action.items.map(encodeItem) })
        )
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
// endpoints (`start`, `end`) are stored as JSON strings on the wire
// because hyperschema lacks a v1 any-of; the renderer hands us the
// parsed object, so re-stringify before re-insert.
async function applyUpdate(view, collectionName, query, mutate) {
  const existing = await view.get(collectionName, query)
  if (!existing) return
  const next = mutate(existing)
  if (next === null || next === undefined) return
  for (const key of ['start', 'end']) {
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
  return encoded
}

// Reverse the above for the renderer's snapshot path. Buffers → hex;
// JSON-string connector endpoints → parsed objects.
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
  return item
}

module.exports = TamarindRoom
