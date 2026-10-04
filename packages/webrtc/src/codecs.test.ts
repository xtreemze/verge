import { describe, expect, it } from "vitest";
import {
  orderCodecCapabilities,
  type CodecCapability
} from "./codecs";

function codec(mimeType: string): CodecCapability {
  return {
    mimeType,
    clockRate: 90_000
  };
}

describe("orderCodecCapabilities", () => {
  it("orders primary codecs by preference while preserving repair codecs", () => {
    const ordered = orderCodecCapabilities(
      [
        codec("video/VP8"),
        codec("video/rtx"),
        codec("video/H264"),
        codec("video/red"),
        codec("video/AV1"),
        codec("video/ulpfec")
      ],
      ["video/AV1", "video/H264", "video/VP8"]
    );

    expect(ordered.map((item) => item.mimeType)).toEqual([
      "video/AV1",
      "video/H264",
      "video/VP8",
      "video/rtx",
      "video/red",
      "video/ulpfec"
    ]);
  });

  it("leaves unranked primary codecs available after preferred codecs", () => {
    const ordered = orderCodecCapabilities(
      [
        codec("video/VP8"),
        codec("video/H264"),
        codec("video/example")
      ],
      ["video/H264"]
    );

    expect(ordered.map((item) => item.mimeType)).toEqual([
      "video/H264",
      "video/VP8",
      "video/example"
    ]);
  });
});
