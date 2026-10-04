import {
  PREFERRED_AUDIO_MIME_TYPES,
  PREFERRED_VIDEO_MIME_TYPES
} from "./codec-policy";

export type CodecCapability = NonNullable<
  ReturnType<typeof RTCRtpReceiver.getCapabilities>
>["codecs"][number];

function rank(mimeType: string, preferred: readonly string[]): number {
  const index = preferred.findIndex(
    (candidate) => candidate.toLowerCase() === mimeType.toLowerCase()
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isRepairCodec(codec: CodecCapability): boolean {
  return /\/(rtx|red|ulpfec|flexfec-03)$/i.test(codec.mimeType);
}

export function orderCodecCapabilities(
  codecs: readonly CodecCapability[],
  preferred: readonly string[]
): CodecCapability[] {
  const primary = codecs
    .filter((codec) => !isRepairCodec(codec))
    .toSorted(
      (left, right) =>
        rank(left.mimeType, preferred) - rank(right.mimeType, preferred)
    );
  const repair = codecs.filter(isRepairCodec);
  return [...primary, ...repair];
}

export function getSupportedVideoReceiveCodecs(): CodecCapability[] {
  return RTCRtpReceiver.getCapabilities("video")?.codecs ?? [];
}

export function getSupportedAudioReceiveCodecs(): CodecCapability[] {
  return RTCRtpReceiver.getCapabilities("audio")?.codecs ?? [];
}

export function getSupportedVideoSendCodecs(): CodecCapability[] {
  return RTCRtpSender.getCapabilities("video")?.codecs ?? [];
}

export function getSupportedAudioSendCodecs(): CodecCapability[] {
  return RTCRtpSender.getCapabilities("audio")?.codecs ?? [];
}

// Backwards-compatible aliases. Codec preferences are receive preferences.
export function getSupportedVideoCodecs(): CodecCapability[] {
  return getSupportedVideoReceiveCodecs();
}

export function getSupportedAudioCodecs(): CodecCapability[] {
  return getSupportedAudioReceiveCodecs();
}

export function getPreferredVideoCodecs(): CodecCapability[] {
  return orderCodecCapabilities(
    getSupportedVideoReceiveCodecs(),
    PREFERRED_VIDEO_MIME_TYPES
  );
}

export function getPreferredAudioCodecs(): CodecCapability[] {
  return orderCodecCapabilities(
    getSupportedAudioReceiveCodecs(),
    PREFERRED_AUDIO_MIME_TYPES
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

function primaryMimeTypes(codecs: readonly CodecCapability[]): Set<string> {
  return new Set(
    codecs
      .filter((codec) => !isRepairCodec(codec))
      .map((codec) => codec.mimeType.toLowerCase())
  );
}

export function supportedVideoMimeTypes(): string[] {
  const send = primaryMimeTypes(getSupportedVideoSendCodecs());
  const receive = getSupportedVideoReceiveCodecs().filter(
    (codec) =>
      !isRepairCodec(codec) &&
      send.has(codec.mimeType.toLowerCase())
  );

  return Array.from(new Set(receive.map((codec) => codec.mimeType)));
}
