# Roadmap

## MVP — working P2P conference

- [x] room signaling
- [x] multi-peer mesh
- [x] camera and microphone
- [x] speech noise suppression / echo cancellation
- [x] original-audio capture mode
- [x] runtime codec preference
- [x] receiver-safe codec preference ordering
- [x] screen/window sharing where the platform exposes display capture
- [x] text chat
- [x] chunked SHA-256 verified file transfer
- [x] bounded receive storage and transfer progress/cancellation
- [x] browser capability display
- [x] adaptive bitrate/resolution controller driven by getStats()
- [x] connection-quality and direct/relay ICE-path UI
- [x] device switching without leaving the room
- [x] speaker/output selection where supported
- [x] ICE restart and signaling reconnect
- [x] signaling message validation
- [x] signaling rate limiting and idle expiry
- [x] production origin allowlist
- [x] short-lived TURN REST credentials
- [x] production Caddy + signaling + coturn Compose deployment
- [x] two-peer Chromium E2E certification
- [x] forced TURN relay E2E certification
- [x] two-phone Android ADB smoke harness
- [ ] certify the merged MVP on two physical Android phones (#41)

## Post-MVP hardening

- [ ] room/invite authentication (#19)
- [ ] software background segmentation fallback when native blur is unavailable (#5)
- [ ] resumable file offsets/acknowledgements after interruption (#6)
- [ ] Wi-Fi ↔ cellular network handover certification (#41)
- [ ] broader Chrome/Edge device matrix
- [ ] TURN over TLS/443 for highly restrictive networks
- [ ] operational metrics and abuse controls for public deployment

## Privacy and scale

- [ ] participant identity keys
- [ ] verifiable room fingerprints
- [ ] encoded-transform application E2EE (#13)
- [ ] optional SFU implementation behind the existing topology contract (#14)
- [ ] simulcast/SVC policy for SFU rooms
- [ ] optional local recording
- [ ] optional captions with explicit user control

## Native media

Tauri remains outside the browser MVP release gate. Certify system-WebView media parity separately (#20). Move media work into Rust/native code only when measurements show a platform advantage, such as capture integration, hardware codec access, advanced noise suppression, virtual camera support, or parity where a system WebView lacks a required browser primitive.
