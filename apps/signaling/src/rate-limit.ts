export interface FixedWindowState {
  windowStartedAt: number;
  messagesInWindow: number;
}

export function consumeFixedWindow(
  state: FixedWindowState,
  now: number,
  windowMs: number,
  maxMessages: number
): boolean {
  if (now - state.windowStartedAt >= windowMs) {
    state.windowStartedAt = now;
    state.messagesInWindow = 0;
  }

  state.messagesInWindow += 1;
  return state.messagesInWindow <= maxMessages;
}
