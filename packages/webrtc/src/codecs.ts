import {
  PREFERRED_AUDIO_MIME_TYPES,
  PREFERRED_VIDEO_MIME_TYPES
} from "./codec-policy";

type CodecCapability = NonNullable<
  ReturnType<typeof RTCRtpSender.getCapabilities>
>["codecs"][number];

function rank(mimeType: string, preferred: readonly string[]): number {
  const index = preferred.findIndex(
    (candidate) => candidate.toLowerCase() === mimeType.toLowerCase()
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function getSupportedVideoCodecs(): CodecCapability[] {
  return RTCRtpSender.getCapabilities("video")?.codecs ?? [];
}

export function getSupportedAudioCodecs(): CodecCapability[] {
  return RTCRtpSender.getCapabilities("audio")?.codecs ?? [];
}

export function getPreferredVideoCodecs(): CodecCapability[] {
  const codecs = getSupportedVideoCodecs();
  const primary = codecs
    .filter((codec) => !/\/(rtx|red|ulpfec)$/i.test(codec.mimeType))
    .toSorted(
      (left, right) =>
        rank(left.mimeType, PREFERRED_VIDEO_MIME_TYPES) -
        rank(right.mimeType, PREFERRED_VIDEO_MIME_TYPES)
    );
  const repair = codecs.filter((codec) =>
    /\/(rtx|red|ulpfec)$/i.test(codec.mimeType)
  );
  return [...primary, ...repair];
}

export function getPreferredAudioCodecs(): CodecCapability[] {
  return getSupportedAudioCodecs().toSorted(
    (left, right) =>
      rank(left.mimeType, PREFERRED_AUDIO_MIME_TYPES) -
      rank(right.mimeType, PREFERRED_AUDIO_MIME_TYPES)
  );
}

export function applyCodecPreferences(
  peerConnection: RTCPeerConnection
): void {
  const video = getPreferredVideoCodecs();
  const audio = getPreferredAudioCodecs();

  for (const transceiver of peerConnection.getTransceivers()) {
    const kind =
      transceiver.sender.track?.kind ?? transceiver.receiver.track.kind;
    if (kind === "video" && video.length > 0) {
      transceiver.setCodecPreferences(video);
    } else if (kind === "audio" && audio.length > 0) {
      transceiver.setCodecPreferences(audio);
    }
  }
}

export function supportedVideoMimeTypes(): string[] {
  return Array.from(
    new Set(getSupportedVideoCodecs().map((codec) => codec.mimeType))
  );
}
