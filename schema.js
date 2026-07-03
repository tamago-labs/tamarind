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
    // Connector-only styling (Phase 3 — unified `connector` shape).
    // `arrowStart`/`arrowEnd` mirror `ArrowheadStyle` ('none' | 'arrow').
    // `strokePattern` mirrors `StrokePattern` ('solid' | 'dashed' | 'dotted').
    // `curve` mirrors `Curve` ('straight' | 'bezier').
    // `label` is a JSON-encoded `ConnectorLabel` (v1 hyperschema workaround,
    // mirrors how `start`/`end` ship as opaque JSON strings).
    { name: 'arrowStart', type: 'string' },
    { name: 'arrowEnd', type: 'string' },
    { name: 'strokePattern', type: 'string' },
    { name: 'curve', type: 'string' },
    { name: 'label', type: 'string' },
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

// Batch chat deletion — `ids` is a `string[]` of message ids to remove.
// An empty array means "clear all chat history". Mirrors the
// `items-remove` batch pattern; hyperschema doesn't do arrays-of-named-
// record for v1, so we serialise the batch as JSON.
schema.register({
  name: 'chats-remove',
  fields: [{ name: 'ids', type: 'json', required: true }]
})

// Phase 2: per-writer AI state (which model each peer has loaded and
// whether it's currently accepting requests). One row per writer,
// keyed by `writerKey`. `accepting` flips to false during an in-flight
// completion so peers can see when a model is busy. `modelId` and
// `modelName` are null when no model is loaded.
schema.register({
  name: 'ai-state',
  fields: [
    { name: 'writerKey', type: 'buffer', required: true },
    { name: 'modelId', type: 'string', required: false },
    { name: 'modelName', type: 'string', required: false },
    { name: 'loadedAt', type: 'int', required: false },
    { name: 'accepting', type: 'bool', required: true }
  ]
})

// Dispatch payload for the writer's own AI state update. Mirrors
// the fields on `ai-state` plus a `_writerKey: string` (underscore
// prefix to keep it out of the collection's key namespace) that
// carries the writer's public key as a hex string. The local worker
// stamps `_writerKey` on the outbound dispatch and the route handler
// decodes it back to a Buffer for the HyperDB key encoder. We use
// `string` here (not `buffer`) because the dispatch payload is
// JSON-serialised on the pipe; a hex string survives the round-trip
// whereas a raw Buffer would need base64 wrapping.
//
// WHY THIS FIELD IS HERE: The encoder silently drops fields that
// aren't in the schema. Without this entry, `data._writerKey`
// arrived as `undefined` in the route handler,
// `b4a.from(undefined, 'hex')` returned an empty Buffer, and every
// peer's `peerAiStates` had `writerKey: ""` — making the renderer-
// side "Pick a source" UI unselectable and the relay route fail
// with "targetWriterKey required".
//
// SCHEMA CHANGES: We're greenfield — no production data to preserve.
// When you change ANY dispatch or collection schema (add/remove/
// rename/reorder fields), wipe the local storage dirs before
// restarting:
//   npm run clean:storage
// Compact-encoding is positional, so any schema change breaks the
// decoder for old on-disk bytes. Don't ship a schema change
// without also telling the user to wipe.
schema.register({
  name: 'ai-state-update',
  fields: [
    { name: '_writerKey', type: 'string', required: false },
    { name: 'modelId', type: 'string', required: false },
    { name: 'modelName', type: 'string', required: false },
    { name: 'loadedAt', type: 'int', required: false },
    { name: 'accepting', type: 'bool', required: true }
  ]
})

// Phase 3: P2P completion routing. A requester encodes a chat-completion
// payload and pins it at the owner's writer key. The owner runs the
// local inference and streams the result back as a sequence of
// `relay-response` records with the same `requestId`. We do NOT
// include `messages` in the `relay-response` because the requester
// already has them — only deltas/error/done are echoed back.
schema.register({
  name: 'relay-request',
  fields: [
    { name: 'requestId', type: 'string', required: true },
    { name: 'fromKey', type: 'buffer', required: true },
    { name: 'toKey', type: 'buffer', required: true },
    { name: 'messages', type: 'json', required: true },
    { name: 'modelId', type: 'string', required: true },
    { name: 'createdAt', type: 'int', required: true }
  ]
})

schema.register({
  name: 'relay-response',
  fields: [
    { name: 'requestId', type: 'string', required: true },
    { name: 'fromKey', type: 'buffer', required: true },
    { name: 'toKey', type: 'buffer', required: true },
    { name: 'kind', type: 'string', required: true },
    { name: 'text', type: 'string', required: false },
    { name: 'error', type: 'json', required: false }
  ]
})

schema.register({
  name: 'relay-cancel',
  fields: [
    { name: 'requestId', type: 'string', required: true },
    { name: 'fromKey', type: 'buffer', required: true },
    { name: 'toKey', type: 'buffer', required: true }
  ]
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

// Per-writer AI state. One row per writer key; the worker upserts
// this whenever the local writer's AI state changes.
db.collections.register({
  name: 'ai-state',
  schema: '@tamarind/ai-state',
  key: ['writerKey']
})

// P2P completion relay. We index both `relay-request` and
// `relay-response` by `requestId` so the worker can scan a specific
// in-flight request efficiently. The `relay-cancel` row is consumed
// once and removed by the owner.
db.collections.register({
  name: 'relay-request',
  schema: '@tamarind/relay-request',
  key: ['requestId']
})

db.collections.register({
  name: 'relay-response',
  schema: '@tamarind/relay-response',
  key: ['requestId', 'fromKey']
})

db.collections.register({
  name: 'relay-cancel',
  schema: '@tamarind/relay-cancel',
  key: ['requestId']
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
dispatch.register({ name: 'remove-chats', requestType: '@tamarind/chats-remove' })

// Phase 2 + 3 routes. The worker reads the local AI state via
// `getLocalAiStateSnapshot()` and stamps the writer key + fields
// when the request lands.
dispatch.register({ name: 'update-ai-state', requestType: '@tamarind/ai-state-update' })
dispatch.register({ name: 'relay-request', requestType: '@tamarind/relay-request' })
dispatch.register({ name: 'relay-response', requestType: '@tamarind/relay-response' })
dispatch.register({ name: 'relay-cancel', requestType: '@tamarind/relay-cancel' })

Hyperdispatch.toDisk(hyperdispatch)
