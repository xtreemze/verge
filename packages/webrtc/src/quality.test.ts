import { describe, expect, it } from "vitest";
import { classifyConnectionQuality, classifyIcePath } from "./quality";

describe("classifyConnectionQuality", () => {
  it("reports connection establishment as reconnecting", () => {
    expect(
      classifyConnectionQuality({ connectionState: "connecting" })
    ).toBe("reconnecting");
  });

  it("keeps healthy connected links good", () => {
    expect(
      classifyConnectionQuality({
        connectionState: "connected",
        rttMs: 72,
        packetLossPercent: 0.4,
        jitterMs: 8
      })
    ).toBe("good");
  });

  it("marks moderate transport pressure as constrained", () => {
    expect(
      classifyConnectionQuality({
        connectionState: "connected",
        rttMs: 380,
        packetLossPercent: 1,
        jitterMs: 12
      })
    ).toBe("constrained");

    expect(
      classifyConnectionQuality({
        connectionState: "connected",
        qualityLimitationReason: "bandwidth"
      })
    ).toBe("constrained");
  });

  it("treats CPU quality limitation as constrained", () => {
    expect(
      classifyConnectionQuality({
        connectionState: "connected",
        qualityLimitationReason: "cpu"
      })
    ).toBe("constrained");
  });

  it("marks severe loss or failed connectivity as poor", () => {
    expect(
      classifyConnectionQuality({
        connectionState: "connected",
        packetLossPercent: 9
      })
    ).toBe("poor");

    expect(
      classifyConnectionQuality({ connectionState: "failed" })
    ).toBe("poor");
  });
});


describe("classifyIcePath", () => {
  it("identifies direct and TURN-relayed candidate pairs", () => {
    expect(classifyIcePath("host", "srflx")).toBe("direct");
    expect(classifyIcePath("relay", "host")).toBe("relay");
    expect(classifyIcePath("host", "relay")).toBe("relay");
  });

  it("reports unknown when candidate metadata is incomplete", () => {
    expect(classifyIcePath(undefined, "host")).toBe("unknown");
  });
});
