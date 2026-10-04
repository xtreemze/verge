const SIGNALING_RECONNECT_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  10_000
] as const;

export function signalingReconnectDelay(attempt: number): number {
  const index = Math.min(
    Math.max(0, Math.trunc(attempt)),
    SIGNALING_RECONNECT_DELAYS_MS.length - 1
  );
  return SIGNALING_RECONNECT_DELAYS_MS[index]!;
}
