# Roadmap

## Milestone 1 — functional P2P room

- [x] room signaling
- [x] multi-peer mesh
- [x] camera and microphone
- [x] speech noise suppression / echo cancellation
- [x] original-audio capture mode
- [x] runtime codec preference
- [x] screen/window sharing
- [x] text chat
- [x] chunked SHA-256 verified file transfer
- [x] browser capability display
- [x] two-phone Android ADB smoke harness
- [ ] production TURN configuration
- [ ] software background segmentation fallback when native blur is unavailable
- [ ] adaptive bitrate/resolution controller driven by getStats()
- [ ] connection-quality UI

## Milestone 2 — hardening

- schema validation for every signaling message
- room/invite authentication
- rate limiting and idle room expiry
- streaming file writes instead of whole-file receiver buffering
- device switching without leaving the room
- speaker/output selection where supported
- reconnect / ICE restart
- network handover testing
- screen-share content mode: detail vs motion
- multi-browser/device E2E matrix

## Milestone 3 — privacy and scale

- participant identity keys
- verifiable room fingerprints
- encoded-transform application E2EE
- topology abstraction with optional SFU
- simulcast/SVC policy for SFU rooms
- optional local recording
- optional captions with explicit user control

## Milestone 4 — native media

Only move media work into Rust/native code when measurements show a platform advantage. Candidate reasons include capture integration, hardware codec access, advanced noise suppression, virtual camera support, or parity where a system WebView lacks a required browser primitive.
