# Security model

## Transport

WebRTC encrypts media with DTLS-SRTP and data channels with DTLS/SCTP. A TURN relay forwards encrypted WebRTC packets; it does not need access to their plaintext.

The signaling service is not an end-to-end trust anchor. Production deployments must use HTTPS/WSS and authenticated TURN credentials.

## Signaling service

The service stores live room membership only in memory and imposes bounded signaling payloads. The network boundary performs strict runtime message validation, per-connection rate limiting, failed room-authorization throttling, and idle connection cleanup.

Browser Origin enforcement is configured with `VERGE_ALLOWED_ORIGINS` as a comma-separated HTTP/HTTPS origin allowlist. It is optional for local development and required when `NODE_ENV=production`; production startup fails closed when the allowlist is missing.

### Room invitations

A room identifier is routing metadata, not authorization.

Production also requires `VERGE_INVITE_SHARED_SECRET`. A fresh room is created through `POST /api/rooms`, which returns:

- a random room ID
- a versioned HMAC-SHA256 invitation token
- an invitation expiry

The invitation token is bound to the room ID and expiry. The shared signing secret remains on the signaling service and is never shipped in the browser bundle. A join with a missing, tampered, expired, or room-mismatched invitation is rejected before the socket is inserted into room membership or announced to peers.

Invitation links are intentionally reusable until expiry so multiple participants can use the same meeting link. This is explicit replay handling, not one-time-token semantics. Possession of the invite grants entry to that room until expiry; it does not establish cryptographic participant identity.

Failed room-authorization attempts are bounded per signaling connection. Do not log invitation tokens or include them in analytics.

Remaining public-service hardening includes:

- per-IP and per-room quotas in addition to current per-connection budgets
- connection and room creation quotas
- abuse logging without persisting SDP or invitation tokens
- optional revocation/stateful room policies where required

## TURN

A production installation needs TURN because direct ICE connectivity is not possible across every NAT/firewall combination.

Use short-lived TURN credentials. Do not commit long-lived TURN usernames/passwords to the web bundle.

Prefer TURN over TLS on 443 as an available fallback for restrictive networks.

## Files

A received file is untrusted content even when its SHA-256 matches the sender's announced hash. Hash verification detects corruption or protocol mismatch; it does not prove that the file is safe.

Do not auto-open received files.

## Identity and E2EE

Authenticated room invitations are access control, not participant identity.

Verge currently relies on WebRTC transport encryption but does not yet provide cryptographic participant identity verification. Before introducing an SFU, recording service, or other media intermediary, add application-level end-to-end encryption with participant identity verification. The intended browser primitive is encoded transforms / `RTCRtpScriptTransform`.

Identity keys and room key agreement belong above signaling so a compromised signaling service cannot silently become a trusted participant.

## Browser permissions

Camera, microphone, and display capture must remain explicit browser permission flows. Verge must not attempt to persist or bypass permission decisions.

Display-capture selection is controlled by the browser/OS picker.
