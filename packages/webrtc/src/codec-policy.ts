export const PREFERRED_VIDEO_MIME_TYPES = [
  "video/AV1",
  "video/VP9",
  "video/H265",
  "video/H264",
  "video/VP8"
] as const;

export const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/opus"
] as const;

export function codecDisplayName(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "video/av1":
      return "AV1";
    case "video/vp9":
      return "VP9";
    case "video/h265":
      return "HEVC";
    case "video/h264":
      return "H.264";
    case "video/vp8":
      return "VP8";
    case "audio/opus":
      return "Opus";
    default:
      return mimeType;
  }
}
