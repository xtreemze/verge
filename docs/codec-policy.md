# Codec policy

Last reviewed: 2026-10-04.

Verge never assumes that a codec exists merely because a browser version can support it. Codec availability and efficiency depend on browser build, OS, hardware acceleration, driver support, capture parameters, and the remote peer.

## Negotiation

Before creating an offer or answer, Verge reads `RTCRtpSender.getCapabilities()` and reorders the capabilities passed to `RTCRtpTransceiver.setCodecPreferences()`.

The canonical preference ordering lives in
`packages/webrtc/src/codec-policy.ts` and is consumed by both the
runtime negotiation adapter and the public site. The current order is
AV1, VP9, HEVC / H.265, H.264, then VP8. Opus is preferred for audio.

Unknown browser-provided codecs are retained after the preferred codecs instead of being discarded. RTX/RED/ULPFEC repair codecs are retained as well.

The SDP offer/answer exchange remains authoritative: a preferred codec is used only when both peers can negotiate it.

## Why runtime detection

Chrome supports a broad WebRTC codec set, but encode/decode capability and power efficiency are not uniform across machines. AV1 is especially useful for bandwidth efficiency and detailed screen content, while hardware-backed HEVC or H.264 may be more power-efficient on some systems.

A later quality controller should combine:

- RTP codec capabilities
- Media Capabilities smooth/power-efficient signals where available
- `RTCPeerConnection.getStats()`
- current packet loss, RTT, and available bitrate
- encoder quality-limitation reason
- participant tile size and visibility

Codec preference should not prevent congestion control from reducing bitrate, resolution, or frame rate.

## Screen content

Camera tracks use `contentHint = "motion"`.

Display capture exposes two profiles through `@verge/media`: `detail`
uses `contentHint = "detail"` and favors text/UI clarity at a lower
frame rate, while `motion` uses `contentHint = "motion"` and requests
a higher frame rate for video, animation, or game streaming.

## Compatibility references

- WebRTC codec capability API: https://developer.mozilla.org/docs/Web/API/RTCRtpSender/getCapabilities
- Codec preferences: https://developer.mozilla.org/docs/Web/API/RTCRtpTransceiver/setCodecPreferences
- Chrome AV1/WebRTC background: https://developer.chrome.com/blog/av1
- Tauri releases: https://v2.tauri.app/release/
