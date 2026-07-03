# Tamarind

> Tactical whiteboard for teams that need to win. Works offline, syncs P2P, AI-assisted. Built on Electron + `pear-runtime`.

Internet at stadiums, conference venues, and hackathon halls is terrible. **Tamarind** is the tactical whiteboard that works anyway — sports teams, sales teams, and hackathon crews plan strategy offline, sync P2P with the rest of the team, and get AI-powered suggestions to sharpen their approach, all without the cloud. Built on [Electron][electron] with [pear-runtime][pear-runtime] for P2P distribution and updates.

- **Offline-first tactical canvas** — pick a template that fits the moment: football pitch, sales pipeline, system overview, or blank
- **P2P team sync** — Hyperswarm discovery + Autobase multi-writer; everyone on the same network views and edits the same board, syncing directly between devices when they reconnect
- **Group chat + invite codes** — empty properties drawer doubles as a chat panel; the host's invite code lives there with a one-click copy button, so anyone on the network can join as a guest
- **Local AI coach** — QVAC + Qwen bring local model selection to the footer (Phase 5). Pick a model, watch it download + load, see the pill flip to "Loaded — QWEN 1.7B", then open the AI Chat tab for streaming completions. P2P relay lets guest peers chat through the host's loaded model without loading their own.
- **Tactical whiteboard persistence** — backup/restore plus SVG/PNG export (Phase 4 / 4.5). Every change appended to a Hypercore, giving the team a tamper-evident audit trail for post-game / post-deal / post-hack review
- **P2P Over-the-Air updates** with update-restart, embedded [bare][bare] runtime workers, multisig production releases

This project is a fork of the [Holepunch `hello-pear-electron` template](https://github.com/holepunchto/hello-pear-electron).

## The Problem

Stadium WiFi collapses under 50,000 devices. Conference WiFi requires a password the speaker doesn't have. Hackathon venues throttle the moment demos start. **The teams that need to plan together the most are the ones stuck with the worst network.** Tamarind is built for the moment the network is gone.

## What's Built Now

### Tactical canvas

- Four shape types: rectangle, ellipse, connector, and free-floating text. Text is a first-class shape (not just an overlay on rect/ellipse) with a double-click-to-edit on-canvas editor. Connectors unified in Phase 3 — both endpoints expose five ports each, drag-to-create draws a bezier preview, and the property panel exposes start/end arrows, stroke style (solid/dashed/dotted), curve (straight/bezier), and an inline label chip
- Drag, resize, and connector attachment (connectors stick to shape ports and follow them on drag). Connector endpoints cascade-orphan when their host is deleted
- Multi-select via marquee, per-shape properties panel (fill, stroke, stroke width, font size, text, z-order, connector style)
- Transient-update fast path for 60Hz drag previews + non-transient commit on pointerup so the network only sees the final shape position
- Cascade-orphan semantics for connector deletion replicated identically across peers via the deterministic reducer
- SVG / PNG export with selection-aware area (selected items → bbox union, else visible viewport). PNG rasterizes at 2× via `<foreignObject>` + canvas; SVG export is browser-preview accurate

### Multi-board

- One Tamarind instance hosts many boards (one per tactic, deal, or idea). Switching boards is local UI state; all boards share the same Autobase + invite
- Toolbar dropdown for switch / add / rename / delete. The "last board" cannot be deleted — guarded at the UI, reducer, and worker layers

### P2P team sync (Phase 2)

- **Host mode** (default): a fresh Tamarind launch mints a BlindPairing invite, displays it in the empty properties drawer with a copy button, and accepts inbound joiners
- **Guest mode**: paste the host's invite into the splash's "Join existing board" toggle. Connection establishes over Hyperswarm UDP; guests see the full board state + chat history
- **Two Bare workers** per app: `workers/main.js` (Pear OTA updater) + `workers/tamarind-room-entry.js` (data plane)
- **Encrypted Autobase** + HyperDB view with four collections (`boards`, `items`, `chat`, `invites`) keyed by `id`
- **Per-action CRDT** dispatch — each reducer action becomes one Autobase append. New peers replay the log on join and converge to identical state
- **Snapshot push** debounced 100ms after every Autobase update
- **Transient updates stay local** — only the non-transient commit goes over the wire

### Group chat

- Empty properties drawer doubles as a chat panel. Host sees the invite code in the header; both host and guest see chat history with "You" labels for the local writer
- Per-message delete + clear-all (mirrors the boards/items deletion semantics)
- Stable attribution by writer pubkey (z32-encoded); two peers with the same display name stay visually distinguishable

### Identity

- Each Tamarind instance generates a writer keypair (via `hypercore-crypto.keyPair()`) on first launch and persists it to `identity.json`
- Display name editable from the splash's "Your name" modal; stored alongside the key
- Chat attribution uses the stable writer pubkey for "You" detection, and the mutable display name for the visible label

### Templates

Four static templates ship in `renderer/src/data/templates.ts`:

| Template              | Layout                                                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Football pitch        | 11 labeled player ellipses (GK, LB, CB×2, RB, DM, CM×2, AM, LW, RW) + green pitch + center line/circle + 2 connectors (one with a "pass" label) for a pass-and-run pattern |
| Basketball half-court | 5 player ellipses (PG, SG, SF, PF, C) + court outline + key + 3pt arc + hoop line                                                                                          |
| Sales pipeline        | 4 stages (Lead, Qualified, Proposal, Closed) with 3 connecting connectors, final arrow labeled "won" in the middle                                                         |
| Hackathon system      | Frontend / API / Worker / DB boxes with 4 data-flow connectors                                                                                                             |

Hand-rolled inline SVG thumbnails in `renderer/src/data/templatesThumbnails.tsx` (no headless SVG renderer needed). Insertion bulk-adds via the existing `add-items` reducer action (which `useRoom.sendAction` passes through, fan-out of N `add-item` dispatches to avoid the JSON-Buffer mangler — see HyperDB gotchas below).

### Local AI model selection (Phase 5 — load & infer)

The footer-left pill surfaces AI status and opens the picker on click:

- **Built-in models**: QWEN 1.7B (`registry://qwen3-1.7b-instruct-q4`, ~1.28 GB, low-spec default) + QWEN 4B (`registry://qwen3-4b-instruct-q4-k-m`, ~2.50 GB, higher quality). Builtins are non-removable.
- **Custom models**: add a `https://` URL or browse for a local `.gguf` file via the native Electron picker. The registry auto-scans `<userData>` on first launch and registers any existing `*.gguf` files automatically.
- **Model configuration** section exposes a context size dropdown (`2048 / 4096 (default) / 8192` tokens) plus a Tools on/off toggle, both persisted in `<userData>/models.json` under the `aiConfig` key so the pick survives reloads. Config is read by `@qvac/sdk`'s `loadModel({ modelConfig })` on every load.
- **Lazy opt-in**: nothing loads on startup. The user clicks the pill → picks → watches progress (download for URLs, load for registry) → pill flips green. Click again to unload.
- **Once loaded**, open the AI Chat tab from the right drawer (toolbar icon), pick a source in the Workspace tab (Local or Host), and start streaming completions.
- **IPC surface**: `models:{list,add,remove,status,pickFile,select,cancel,resetCache}` + `ai:{getStatus,unload}` + `ai-config:{get,set}` + `ai-chat:{send,cancel,stream-status}` + `sessions:{list,switch,edit,delete,clear}` + push channels `models:progress` / `models:error` / `ai-chat:{token,thinking,done,error}`. QVAC SDK lives in the Electron main process (`electron/qvac.js`) — not a third Bare worker — because the SDK is Node-tested and a worker-spawn would force a second `schema.js` pass.

## The Vision — Phantom Coach

Our long-term vision: a "Phantom Coach" that watches a match video and auto-populates the board with player movements, then delivers real-time voice feedback. Elite-level tactical analysis, accessible from a local youth club to a World Cup squad.

- A computer-vision engine consumes match video and projects player positions onto the canvas in real time
- A local LLM (Ollama) becomes a voice-driven assistant: _"shift the right-back two meters up, they're overloading your left"_
- All inference stays on-device — no footage, no telemetry, no cloud round-trips

## Roadmap

### Shipped — v1.0.0

- Electron + Pear runtime shell with P2P-ready build pipeline
- Tamarind-branded React 19 + TypeScript renderer (Vite + Tailwind v4 + framer-motion + lucide-react)
- Splash screen, name modal, canvas page

### Shipped — Sprint 1 (tactical canvas)

- Rect / ellipse / connector / text shapes with drag, resize, multi-select, connector handles
- Properties drawer with shape-specific editors
- Templates picker (4 layouts) and base modal with theme variants
- Local persistence via reducer history

### Shipped — Sprint 2 (team P2P)

- Autobase-backed canvas state (boards, items, chat) — multi-writer, encrypted
- Hyperswarm pairing via BlindPairing invite codes
- Group chat panel with stable writer-key attribution
- Multi-board model with rename + delete (with last-board guard at three layers)

### Shipped — Sprint 2.5 (polish)

- Text as a first-class shape with on-canvas double-click editing
- Splash copy fix ("Preparing Tamarind workspace…")
- Name modal copy fix ("Your display name for this team")
- Templates feature end-to-end

### Shipped — Sprint 3 (connector overhaul)

- Unified `connector` type — line and arrow collapse into one shape with `arrowStart` / `arrowEnd` / `strokePattern` / `curve` / `label` fields. No legacy `line`/`arrow` items to migrate
- Figma-style draw flow — toolbar Connector button arms a draw mode with hover ports on the shape under cursor, drag-to-create, dashed preview + ghost cursor dot + snap rings, sub-8-world-unit accidental clicks dropped
- Five-port model (top/right/bottom/left/center) per shape, snapped at draw time and on drag
- ConnectorSection in the property panel — start/end arrows, stroke style (solid/dashed/dotted), curve (straight/bezier), cap (round/butt/square), inline label chip with start/middle/end anchor
- Schema bump additive only — five new optional string fields on `@tamarind/item`, no migrations

### Shipped — Sprint 4 (data round-trip)

- **Backup** — active board serialized to a `Tamarind board file v1` JSON document (`.tamarind.json` extension). Toolbar button triggers a Blob + anchor download
- **Restore** — file picker parses the backup, dispatches a single `add-items` for the recovered shapes with fresh ids into the active board. Additive: drops the items into the current board without renaming it. Transient status banner (auto-dismiss 4s) surfaces success/error
- **Visual export (SVG)** — pure module at `renderer/src/canvas/svgExport.ts`. Selection-aware area: bbox union if items selected, else visible viewport. Self-contained SVG with embedded arrowhead marker + per-shape renderers + text via `<foreignObject>` so the export mirrors the canvas
- **Visual export (PNG)** — async rasterization via `<canvas>` (Blob → `URL.createObjectURL` → `Image` → `canvas.drawImage` → `canvas.toBlob`). 2× scale for retina. **CSP gotcha**: Tamarind's renderer runs with `img-src 'self' data:` (no `blob:`); the fix is `FileReader.readAsDataURL(svgBlob)` before assigning to `image.src` — data URLs are explicitly allowed. Same trap will hit anyone trying to load a Blob into an `<img>` / `<video>` / `<audio>` under this CSP.

### Shipped — Sprint 5 (local AI model selection)

- **Footer-left AI pill** — surfaces AI status (`not loaded` / `loading… X%` / `Loaded — QWEN X.Y` / `error`) and opens the picker modal on click. Sits left of the existing Worker status pill on the right side of the footer
- **AIModal** composed from `BaseModal` (variant=`'canvas'`). Four regions: model configuration (context size dropdown + tools toggle), error banner, built-in + custom model lists, add-custom-model form (URL or .gguf file picker)
- **QVAC SDK in Electron main process** — two new CommonJS modules (`electron/qvac.js`, `electron/modelStore.js`) modeled after TamaFlow's reference. SDK worker is SDK-managed, no third Bare worker spawned
- **Persisted model registry** — `<userData>/models.json` holds `{ version, models, lastSelectedModelId, aiConfig }`. Pre-seeds the two QWEN builtins on first launch; auto-imports any `*.gguf` already in `userData`; honors `builtin: true` to prevent built-in removal
- **Per-load model configuration** — `ctx_size ∈ {2048, 4096 (default), 8192}` + `tools: boolean` persisted across reloads in `aiConfig`, mirrored into QVAC on every change so the next load picks up the freshest values without re-fetching
- **IPC surface** — `models:{list,add,remove,status,pickFile,select,cancel,resetCache}`, `ai:{getStatus,unload}`, `ai-config:{get,set}`, plus push channels `models:progress` (downloading + loading phases) / `models:error` (`{ code, message, retryable }`)
- **Lazy load only** — no auto-load on startup (user picks a source in the Setup tab)

### Shipped — Sprint 6 (AI inference surface + P2P relay)

- **AI Chat tab (`AIChatTab.tsx`)** — streaming markdown chat against the loaded model. Collapsible `<thinking>` blocks, session management (auto-save, switch, delete, clear), empty state with "Pick a source" CTA. The main session (`chat-<timestamp>`) is auto-created and cannot be deleted, only cleared
- **Source picker (`SetupTab.tsx`)** — explicit two-option radio: Local (your own loaded model) or Host (a peer who has a model loaded). No auto-fallback, no auto-derivation. If the peer disconnects, the source clears and the user must pick again. The Host option is disabled when no peer has a model loaded
- **RightDrawer** — 3-tab container (Workspace, Team chat, AI chat). The Workspace tab hosts the source picker; switching between tabs preserves state
- **Local inference (`electron/aiChat.js`)** — single-flight SDK streaming wrapper around `@qvac/sdk/completion()`. No tools, no system prompt. Forwards events (token, thinking delta, done, error) to the renderer via IPC
- **Session store (`electron/sessions.js`)** — file-based persistence (`<userData>/ai-sessions.json`). Sessions have programmatic slugs (`chat-<timestamp>`). The main session is pinned and non-deletable. Auto-saves on every assistant response
- **useAIChat hook** — module-scope singleton that owns the streaming state, session CRUD, and send path dispatch. Handles both local and relay sends. Validates peer source is still present before each send (clears + shows error if peer is gone). 60s watchdog timeout on relay requests
- **P2P AI relay** — guest peers chat through the host's model without loading their own. Relay path: guest sends `relay-request` → host's `onRelayRequest` matches → host runs `completion()` → streams `relay-response` (token/thinking/done/error) back → guest accumulates into the assistant bubble. Keyed by hex writer keys, with z32→hex conversion at the main-bridge boundary. All relay routes use insert-or-update logic in the worker (first-insert via `view.insert` directly, not `applyUpdate` which returns early when existing is null)
- **Peer AI state sync** — `ai-state` schema + `update-ai-state` route piggyback on the Autobase. The renderer polled every 5s via `startPeerAiPolling()`, plus push on every Autobase update. `getLocalAiStateSnapshot()` in qvac.js returns the current model state (modelId, modelName, loadedAt, accepting flag). Pushed to the room on model load, unload, and app start
- **Schema additions** — `ai-state`, `ai-state-update`, `relay-request`, `relay-response`, `relay-cancel` in `schema.js`. All with `_writerKey` field (required: false due to hyperschema evolution rules). Regenerate with `npm run build:worker-specs`; storage wipe required after schema changes

### Roadmap — Sprint 7+ (Phantom Coach MVP)

- **Rule-based weakness/risk analyzer** (MVP) — geometry-only heuristics that flag overloaded zones, weak passing lanes, and defensive gaps. Output as inline annotations on the canvas
- **Tactical suggestions** — propose formation shifts, mark hints, connector plays based on the analyzed board. Driven by the loaded model with the analyzer's findings in the system prompt
- **Live cursors + selection presence** — every peer sees the others' cursor + selection overlay in real time
- **Snap-to-grid + snap-to-edges** — both shape edges and shape-to-shape alignment
- **Rotation handles** for non-rect shapes
- **Color swatch palette** — replace native `<input type="color">` with the Tamarind palette
- **Per-shape font family** — text shapes inherit `var(--font-display)` for v1
- **Group / ungroup selection**
- **Lock / hide per item**
- **Right-click context menu** — delete, duplicate, bring-to-front, send-to-back
- **Click-to-place spawn** — replace the fixed `(100,100) + 40·n` offset
- **Vitest unit suite** for `canvasReducer` + `withHistory` (currently covered by smoke tests only)
- **Schema v2 with proper `ConnectorEnd` discriminated union** — replace the v1 JSON-string shortcut
- **Multi-room hosting** — each board as its own Autobase (with its own invite code)
- **Keet-style portable writer-key** — let users bring their identity across machines
- **Per-writer AI preferences sync via Autobase** — share the loaded model + `aiConfig` with peers
- **`/c/tmp/smoke.cjs`** — the legacy single-window smoke is broken (expects a worker that never boots in plain-browser mode). Fix by adding `npm run smoke:unit` that spawns electron with `--headless` or a `?bypass-splash=1` query param
- **Move text-edit flake fix** — the `room-smoke.cjs` text-edit "box 2 never reaches host snapshot" assertion has a latent race; needs `key={id}`-aware focus-blur coordination or a pre-commit on Add-rect

## OS Support

- macOS
- Linux
- Windows

## Requirements

- `npm` via [Node.js][nodejs]
- [`pear`][pear-docs] — `npx pear`

## Quick Start

### Install

```sh
npm install
```

### Run (host — default)

```sh
npm start
```

Vite serves the renderer on `:5173`; Electron loads from there with `--no-updates` (avoids the local build being swapped by an OTA update mid-development).

### Run a second window (guest)

```sh
npm run start:guest
```

This runs Vite on `:5174` and Electron with a separate `--storage ./tmp-tamarind-guest` so the two windows don't share a Corestore. Vite's `strictPort: true` means the second instance fails fast if 5174 is also taken.

Once both are running:

1. The host splash mints an invite code in the empty properties drawer
2. Click the copy button on the invite
3. The guest splash has a "Join existing board" toggle at the bottom — paste the invite, click Join
4. Both windows see the same boards + items + chat
5. The footer-left "AI: not loaded" pill on either window is independently clickable — pick a Qwen model there to load it on this device only
6. Once the model is loaded, open the right drawer (tab icon in the toolbar) and switch to the **AI Chat** tab. Pick a source in the **Workspace** tab (Local for your own model, Host for the peer's model), then start chatting
7. Guest sees the host's loaded model in the Host radio option — no need to download or load a model on the guest device

### Build distributables

```sh
npm run package    # local Electron package
npm run make       # platform installers (dmg/msix/appimage/snap/flatpak)
```

`pear` builds (`pear build` / `pear stage` / `pear provision` / `pear multisig`) follow the same workflow as the upstream `hello-pear-electron` template — see the pear docs at [docs.pears.com](https://docs.pears.com).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Electron renderer (React 19)                                            │
│  ┌────────────────┐  ┌──────────────────────────┐  ┌──────────────────┐ │
│  │ SplashPage     │→ │ CanvasPage               │→ │ PropertiesDrawer │ │
│  │ name modal     │  │ useReducer(withHistory)  │  │ empty →          │ │
│  │ invite CTA     │  │ + useRoom snapshot       │  │  <GroupChatPanel/>│
│  │ join toggle    │  │ selectedIds (ephemeral)  │  │ selected →       │ │
│  └────────────────┘  └──────────────────────────┘  │  <ShapeEditor/>  │ │
│         ▲                       ▲                    └──────────────────┘ │
│         │ {role, status}        │ {snapshot, chat, peers, invite, me}     │
│         │ {invite}              │                                           │
│         └───────── bridge.onWorkerIPC(ROOM_WORKER, cb) ──────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                ▲                                  ▲
                │ writeRoom(frame)                 │ framed Uint8Array
                │ (state-action, send-chat,        │
                │  create-invite, join-invite,     │
                │  rename-self)                    │
                ▼                                  │
┌──────────────────────────────────────────────────────────────────────────┐
│  Bare worker: /workers/tamarind-room.js                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ TamarindRoomWorker (extends ReadyResource)                          │ │
│  │  ├─ Corestore(storage/corestore)                                    │ │
│  │  ├─ Hyperswarm  (replicates store on every conn)                    │ │
│  │  ├─ TamarindRoom (extends ReadyResource)                           │ │
│  │  │   ├─ Autobase (encrypted, multi-writer)                          │ │
│  │  │   ├─ HyperDB view                                                │ │
│  │  │   │   ├─ @tamarind/boards    (1 record per board)                │ │
│  │  │   │   ├─ @tamarind/items     (1 record per shape)               │ │
│  │  │   │   ├─ @tamarind/chat      (1 record per message)             │ │
│  │  │   │   └─ @tamarind/invites   (z32 invite codes)                 │ │
│  │  │   └─ BlindPairing (addMember on host, addCandidate on join)      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                  ▲                                     ▲
                  │ Hyperswarm (UDP, DHT)                │
                  │ Autobase linearizer + replica pull   │
                  └─────────────────────────────────────┘
                                   │
                          (peer device, optional)
```

### Wire protocol (renderer ↔ TamarindRoom worker)

JSON frames over FramedStream. `at` is ISO-string ms (`Date.now()`). All IDs are strings unless noted.

**Renderer → Worker (writes)**

| Frame                             | Purpose                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `{type:'join-invite', invite}`    | Peer: try to join via z32 invite                                                                            |
| `{type:'create-invite'}`          | Host: mint a fresh invite for this room                                                                     |
| `{type:'state-action', action}`   | Dispatch a `canvasReducer` action (sans `undo`/`redo`/`snapshot`); the worker rebroadcasts through Autobase |
| `{type:'send-chat', text, info?}` | Append a chat message                                                                                       |
| `{type:'rename-self', name}`      | Persist a new display name to `identity.json`                                                               |
| `{type:'update-ai-state', ...}`   | Push the local peer's AI state (modelId, modelName, loadedAt, accepting) to the Autobase                    |

**Worker → Renderer (pushes)**

| Frame                           | When                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `{type:'status', phase}`        | Splash → canvas transition                                  |
| `{type:'role', role, writable}` | Once after join/host completes                              |
| `{type:'invite', invite}`       | After `create-invite` or once at boot                       |
| `{type:'snapshot', state}`      | After every Autobase update (debounced 100ms)               |
| `{type:'chat', messages}`       | After every Autobase update touching `@tamarind/chat`       |
| `{type:'peers', count}`         | After every `swarm.on('connection')` change                 |
| `{type:'me', key, name}`        | Once on `_open()` after `identity.json` is loaded/generated |
| `{type:'ai-states', states}`    | On every Autobase update touching `@tamarind/ai-state`      |

### AI / Models IPC bridge (renderer ↔ Electron main)

The AI surface lives in the Electron main process (`electron/qvac.js` + `electron/modelStore.js` + `electron/aiChat.js` + `electron/sessions.js`) and is exposed to the renderer via the preload bridge (`bridge.models.*` + `bridge.ai.*` + `bridge.aiChat.*` + `bridge.sessions.*`). The QVAC SDK is Node-tested so a third Bare worker would add a `schema.js` pass + a CSP-visible IPC bridge for no benefit.

**Renderer → Main (invocations)**

| Channel                 | Args                                                     | Returns                                                                                         |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `models:list`           | —                                                        | `ModelEntry[]` (builtin + custom)                                                               |
| `models:add`            | `{ name, source, description?, quantization?, params? }` | `ModelEntry`                                                                                    |
| `models:remove`         | `id`                                                     | `boolean` (false for builtins)                                                                  |
| `models:pickFile`       | —                                                        | `string \| null` (Electron `dialog.showOpenDialog` filtered to `*.gguf`)                        |
| `models:status`         | —                                                        | `{ active, lastSelectedId, available }`                                                         |
| `models:select`         | `id`                                                     | `{ success, error? }` (cancels in-flight + unloads prev + pushes active config + `ensureModel`) |
| `models:cancel`         | `{ clearCache? }?`                                       | `{ success }`                                                                                   |
| `models:resetCache`     | `id`                                                     | `{ success, deleted[], error? }` (URL entries only)                                             |
| `ai:unload`             | —                                                        | `{ success, error? }`                                                                           |
| `ai:getStatus`          | —                                                        | `{ isReady, modelName, uptime, downloading, downloadProgress }`                                 |
| `ai-config:get`         | —                                                        | `{ ctx_size, tools }`                                                                           |
| `ai-config:set`         | `{ ctx_size: 2048\|4096\|8192, tools: boolean }`         | `{ success }`                                                                                   |
| `ai-chat:send`          | `{ text, conversationId? }`                              | `{ requestId }`                                                                                 |
| `ai-chat:cancel`        | —                                                        | `{ success }`                                                                                   |
| `ai-chat:stream-status` | —                                                        | `{ isStreaming, requestId? }`                                                                   |
| `sessions:list`         | —                                                        | `SessionMeta[]`                                                                                 |
| `sessions:switch`       | `{ slug }`                                               | `SessionMeta`                                                                                   |
| `sessions:edit`         | `{ slug, name }`                                         | `SessionMeta`                                                                                   |
| `sessions:delete`       | `{ slug }`                                               | `{ success }`                                                                                   |
| `sessions:clear`        | `{ slug }`                                               | `{ success }`                                                                                   |

**Main → Renderer (pushes)**

| Channel            | Payload                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models:progress`  | `{ phase: 'downloading' \| 'loading', downloaded, total, percentage, requestId? }`                                                                                                                        |
| `models:error`     | `{ code, message, retryable }` (codes: `FILE_NOT_FOUND`, `LOAD_FAILED`, `DOWNLOAD_FAILED`, `HTTP_ERROR`, `WORKER_DIED`, `CONTEXT_OVERFLOW`, `CHECKSUM_FAILED`, `PARTIAL_OFFLINE`, `CANCELLED`, `UNKNOWN`) |
| `ai-chat:token`    | `{ requestId, text }`                                                                                                                                                                                     |
| `ai-chat:thinking` | `{ requestId, text }`                                                                                                                                                                                     |
| `ai-chat:done`     | `{ requestId, stopReason? }`                                                                                                                                                                              |
| `ai-chat:error`    | `{ requestId, error: { code, message, retryable } }`                                                                                                                                                      |

**Persistence layout** — `<userData>/models.json` holds `{ version, models, lastSelectedModelId, aiConfig }`. `<userData>/ai-sessions.json` holds the AI chat session store (programmatic slugs, `main` pinned). The auto-import runs once on first launch and walks `<userData>` for `*.gguf` files so users don't have to re-pick models they previously dropped in the data dir. Multi-window guests (`npm run start:guest`) use a separate `--storage` so each peer maintains its own registry and session store, just like the Autobase writer key.

### Spec build pipeline

`npm run build:worker-specs` runs `schema.js` which writes `spec/schema/`, `spec/db/`, and `spec/dispatch/`. Both `build:renderer` and `start` run this first via npm scripts.

| Schema constraint                                                          | What to do                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| hyperschema doesn't accept `double`                                        | use `float64`                                                       |
| All schemas must be registered _before_ a single `Hyperschema.toDisk` call | calling `toDisk` twice causes "Invalid request type" errors         |
| hyperschema has no v1 arrays-of-named-records                              | serialise batches as JSON (workaround: see "HyperDB gotchas" below) |

**Schema changes are not backward-compatible.** Compact-encoding is positional — any change to a dispatch or collection schema (add/remove/rename/reorder fields) makes every byte written by the old encoder undecodable by the new one. The project is greenfield so we don't carry production data; whenever you change `schema.js` and regenerate specs, wipe the local storage dirs before restarting:

```sh
npm run clean:storage        # interactive
npm run clean:storage:force  # no prompt
```

The script removes `./tmp-tamarind-guest/` (guest) and `<tmpdir>/pear/Tamarind/` (host).

### Storage

A storage dir holds the Corestore. In dev this defaults to `<tmpdir>/pear/<name>`. In production it's per-OS:

- Mac: `~/Library/Application Support/<name>`
- Linux: `~/.config/<name>`
- Windows: `%USERPROFILE%\AppData\Local\<name>`

The `--storage` flag overrides the location, which is how the two-peer dev test works (host + guest use separate dirs to simulate two devices on one machine).

Two sibling files live alongside the Corestore in `userData/`:

| File                     | Owner                               | Purpose                                                                                                     |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `identity.json`          | Renderer (via worker)               | Writer keypair + display name; survives relaunch                                                            |
| `models.json`            | Electron main (via `modelStore.js`) | Phase-5 model registry + `lastSelectedModelId` + `aiConfig` (per-load ctx_size + tools)                     |
| `ai-sessions.json`       | Electron main (via `sessions.js`)   | AI chat session store (programmatic slugs, `main` pinned)                                                   |
| `qvac.config.json`       | Electron main (via `qvac.js`)       | Tells the QVAC SDK where to write its llama.cpp cache (`<userData>/qvac-cache`)                             |
| `<userData>/qvac-cache/` | QVAC SDK                            | Downloaded model artifacts (`<hash>_<basename>` files), cache-resettable via `bridge.models.resetCache(id)` |

## HyperDB gotchas (worker)

Things that bit us in the worker and are worth knowing before you add another collection or route:

- **HyperDB has no `view.update(collection, query, fn)`.** Only `insert`, `delete`, `get`, `find`, `findOne`, `flush`. Earlier `view.update(...)` calls silently no-op'd (hyperbee interpreted the first arg as a core-refresh opts object) and the local reducer's optimistic edit was reverted on the next snapshot. Use the `applyUpdate` helper at the bottom of `workers/tamarind-room.js`: get → mutate → delete → insert.

- **`view.delete(collection, X)` expects a query object** like `{id: <buffer>}`. Passing the bare id (a Buffer) routes through `collection.encodeKey(X)` which does `X.id` and crashes with `Cannot read properties of undefined (reading 'buffer')`. Always pass `{id: ...}`.

- **`add-items` batch dispatch mangles Buffer fields.** The `@tamarind/add-items` route carries `items: json` (per the schema.js comment that hyperschema has no v1 arrays-of-named-records). `JSON.stringify(buffer)` produces `{"type":"Buffer","data":[byte,byte,…]}` which parses back as a plain object. When the router handler then calls `view.insert('@tamarind/items', item)`, HyperDB's key encoder does `BUFFER.preencode(state, record.id)`, hits `record.id.byteLength === undefined`, sets `state.end += NaN`, and `b4a.allocUnsafe(NaN)` throws "RangeError: Array buffer allocation failed". **Workaround in `workers/tamarind-room.js` `appendItem('add-items')`**: emit N `add-item` dispatches instead of one batch. Each item rides the `@tamarind/item` schema where `id`/`boardId` are typed `buffer`.

- **Optional `float64` fields decode as `0`, not `undefined`.** Combine this with `??` defaults and you get `item.fontSize ?? 12 → 0` because `??` doesn't catch `0`. New shapes had invisible text after the first worker round-trip. Always set a concrete default at creation time.

- **Bootstrap race.** `workers/tamarind-room-entry.js` seeds an Untitled board via `_ensureDefaultBoard()` from `_open()` (one-shot, flag-gated). Earlier code did this inside `_broadcast`; two concurrent broadcasts (one from `_open`, one from the append's own `update` event) would both observe `boards.length === 0` and both append, producing duplicate Untitled boards. Always gate bootstrap with a flag + check `existing.length > 0`.

- **Last-board delete guard.** Enforced at three layers: (1) `BoardsMenu` UI hides the delete button when `boards.length === 1`; (2) `canvasReducer.delete-board` early-returns when `state.boards.length <= 1`; (3) the worker's `delete-board` router handler re-checks `existingBoards.length <= 1` and refuses to append.

## Development

### Build commands

| Command                      | What it does                                                     |
| ---------------------------- | ---------------------------------------------------------------- |
| `npm run build:worker-specs` | Compile `schema.js` → `spec/{schema,db,dispatch}/`               |
| `npm run build:renderer`     | Production Vite build of the renderer (includes schema build)    |
| `npm run start`              | Dev: vite on :5173 + Electron (host, default)                    |
| `npm run start:guest`        | Dev: vite on :5174 + Electron (guest, separate `--storage`)      |
| `npm run clean:storage`      | Wipe host + guest Corestore dirs (required after schema changes) |
| `npm run package`            | Local Electron package                                           |
| `npm run make`               | Platform installers (dmg/msix/appimage/snap/flatpak)             |
| `npm run lint`               | `prettier --check . && lunte`                                    |
| `npm run format`             | `prettier --write . && lunte --fix`                              |

### Smoke tests

Two CDP-driven smoke suites in `c:/tmp/`:

| Test                         | What it covers                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/c/tmp/room-smoke.cjs`      | Two-electron P2P regression: shapes, chat, boards, rename, delete, last-board guard, active-board switch, chat delete + clear. Passes.                                                                                |
| `/c/tmp/templates-smoke.cjs` | Single-window regression for the `add-items` Buffer-mangling fix — drives a 3-item batch dispatch via the `__tamarind.room` test hook, asserts no worker crash. Passes.                                               |
| `/c/tmp/smoke.cjs`           | Legacy single-window smoke. **Pre-existing rot** — looks for an "Add note" toolbar button that doesn't exist + expects splash → canvas to resolve without the worker running. Out of scope for Phase 3 (see roadmap). |

The renderer exposes a test hook at `window.__tamarind.room`: `peek()` returns the latest `useRoom` state; `dispatch(action)` fires a raw `{type:'state-action', action}` IPC frame past any UI guards.

### Adding a new template

Templates live in `renderer/src/data/templates.ts` (the catalogue) and `renderer/src/data/templatesThumbnails.tsx` (the SVG previews). Each `Template` has:

```ts
{
  id: string
  name: string
  description: string
  build: (boardId: string, now: number) => BoardScopedItem[]
}
```

The `build()` factory returns a fresh array of items with placeholder `id`/`boardId`/`updatedAt`/`order: 0` — `CanvasPage.handleInsertTemplate` re-stamps them with the active board + fresh `uid()`s + the current timestamp before dispatching via the existing `add-items` reducer action.

To add a new template:

1. Add a `Template` constant to `templates.ts` (use the existing `rect` / `ellipse` / `text` / `arrow` helpers)
2. Append it to the `TEMPLATES` array
3. Add a hand-rolled `<TemplateThumbnail id={tpl.id} />` SVG to `templatesThumbnails.tsx` (use the same viewBox `0 0 160 100` so the modal grid stays consistent)

### Code style

`prettier-config-holepunch` is the formatter; `lunte` is the linter. Both run via `npm run lint` / `npm run format`. TypeScript is checked with `npx tsc --noEmit -p renderer/tsconfig.json`.

## Troubleshooting

### "RangeError: Array buffer allocation failed" on insert

You're hitting the `add-items` batch dispatch Buffer-mangling bug — see "HyperDB gotchas" above. If you see this with a single `add-item` (not `add-items`), it's a different issue: check that the item's `id` is a real Buffer (or hex string that the worker can `b4a.from(hex)`) before it hits the dispatch.

### Two Tamarind windows can't find each other

Loopback Hyperswarm discovery on Windows can take 20–60s before the replica pull opens. The smoke harness waits up to 90s. If two windows on the same machine can't see each other, confirm they're using **different** `--storage` dirs (a second window with the same storage dir would share the writer key — that's the same user, not two peers).

### `pear touch` errors during `npm run make`

`forge.config.js` validates the `package.json#upgrade` field via `pear-link.parse`. Run `pear touch` to mint a fresh upgrade key, then set it as `package.json#upgrade` or pass `UPGRADE_KEY=<link> npm run make`.

### Worker throws "Invalid request type" on launch

You added a schema definition after the `Hyperschema.toDisk` call in `schema.js`. Move it before line 145 (`Hyperschema.toDisk(hyperSchema)`).

### `bridge.models.*` returns `{ success: false, error: 'bridge not available' }`

The renderer's preload didn't run — you're hitting the `noopBridge` stub (e.g. running the renderer in a standalone vite build without Electron, or Electron started without the preload script). Same trap will hit any in-flight test that opens `http://localhost:5173` directly without spawning the BrowserWindow. Run via `npm run start` (which spawns Electron + the preload), or pass `?bypass-splash=1` once you wire that escape hatch.

### `models:error` push immediately after `models:select` with code `FILE_NOT_FOUND`

The entry's `source` points at a path that doesn't exist (file moved/deleted, or a custom entry seeded before the file was actually dropped into `userData`). Re-pick the file via the modal's "Add custom model → File" path so the absolute path matches the current disk layout.

### QVAC worker eats a percent of CPU after unload

The SDK's subprocess doesn't always exit cleanly when `unloadCurrent(modelId)` returns. It's idle (no listeners on the inference port), so the leak is cosmetic — kill it via `bridge.ai.unload()` followed by app quit, or ignore until the process model accepts the SDK's `stopQVACProvider` once we wire it. Tracked in the Sprint-6 inference surface.

## Tech Stack

**Renderer** — React 19 + TypeScript, Vite 7, Tailwind CSS v4, framer-motion, lucide-react.

**P2P data plane** — Holepunch stack: [pear-runtime][pear-runtime], [bare][bare] workers, [autobase][autobase], [hyperdb][hyperdb], [hyperschema][hyperschema], [hyperdispatch][hyperdispatch], [hyperswarm][hyperswarm], [blind-pairing][blind-pairing], [corestore][corestore], [z32][z32].

**Local AI runtime** — [`@qvac/sdk`][qvac-sdk] (Qwen3 models from the SDK's built-in registry, `QWEN3_1_7B_INST_Q4` + `QWEN3_4B_INST_Q4_K_M`). Lives in the Electron main process and spawns a llama.cpp worker subprocess for inference.

**Electron shell** — Electron 40, Electron Forge, paparam for CLI parsing, [`@electron-forge/maker-*`][electron-forge] for distributables, [`pear-electron-forge-maker-*`][pear-electron-forge] for pear-paired installers.

## License

Apache-2.0

## Credits

Tamarind is built on the excellent open-source P2P stack from [Holepunch](https://holepunch.com):

- **[hello-pear-electron](https://github.com/holepunchto/hello-pear-electron)** — the upstream Electron + Pear template that Tamarind is forked from
- **[pear-runtime][pear-runtime]** — P2P runtime that powers application updates
- **[bare][bare]** — embedded runtime for background workers
- **[hypercore][hypercore]** / **[hyperdrive][hyperdrive]** — replicated data structures
- **[corestore][corestore]** — replication coordination
- **[hyperswarm][hyperswarm]** — peer discovery
- **[autobase][autobase]** — multi-writer replicated log
- **[hyperdb][hyperdb]** — keyed collections over Autobase

The renderer is built with [React](https://react.dev), [Vite](https://vitejs.dev), [Tailwind CSS](https://tailwindcss.com), [framer-motion](https://www.framer.com/motion/), and [lucide-react](https://lucide.dev).

<!-- Reference Links -->

[pear-runtime]: https://github.com/holepunchto/pear-runtime
[electron]: https://www.electronjs.org/
[bare]: https://github.com/holepunchto/bare
[nodejs]: https://nodejs.org
[pear-docs]: https://docs.pears.com
[hyperdrive]: https://github.com/holepunchto/hyperdrive
[hypercore]: https://github.com/holepunchto/hypercore
[autobase]: https://github.com/holepunchto/autobase
[hyperdb]: https://github.com/holepunchto/hyperdb
[hyperschema]: https://github.com/holepunchto/hyperschema
[hyperdispatch]: https://github.com/holepunchto/hyperdispatch
[hyperswarm]: https://github.com/holepunchto/hyperswarm
[blind-pairing]: https://github.com/holepunchto/blind-pairing
[corestore]: https://github.com/holepunchto/corestore
[z32]: https://github.com/holepunchto/z32
[electron-forge]: https://www.electronforge.io/
[pear-electron-forge]: https://github.com/holepunchto
[qvac-sdk]: https://github.com/tetherto/qvac
