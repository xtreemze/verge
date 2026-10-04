# Two-phone Android MVP smoke test

This is the first physical-device acceptance path for Verge.

## Scope

The smoke test verifies one room across two Android phones running Chrome:

- room join and signaling
- direct WebRTC camera/microphone
- two-way speech audio
- text chat
- small-file transfer
- camera switching
- connection-quality / ICE-path reporting
- screen sharing when the browser exposes `getDisplayMedia()`

Background blur is capability-gated. Its absence is not an MVP failure on a phone that does not expose native blur.

## Prerequisites

- two Android phones with Developer options and USB debugging enabled
- Chrome installed as `com.android.chrome`
- both devices authorized in `adb devices -l`
- Node.js and pnpm versions required by the repository
- the phones on the same Wi-Fi/LAN for the initial direct-P2P test
- TURN configured only when testing relay/fallback behavior

## Run

From the repository root:

```bash
pnpm install
pnpm dev
```

Keep the development processes running. In another terminal:

```bash
pnpm android:pair
```

If more than two devices are attached, pass the exact serials:

```bash
pnpm android:pair -- SERIAL_A SERIAL_B
```

The script:

1. creates one valid Verge room ID;
2. reverses phone ports 5173 and 8787 to the development machine;
3. forwards each Chrome DevTools socket to host ports 9222 and 9223;
4. opens Chrome on both phones at the same room, with distinct names and diagnostics enabled.

Using `http://localhost:5173` through ADB reverse is deliberate. Loopback/localhost is treated as a trustworthy origin, so camera and microphone APIs remain available without setting up temporary LAN TLS certificates.

## Acceptance checklist

On both phones, tap **Join room** and allow camera/microphone access.

Pass when all of the following hold:

- both phones show **Connected**;
- each phone renders the other participant;
- speech is audible in both directions without obvious echo;
- the diagnostics badge reports a direct ICE path on the same LAN, or relay when intentionally testing TURN;
- Phone A can send chat to Phone B and vice versa;
- a small file sent in either direction reaches **complete** and is downloadable;
- changing front/back camera does not leave the room;
- muting microphone and disabling camera propagate without reconnecting;
- screen sharing either starts successfully or is clearly marked unavailable by capability detection;
- leaving from either side removes that participant from the other side.

## DevTools and diagnostics

The pairing script forwards Chrome DevTools:

- Phone A: `http://localhost:9222/json`
- Phone B: `http://localhost:9223/json`

The app is launched with `debug=1`; the in-page Media capabilities panel shows secure-context status, display-capture availability, codec negotiation candidates, topology, and signaling URL.

## Network notes

ADB reverse only transports the web UI and WebSocket signaling service. RTP/SRTP and data-channel traffic still follows normal WebRTC ICE candidate selection between the phones. This is important: the smoke test remains a real peer-to-peer media test rather than tunneling conference media over USB.

For different networks, carrier NAT, or deliberately hostile NAT conditions, configure TURN through the existing ICE configuration surface before treating failure to connect as an application regression.
