# Changelog

## v1.0.0 (Tamarind)

### Positioning

Tactical whiteboard for teams that need to win &mdash; sports, sales, hackathons. Offline-first canvas, P2P team sync, local AI coach, with a "Phantom Coach" computer-vision vision for later sprints.

### Features

- Rebrand from `hello-pear-electron` / `HelloPear` to `tamarind` / `Tamarind`
- Migrate renderer from vanilla JS to React 19 + TypeScript
- Add Vite build pipeline with HMR
- Add Tailwind CSS v4 with Tamarind theme palette
- Add framer-motion for entry/hover/click animations
- Add lucide-react for iconography
- Splash page (logo + spinner) that waits for the worker to be ready before transitioning to the canvas page
- Canvas page placeholder with light-theme header/footer (full tactical canvas lands in Sprint 1)
- Wire background `pear-runtime` worker for future P2P board sync
- Companion landing page (`tamarind-landing/`) &mdash; React + Vite + Tailwind v4, sections for navbar / hero / what-it-is / team+AI / features / use-cases / CTA / footer
- App ID: `io.tamarind.app`; multisig namespace: `dev.tamarind/tamarind`

### Vision

- **Phantom Coach** &mdash; computer vision watches match video and auto-populates the board with player movements, then a local LLM gives real-time voice feedback. All inference stays on-device.

### Notes

- Built on the [Holepunch `hello-pear-electron`](https://github.com/holepunchto/hello-pear-electron) template
- Real `pear touch` upgrade key, multisig public keys, and icons to be supplied before first release
