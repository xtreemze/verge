export const ICE_RESTART_MAX_ATTEMPTS = 3;

const FAILED_BACKOFF_MS = [0, 1_500, 5_000] as const;
const DISCONNECTED_BACKOFF_MS = [4_000, 6_500, 10_000] as const;

export function iceRestartDelay(
  state: RTCPeerConnectionState,
  attempt: number
): number | null {
  if (
    attempt < 0 ||
    attempt >= ICE_RESTART_MAX_ATTEMPTS
  ) {
    return null;
  }

  if (state === "failed") {
    return FAILED_BACKOFF_MS[attempt] ?? null;
  }

  if (state === "disconnected") {
    return DISCONNECTED_BACKOFF_MS[attempt] ?? null;
  }

  return null;
}
