import { describe, expect, it } from "vitest";
import { signalingReconnectDelay } from "./reconnect-policy";

describe("signalingReconnectDelay", () => {
  it("backs off quickly and caps retries", () => {
    expect([
      signalingReconnectDelay(0),
      signalingReconnectDelay(1),
      signalingReconnectDelay(2),
      signalingReconnectDelay(3),
      signalingReconnectDelay(4),
      signalingReconnectDelay(20)
    ]).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000]);
  });
});
