export type AudioMode = "speech" | "original";
export type ScreenShareMode = "detail" | "motion";

export interface LocalMediaOptions {
  audioMode?: AudioMode;
  width?: number;
  height?: number;
  frameRate?: number;
}

function speechAudioConstraints(): MediaTrackConstraints {
  return {
    channelCount: { ideal: 1 },
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
}

function originalAudioConstraints(): MediaTrackConstraints {
  return {
    channelCount: { ideal: 2 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  };
}

export async function acquireLocalMedia(
  options: LocalMediaOptions = {}
): Promise<MediaStream> {
  const {
    audioMode = "speech",
    width = 1280,
    height = 720,
    frameRate = 30
  } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio:
      audioMode === "speech"
        ? speechAudioConstraints()
        : originalAudioConstraints(),
    video: {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate, max: 60 },
      facingMode: "user"
    }
  });

  for (const track of stream.getVideoTracks()) {
    track.contentHint = "motion";
  }

  for (const track of stream.getAudioTracks()) {
    track.contentHint = audioMode === "speech" ? "speech" : "music";
  }

  return stream;
}

export interface DisplayMediaOptions {
  mode?: ScreenShareMode;
}

export async function acquireDisplayMedia(
  options: DisplayMediaOptions = {}
): Promise<MediaStream> {
  const { mode = "detail" } = options;
  const frameRate =
    mode === "motion"
      ? { ideal: 30, max: 60 }
      : { ideal: 10, max: 15 };

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate },
    audio: true
  });

  for (const track of stream.getVideoTracks()) {
    track.contentHint = mode;
  }

  return stream;
}

type BackgroundBlurCapabilities = MediaTrackCapabilities & {
  backgroundBlur?: boolean | boolean[];
};

type BackgroundBlurConstraintSet = MediaTrackConstraintSet & {
  backgroundBlur?: boolean;
};

export function supportsNativeBackgroundBlur(
  track: MediaStreamTrack
): boolean {
  if (track.kind !== "video") return false;
  const capabilities = track.getCapabilities() as BackgroundBlurCapabilities;
  return "backgroundBlur" in capabilities;
}

export async function setNativeBackgroundBlur(
  track: MediaStreamTrack,
  enabled: boolean
): Promise<boolean> {
  if (!supportsNativeBackgroundBlur(track)) return false;

  await track.applyConstraints({
    advanced: [
      { backgroundBlur: enabled } as BackgroundBlurConstraintSet
    ]
  });
  return true;
}

export function setTrackEnabled(
  stream: MediaStream,
  kind: "audio" | "video",
  enabled: boolean
): void {
  for (const track of stream.getTracks()) {
    if (track.kind === kind) track.enabled = enabled;
  }
}

export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
