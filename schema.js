// Tamarind hyperschema + hyperdb + hyperdispatch source-of-truth.
//
// Records, collections, and dispatch routes for the P2P room worker
// (`workers/tamarind-room.js`). Mirrors the canvasReducer's action
// surface so each reducer dispatch becomes a single Autobase append,
// and the full log replays into the reducer's `snapshot` action when
// a peer joins.
//
// v1 shortcut: connector endpoints (`start`, `end`) are encoded as
// opaque JSON strings to dodge a v1 hyperschema any-of restriction.
// A new peer reads them back via `JSON.parse` in the worker's
// snapshot path. See `nested-beaming-reef.md` step 11.

const Hyperschema = require('hyperschema')
const HyperdbBuilder = require('hyperdb/builder')
const Hyperdispatch = require('hyperdispatch')

const SCHEMA_DIR = './spec/schema'
const DB_DIR = './spec/db'
const DISPATCH_DIR = './spec/dispatch'

const hyperSchema = Hyperschema.from(SCHEMA_DIR)
const schema = hyperSchema.namespace('tamarind')

// ── Records ─────────────────────────────────────────────────────────
schema.register({
  name: 'writer',
  fields: [{ name: 'key', type: 'buffer', required: true }]
})

schema.register({
  name: 'invite',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'invite', type: 'buffer', required: true },
    { name: 'publicKey', type: 'buffer', required: true },
    { name: 'expires', type: 'int', required: true }
  ]
})

schema.register({
  name: 'board',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'createdAt', type: 'int', required: true },
    { name: 'updatedAt', type: 'int', required: true },
    { name: 'order', type: 'int', required: true }
  ]
})

// `start` / `end` are stored as JSON-encoded ConnectorEnd unions so
// we don't have to model the discriminated union in hyperschema for
// v1. See comment at top of file.
schema.register({
  name: 'item',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'boardId', type: 'buffer', required: true },
    { name: 'type', type: 'string', required: true },
    { name: 'x', type: 'float64', required: true },
    { name: 'y', type: 'float64', required: true },
    { name: 'w', type: 'float64' },
    { name: 'h', type: 'float64' },
    { name: 'text', type: 'string' },
    { name: 'stroke', type: 'string', required: true },
    { name: 'strokeWidth', type: 'float64', required: true },
    { name: 'fill', type: 'string' },
    { name: 'lineCap', type: 'string' },
    { name: 'fontSize', type: 'float64' },
    { name: 'start', type: 'string' },
    { name: 'end', type: 'string' },
    { name: 'order', type: 'int', required: true },
    { name: 'updatedAt', type: 'int', required: true }
  ]
})

schema.register({
  name: 'chat-msg',
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'text', type: 'string', required: true },
    { name: 'info', type: 'json' }
  ]
})

schema.register({
  name: 'board-rename',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'at', type: 'int', required: true }
  ]
})

schema.register({
  name: 'board-delete',
  fields: [{ name: 'id', type: 'buffer', required: true }]
})

// `add-items` is a batch — hyperschema doesn't do arrays-of-named-
// record for v1, so we serialise the batch as JSON.
schema.register({
  name: 'item-batch',
  fields: [{ name: 'items', type: 'json', required: true }]
})

schema.register({
  name: 'item-update',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'patch', type: 'json', required: true },
    { name: 'at', type: 'int', required: true }
  ]
})

schema.register({
  name: 'item-reorder',
  fields: [
    { name: 'id', type: 'buffer', required: true },
    { name: 'order', type: 'int', required: true },
    { name: 'at', type: 'int', required: true }
  ]
})

schema.register({
  name: 'item-remove',
  fields: [{ name: 'id', type: 'buffer', required: true }]
})

schema.register({
  name: 'items-remove',
  fields: [{ name: 'ids', type: 'json', required: true }]
})

Hyperschema.toDisk(hyperSchema)

// ── Collections ─────────────────────────────────────────────────────
const hyperdb = HyperdbBuilder.from(SCHEMA_DIR, DB_DIR)
const db = hyperdb.namespace('tamarind')

db.collections.register({
  name: 'boards',
  schema: '@tamarind/board',
  key: ['id']
})

db.collections.register({
  name: 'items',
  schema: '@tamarind/item',
  key: ['id']
})

db.collections.register({
  name: 'chat',
  schema: '@tamarind/chat-msg',
  key: ['id']
})

db.collections.register({
  name: 'invites',
  schema: '@tamarind/invite',
  key: ['id']
})

HyperdbBuilder.toDisk(hyperdb)

// ── Dispatch routes ────────────────────────────────────────────────
// One route per canvasReducer action, plus chat + invite plumbing.
const hyperdispatch = Hyperdispatch.from(SCHEMA_DIR, DISPATCH_DIR, { offset: 0 })
const dispatch = hyperdispatch.namespace('tamarind')

dispatch.register({ name: 'add-writer', requestType: '@tamarind/writer' })
dispatch.register({ name: 'add-invite', requestType: '@tamarind/invite' })

dispatch.register({ name: 'add-board', requestType: '@tamarind/board' })
dispatch.register({ name: 'rename-board', requestType: '@tamarind/board-rename' })
dispatch.register({ name: 'delete-board', requestType: '@tamarind/board-delete' })

dispatch.register({ name: 'add-item', requestType: '@tamarind/item' })
dispatch.register({ name: 'add-items', requestType: '@tamarind/item-batch' })
dispatch.register({ name: 'update-item', requestType: '@tamarind/item-update' })
dispatch.register({ name: 'reorder', requestType: '@tamarind/item-reorder' })
dispatch.register({ name: 'remove-item', requestType: '@tamarind/item-remove' })
dispatch.register({ name: 'remove-items', requestType: '@tamarind/items-remove' })

dispatch.register({ name: 'add-chat', requestType: '@tamarind/chat-msg' })

Hyperdispatch.toDisk(hyperdispatch)
