# Verge

Peer-to-peer audio, video, screen sharing, chat, and file transfer for the modern web and Tauri.

Verge is a small-room conferencing system built around standards-based WebRTC. The browser application negotiates the best mutually supported codecs at runtime, keeps media and data peer-to-peer whenever network conditions permit, and uses a minimal signaling service only for room membership, SDP, and ICE exchange.

## Goals

- Multi-party camera and microphone conferencing
- Screen, window, and tab sharing
- Peer-to-peer text chat
- Chunked, hash-verified file exchange
- Background blur and extensible video effects
- Echo cancellation and noise suppression, with an original-audio mode
- Runtime codec negotiation with AV1, VP9, HEVC, H.264, and VP8 where supported
- Opus audio
- STUN/TURN support
- Browser-first implementation with a Tauri 2 desktop shell
- Strong TypeScript boundaries and testable transport/media abstractions
- An upgrade path from P2P mesh rooms to an SFU without rewriting the application domain

## Status

Initial scaffold. The first milestone establishes signaling, media acquisition, codec selection, room transport, chat/file data channels, and a functional SolidJS conferencing UI.

## Development

Prerequisites:

- Node.js 22.13+
- pnpm 12
- Rust toolchain only when building the Tauri desktop application

```bash
pnpm install
pnpm dev
```

The web client runs on http://localhost:5173 and the signaling service on ws://localhost:8787.

### Two-phone Android smoke test

With two USB-debuggable Android phones attached and `pnpm dev` running:

```bash
pnpm android:pair
```

This uses ADB reverse for the web/signaling ports, opens both Chrome instances in the same room, and exposes their DevTools targets on host ports 9222 and 9223. See `docs/android-adb-mvp.md` for the acceptance checklist and TURN/network notes.

## Landing and onboarding site

The static landing and onboarding experience lives in `apps/site` and is built with Astro on Vite.

```bash
pnpm site:dev
pnpm site:build
```

The GitHub Pages workflow publishes the site at `https://xtreemze.github.io/verge/`. It intentionally does not host the signaling service. If a separately deployed Verge web client should be launched from onboarding, provide `PUBLIC_VERGE_APP_URL` when building the site; otherwise onboarding links to the local development setup.

See `docs/architecture.md`, `docs/codec-policy.md`, and `docs/security.md` for design constraints.
