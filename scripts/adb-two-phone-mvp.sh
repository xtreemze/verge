#!/usr/bin/env bash
set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "adb is required and was not found in PATH." >&2
  exit 1
fi

serial_a="${1:-${VERGE_ANDROID_A:-}}"
serial_b="${2:-${VERGE_ANDROID_B:-}}"

if [[ -z "${serial_a}" || -z "${serial_b}" ]]; then
  devices="$(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [[ "$count" -ne 2 ]]; then
    echo "Expected exactly two authorized Android devices. Found $count." >&2
    echo "Pass serials explicitly: pnpm android:pair -- <serial-a> <serial-b>" >&2
    adb devices -l >&2
    exit 1
  fi

  serial_a="$(printf '%s\n' "$devices" | sed -n '1p')"
  serial_b="$(printf '%s\n' "$devices" | sed -n '2p')"
fi

if [[ "$serial_a" == "$serial_b" ]]; then
  echo "Two different device serials are required." >&2
  exit 1
fi

room="${VERGE_ROOM_ID:-}"
if [[ -z "$room" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    room="$(openssl rand -hex 16)"
  else
    room="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))')"
  fi
fi

if [[ ! "$room" =~ ^[A-Za-z0-9_-]{1,64}$ ]]; then
  echo "VERGE_ROOM_ID must be a valid 1–64 character Verge room identifier." >&2
  exit 1
fi

prepare_device() {
  local serial="$1"
  local devtools_port="$2"

  adb -s "$serial" get-state >/dev/null
  adb -s "$serial" reverse tcp:5173 tcp:5173 >/dev/null
  adb -s "$serial" reverse tcp:8787 tcp:8787 >/dev/null
  adb -s "$serial" forward "tcp:${devtools_port}" localabstract:chrome_devtools_remote >/dev/null

  local version
  version="$(
    adb -s "$serial" shell dumpsys package com.android.chrome 2>/dev/null |
      sed -n 's/.*versionName=//p' |
      head -n 1 |
      tr -d '\r'
  )"
  echo "$serial · Chrome ${version:-unknown} · DevTools http://localhost:${devtools_port}"
}

launch_device() {
  local serial="$1"
  local name="$2"
  local encoded_name
  encoded_name="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$name")"
  local url="http://localhost:5173/?room=${room}&name=${encoded_name}&debug=1"

  adb -s "$serial" shell am start -W     -a android.intent.action.VIEW     -d "$url"     com.android.chrome >/dev/null
}

echo "Preparing Verge Android MVP room: $room"
prepare_device "$serial_a" 9222
prepare_device "$serial_b" 9223

launch_device "$serial_a" "Phone A"
launch_device "$serial_b" "Phone B"

cat <<EOF

Both phones were opened in the same Verge room.

Phone A: $serial_a
Phone B: $serial_b
Room:    $room

On each phone:
  1. Tap Join room and allow camera/microphone access.
  2. Confirm both local and remote video render.
  3. Verify two-way speech audio.
  4. Send a chat message in each direction.
  5. Send a small file in each direction and verify completion.
  6. Switch camera once.
  7. Try Share screen only if Media capabilities says display capture is available.

ADB reverse carries the web app and signaling traffic only. WebRTC media still
uses normal ICE connectivity between the phones. Keep both phones on the same
LAN for the first smoke test unless TURN is configured.

Chrome DevTools targets:
  http://localhost:9222/json
  http://localhost:9223/json
EOF
