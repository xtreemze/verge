import { describe, expect, it } from "vitest";
import { consumeFixedWindow } from "./rate-limit";

describe("consumeFixedWindow", () => {
  it("allows messages up to the configured budget", () => {
    const state = { windowStartedAt: 1_000, messagesInWindow: 0 };

    expect(consumeFixedWindow(state, 1_001, 10_000, 2)).toBe(true);
    expect(consumeFixedWindow(state, 1_002, 10_000, 2)).toBe(true);
    expect(consumeFixedWindow(state, 1_003, 10_000, 2)).toBe(false);
  });

  it("resets the budget at the next fixed window", () => {
    const state = { windowStartedAt: 1_000, messagesInWindow: 2 };

    expect(consumeFixedWindow(state, 11_000, 10_000, 2)).toBe(true);
    expect(state).toEqual({
      windowStartedAt: 11_000,
      messagesInWindow: 1
    });
  });
});
