# Security model

## Transport

WebRTC encrypts media with DTLS-SRTP and data channels with DTLS/SCTP. A TURN relay forwards encrypted WebRTC packets; it does not need access to their plaintext.

The signaling service is not an end-to-end trust anchor. Production deployments must use HTTPS/WSS and authenticated TURN credentials.

## Signaling service

The current service intentionally stores room state only in memory and imposes a small signaling payload limit. Before public deployment add:

- strict Origin allowlisting (`VERGE_ALLOWED_ORIGINS`, required in production)
- authentication or cryptographically unguessable room invitations
- per-IP and per-room rate limits
- connection and room creation quotas
- structured schema validation instead of type assertions
- abuse logging without persisting SDP longer than necessary
- deployment behind TLS
- bounded room lifetime / idle expiry

A room identifier is routing metadata, not a password.

## TURN

A production installation needs TURN because direct ICE connectivity is not possible across every NAT/firewall combination.

Use short-lived TURN credentials. Do not commit long-lived TURN usernames/passwords to the web bundle.

Prefer TURN over TLS on 443 as an available fallback for restrictive networks.

## Files

A received file is untrusted content even when its SHA-256 matches the sender's announced hash. Hash verification detects corruption or protocol mismatch; it does not prove that the file is safe.

Do not auto-open received files.

## Identity and E2EE

Initial Verge relies on WebRTC transport encryption but does not yet provide cryptographic participant identity verification.

Before introducing an SFU, recording service, or other media intermediary, add application-level end-to-end encryption with participant identity verification. The intended browser primitive is encoded transforms / `RTCRtpScriptTransform`.

Identity keys and room key agreement belong above signaling so a compromised signaling service cannot silently become a trusted participant.

## Browser permissions

Camera, microphone, and display capture must remain explicit browser permission flows. Verge must not attempt to persist or bypass permission decisions.

Display-capture selection is controlled by the browser/OS picker.
