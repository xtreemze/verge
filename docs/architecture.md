# Architecture

## Principles

Verge is browser-first, peer-to-peer by default, and server-minimal by design.

The signaling service is a rendezvous mechanism. It knows room membership and forwards SDP/ICE messages, but it does not ingest camera, microphone, screen, chat, or file payloads. Media travels over WebRTC SRTP and application data over WebRTC data channels.

## Monorepo

- `apps/web`: SolidJS browser client.
- `apps/signaling`: ephemeral WebSocket room/signaling service.
- `apps/desktop`: Tauri shell.
- `packages/protocol`: JSON-safe signaling and data contracts.
- `packages/media`: capture and local media processing capabilities.
- `packages/webrtc`: codec policy and per-peer WebRTC sessions.
- `packages/conference`: room-level mesh orchestration.

The packages deliberately avoid SolidJS state. UI and transport can therefore evolve independently.

## Mesh topology

A room with N participants establishes up to N × (N - 1) / 2 peer connections. Every participant sends a camera/audio encoding to every other participant.

This preserves direct P2P behavior for small rooms but makes upload bandwidth and encoder load grow linearly per participant. The initial signaling server defaults to eight participants, but practical mesh limits depend on resolution, hardware encoders, network uplink, and whether screen sharing is active.

The conference package is the boundary for a future SFU transport. The application domain should not depend directly on SFU-specific concepts.

## Connection establishment

When a participant joins:

1. Signaling returns the existing participants.
2. The joining participant creates offers to those existing participants.
3. Existing participants answer.
4. ICE candidates are exchanged through signaling.
5. ICE attempts direct connectivity and can fall back to TURN.
6. Media and data flow through the negotiated peer connection.

This asymmetry avoids offer glare for initial room joins.

## Media

Camera/microphone are acquired before peer connections are created so all initial negotiations contain audio, video, and SCTP data-channel sections.

Screen sharing replaces the outbound camera video track with a display track using `RTCRtpSender.replaceTrack()`; returning to camera does not require renegotiation.

Speech audio requests echo cancellation, noise suppression, automatic gain control, and mono capture. Original-audio mode disables those processors and requests stereo.

## Data channels

Each peer connection negotiates an ordered `chat` channel.

File transfers use dedicated ordered channels. Files are SHA-256 hashed, divided into 64 KiB chunks, sent with data-channel backpressure, reassembled by the receiver, and hashed again before being offered for download.

The current receiver buffers a transferred file in memory. A later desktop/browser filesystem integration should stream large files directly to storage.

## Platform boundary

The browser is the reference implementation. Tauri provides native packaging and OS integration without changing the conference domain.

A future native media engine can be introduced behind the media/WebRTC interfaces if system WebView behavior, native capture, hardware codec access, or advanced DSP requires it.
