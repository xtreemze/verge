import { describe, expect, it } from "vitest";
import {
  ICE_RESTART_MAX_ATTEMPTS,
  iceRestartDelay
} from "./recovery-policy";

describe("iceRestartDelay", () => {
  it("waits before restarting a transient disconnect", () => {
    expect(iceRestartDelay("disconnected", 0)).toBe(4_000);
  });

  it("restarts the first hard ICE failure immediately", () => {
    expect(iceRestartDelay("failed", 0)).toBe(0);
  });

  it("backs off repeated restart attempts", () => {
    expect(iceRestartDelay("failed", 1)).toBe(1_500);
    expect(iceRestartDelay("failed", 2)).toBe(5_000);
  });

  it("caps the recovery budget", () => {
    expect(
      iceRestartDelay("failed", ICE_RESTART_MAX_ATTEMPTS)
    ).toBeNull();
    expect(
      iceRestartDelay(
        "disconnected",
        ICE_RESTART_MAX_ATTEMPTS
      )
    ).toBeNull();
  });

  it("does not restart healthy or terminal states", () => {
    expect(iceRestartDelay("connected", 0)).toBeNull();
    expect(iceRestartDelay("connecting", 0)).toBeNull();
    expect(iceRestartDelay("closed", 0)).toBeNull();
  });
});
