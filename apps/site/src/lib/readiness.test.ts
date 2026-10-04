import { describe, expect, it } from "vitest";
import { evaluateBrowserReadiness } from "./readiness";

const readySnapshot = {
  secureContext: true,
  webrtc: true,
  userMedia: true,
  codecPreferences: true,
  dataChannel: true,
  secureRandom: true,
  displayCapture: true
};

describe("evaluateBrowserReadiness", () => {
  it("treats screen sharing as optional", () => {
    const readiness = evaluateBrowserReadiness({
      ...readySnapshot,
      displayCapture: false
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingRequired).toEqual([]);
    expect(readiness.unavailableOptional.map((item) => item.id)).toEqual([
      "display-capture"
    ]);
  });

  it("fails readiness when a core conferencing capability is missing", () => {
    const readiness = evaluateBrowserReadiness({
      ...readySnapshot,
      dataChannel: false
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingRequired.map((item) => item.id)).toEqual([
      "data-channel"
    ]);
  });

  it("requires codec preference control used by the WebRTC adapter", () => {
    const readiness = evaluateBrowserReadiness({
      ...readySnapshot,
      codecPreferences: false
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingRequired.map((item) => item.id)).toEqual([
      "codec-preferences"
    ]);
  });

  it("reports all capabilities from one deterministic projection", () => {
    const readiness = evaluateBrowserReadiness(readySnapshot);

    expect(readiness.ready).toBe(true);
    expect(readiness.capabilities).toHaveLength(7);
    expect(readiness.capabilities.every((item) => item.supported)).toBe(true);
  });
});
