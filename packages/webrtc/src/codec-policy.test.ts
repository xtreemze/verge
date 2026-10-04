import { describe, expect, it } from "vitest";
import {
  PREFERRED_AUDIO_MIME_TYPES,
  PREFERRED_VIDEO_MIME_TYPES,
  codecDisplayName
} from "./codec-policy";

describe("codec policy", () => {
  it("keeps the intended video preference order", () => {
    expect(PREFERRED_VIDEO_MIME_TYPES).toEqual([
      "video/AV1",
      "video/VP9",
      "video/H265",
      "video/H264",
      "video/VP8"
    ]);
  });

  it("prefers Opus for audio", () => {
    expect(PREFERRED_AUDIO_MIME_TYPES).toEqual([
      "audio/opus"
    ]);
  });

  it("uses presentation labels without changing MIME identity", () => {
    expect(codecDisplayName("video/H265")).toBe("HEVC");
    expect(codecDisplayName("video/H264")).toBe("H.264");
    expect(codecDisplayName("audio/opus")).toBe("Opus");
    expect(codecDisplayName("video/custom")).toBe("video/custom");
  });
});
