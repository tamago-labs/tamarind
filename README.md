# Tamarind

> The tactical whiteboard that works anywhere. Offline-first, P2P synced, AI-assisted.

Internet is the first thing to fail when teams need it most. Stadiums, conference venues, and hackathon halls often have unreliable or overloaded networks, making real-time collaboration frustrating.

**Tamarind** is the tactical whiteboard that works anyway — sports teams, sales teams, and hackathon crews plan strategy offline on a shared canvas, sync P2P with the rest of the team using **Pear by Holepunch**, and get AI-powered suggestions to sharpen their approach through **QVAC**, all without the cloud.

- **Offline-first tactical canvas** — Multi-board collaborative workspace with templates for sports, sales, system design, or a blank canvas.
- **Peer-to-peer collaboration** — **Hyperswarm** peer discovery (powered by **HyperDHT** for internet-wide P2P) with an **Autobase** multi-writer log and **HyperDB** replicated state, enabling conflict-free collaboration across the internet without centralized infrastructure.
- **Built-in team chat** — Share invite codes and communicate alongside your whiteboard.
- **Local AI assistant** — Execute **Meta Llama**, **Qwen**, and **Gemma** GGUF models locally through **QVAC**, with peer-to-peer AI relay so teammates can use the host's loaded model without downloading their own.
- **Tactical whiteboard persistence** — Every board operation is appended to **Hypercore**, providing deterministic replay, backup/restore, SVG/PNG export, and a tamper-evident audit trail.

This project is a fork of the [Holepunch `hello-pear-electron` template](https://github.com/holepunchto/hello-pear-electron).

## Quick Start

**Tamarind** is currently under active development. Setup files are not yet available, so you'll need to clone this repository and run it from source.

### Prerequisites

- Node.js 20+
- npm

### 1. Install dependencies

```sh
npm install
```

### 2. Start the host

```sh
npm start
```

This launches the host instance. During development, the renderer is served by Vite while the desktop application runs through Electron.

### 3. Start a guest (optional)

To test peer-to-peer collaboration locally, open a second terminal:

```sh
npm run start:guest
```

The guest uses a separate local storage directory so it behaves as an independent device.

### 4. Connect both peers

1. Start the host.
2. Copy the invite code from the Team panel.
3. Launch the guest.
4. Select **Join Existing Board** and paste the invite code.
5. Both windows will synchronize the same whiteboard, chat history, and AI state over P2P.

### 5. Try Local AI

1. Click the **AI** status pill in the footer.
2. Select **Qwen3-1.7B** or **Qwen3-4B** to download and load through **QVAC**, or import your own custom **GGUF** model.
3. Open the **AI Chat** tab.
4. Choose either:
   - **Local** — use the model loaded on your device.
   - **Host** — relay AI requests through another peer's loaded model over P2P, without loading a model locally.

### Build

```sh
npm run package    # Package the application
npm run make       # Build platform installers
```

For production P2P distribution and multisig releases, Tamarind follows the standard **Pear Runtime** workflow (`pear build`, `pear stage`, `pear provision`, and `pear multisig`).

## Core Features

### Offline Tactical Whiteboard

The canvas is designed for tactical planning rather than generic diagramming, with deterministic synchronization across peers.

- Five object types: **rectangle**, **ellipse**, **connector**, **first-class text** with in-place double-click editing, and **sticky notes** for quick annotations.
- Figma-style connector workflow with five connection ports per shape, bezier or straight routing, configurable arrows, stroke styles, labels, and snap previews.
- Rich editing tools including drag, resize, marquee selection, z-order, per-object styling, and connector configuration.
- Deterministic connector attachment that automatically follows connected shapes during movement and safely orphans connectors when shapes are removed.
- High-frequency local rendering during drag operations with commit-on-release replication, reducing unnecessary network traffic.
- SVG and PNG export with selection-aware rendering, plus board backup and restore.
- Persistent display names across sessions and peers (Identity).
- Video upload and display on the canvas (50MB limit).
- **Prompt-to-Canvas** — AI can create shapes on the canvas from chat prompts.
- **Knowledge Base** — RAG-powered document search for instant access to stored information.

### Multi-Board Workspace

A single Tamarind workspace can contain multiple tactical boards.

- Create, rename, switch, and delete boards from the toolbar.
- All boards share the same collaboration session and invite code.
- Last-board protection enforced across the UI, reducer, and worker layers.

### Peer-to-Peer Collaboration

Built entirely on the **Pear Runtime** ecosystem.

- Peer discovery through **Hyperswarm** using invite codes.
- **HyperDHT**-powered internet-wide P2P connectivity across corporate networks, mobile networks, and public internet.
- Multi-writer synchronization powered by **Autobase** with **HyperDB** replicated views.
- Encrypted replicated collections for boards, canvas items, chat, invitations, and AI state.
- Every reducer action is replicated as an append-only operation, allowing new peers to replay history and converge deterministically.
- Snapshot synchronization for fast peer onboarding while transient drag updates remain local until commit.
- Two embedded Bare workers separate the application runtime from the collaboration data plane.
- Peer-to-peer over-the-air application updates through Pear Runtime.

### Team Collaboration

Communication is integrated directly into the workspace.

- Built-in group chat with persistent replicated history.
- Stable writer identities backed by persistent Hypercore keypairs.
- Editable display names while preserving cryptographic peer identity.
- Invite-code onboarding without requiring accounts or cloud services.

### Local AI with QVAC

Local AI is integrated directly into the tactical workflow.

- Built-in **Qwen3-1.7B** and **Qwen3-4B** models.
- Import custom **GGUF** models from disk or remote URLs.
- Configurable context size and tool support persisted between sessions.
- Streaming chat with persistent conversation history.
- Local or Host inference modes.
- P2P AI relay allows teammates to use another peer's loaded model without downloading a model themselves.
- **Prompt-to-Canvas** — AI can create shapes on the canvas from chat prompts.
- **Knowledge Base** — RAG-powered document search for instant access to stored information.
- Complete IPC pipeline connecting the Electron renderer to the QVAC SDK running in the main process.

### Built-in Templates

Ready-to-use templates for common tactical planning scenarios.

- **Football** — 4-4-2, 4-3-3, Corner Kick, Free Kick, Blank Pitch
- **Basketball** — 2-3 Zone, Blank Court
- **Marketing** — SWOT, Funnel, User Journey
- **Product** — Roadmap, Prioritization, Story Map, Lean Canvas
- **Strategy** — BMC, Quarterly Planning, OKRs
- **Startup** — Idea Canvas, Pitch Flow, MVP Planning, Task Board
- **General** — Flowchart, Kanban, Timeline

Each template is generated as editable canvas objects rather than static images, allowing teams to immediately modify every element after insertion.

---

## Currently in Development

### Keet Identity

Portable identity across devices using a 24-word mnemonic phrase from Keet.

### Collaboration Enhancements

Additional capabilities planned:

- Live cursor presence.
- Snap-to-grid and smart alignment.
- Group and ungroup objects.
- Lock and hide objects.
- Context menus.
- Multi-room hosting with independent collaboration sessions.
- Portable writer identities across devices.
- Shared AI preferences replicated through Autobase.

## Architecture

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

MIT

## Credits

Tamarind is built on the open-source P2P stack from [Holepunch](https://holepunch.to/):

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
