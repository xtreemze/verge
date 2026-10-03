import { describe, expect, it } from "vitest";
import {
  ICE_RESTART_MAX_ATTEMPTS,
  iceRestartDelay
} from "./recovery-policy";

describe("iceRestartDelay", () => {
  it("waits before restarting a transiently disconnected peer", () => {
    expect(iceRestartDelay("disconnected", 0)).toBe(4_000);
  });

  it("restarts failed ICE immediately on the first attempt", () => {
    expect(iceRestartDelay("failed", 0)).toBe(0);
  });

  it("backs off repeated restart attempts", () => {
    expect(iceRestartDelay("failed", 1)).toBe(1_500);
    expect(iceRestartDelay("failed", 2)).toBe(5_000);
  });

  it("caps the restart budget", () => {
    expect(iceRestartDelay("failed", ICE_RESTART_MAX_ATTEMPTS)).toBeNull();
    expect(
      iceRestartDelay("disconnected", ICE_RESTART_MAX_ATTEMPTS)
    ).toBeNull();
  });

  it("does not restart healthy or terminal states", () => {
    expect(iceRestartDelay("connected", 0)).toBeNull();
    expect(iceRestartDelay("connecting", 0)).toBeNull();
    expect(iceRestartDelay("closed", 0)).toBeNull();
  });
});
