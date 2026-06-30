# Changelog

## v1.0.0 (Tamarind)

### Features

- Rebrand from `hello-pear-electron` / `HelloPear` to `tamarind` / `Tamarind`
- Migrate renderer from vanilla JS to React 19 + TypeScript
- Add Vite build pipeline with HMR
- Add Tailwind CSS v4 with Tamarind theme palette
- Add framer-motion for entry/hover/click animations
- Add lucide-react for iconography
- New Tamarind main page: wordmark, hero tagline, "New Board" / "Join Board" CTAs, recent-boards card, status footer
- Wire background `pear-runtime` worker for future P2P board sync
- App ID: `io.tamarind.app`; multisig namespace: `dev.tamarind/tamarind`

### Notes

- Built on the [Holepunch `hello-pear-electron`](https://github.com/holepunchto/hello-pear-electron) template
- Real `pear touch` upgrade key, multisig public keys, and icons to be supplied before first release
