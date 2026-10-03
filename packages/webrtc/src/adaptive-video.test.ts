import { describe, expect, it } from "vitest";
import {
  AdaptiveVideoPolicy,
  videoEncodingTarget
} from "./adaptive-video";

describe("AdaptiveVideoPolicy", () => {
  it("downshifts immediately on poor quality", () => {
    const policy = new AdaptiveVideoPolicy();

    expect(policy.observe("poor", 0)).toBe("low");
    expect(policy.tier).toBe("low");
  });

  it("requires sustained constrained quality before downshifting", () => {
    const policy = new AdaptiveVideoPolicy();

    expect(policy.observe("constrained", 0)).toBeUndefined();
    expect(policy.observe("constrained", 3_000)).toBe("medium");
  });

  it("requires sustained recovery and steps upward", () => {
    const policy = new AdaptiveVideoPolicy();
    expect(policy.observe("poor", 0)).toBe("low");

    expect(policy.observe("good", 3_000)).toBeUndefined();
    expect(policy.observe("good", 6_000)).toBeUndefined();
    expect(policy.observe("good", 9_000)).toBeUndefined();
    expect(policy.observe("good", 12_000)).toBe("medium");
    expect(policy.tier).toBe("medium");

    expect(policy.observe("good", 15_000)).toBeUndefined();
    expect(policy.observe("good", 18_000)).toBeUndefined();
    expect(policy.observe("good", 21_000)).toBeUndefined();
    expect(policy.observe("good", 24_000)).toBe("high");
  });

  it("uses distinct camera and screen targets", () => {
    expect(videoEncodingTarget("camera", "low")).toEqual({
      maxBitrate: 500_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 2.5
    });

    expect(
      videoEncodingTarget("screen-detail", "low").maxFramerate
    ).toBeLessThan(
      videoEncodingTarget("screen-motion", "low").maxFramerate
    );
  });
});
