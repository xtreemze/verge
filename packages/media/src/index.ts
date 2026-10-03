export type AudioMode = "speech" | "original";

export interface LocalMediaOptions {
  audioMode?: AudioMode;
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface MediaDeviceGroups {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export interface CameraTrackOptions {
  deviceId?: string;
  width?: number;
  height?: number;
  frameRate?: number;
}

export interface MicrophoneTrackOptions {
  deviceId?: string;
  audioMode?: AudioMode;
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

function audioConstraints(
  audioMode: AudioMode,
  deviceId?: string
): MediaTrackConstraints {
  return {
    ...(audioMode === "speech"
      ? speechAudioConstraints()
      : originalAudioConstraints()),
    ...(deviceId ? { deviceId: { exact: deviceId } } : {})
  };
}

export async function enumerateMediaDevices(): Promise<MediaDeviceGroups> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((device) => device.kind === "videoinput"),
    microphones: devices.filter((device) => device.kind === "audioinput"),
    speakers: devices.filter((device) => device.kind === "audiooutput")
  };
}

interface SinkSelectableMediaElement extends HTMLMediaElement {
  setSinkId(deviceId: string): Promise<void>;
}

export function supportsAudioOutputSelection(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

export async function setAudioOutputDevice(
  element: HTMLMediaElement,
  deviceId: string
): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false;
  await (element as SinkSelectableMediaElement).setSinkId(deviceId);
  return true;
}

export async function acquireCameraTrack(
  options: CameraTrackOptions = {}
): Promise<MediaStreamTrack> {
  const {
    deviceId,
    width = 1280,
    height = 720,
    frameRate = 30
  } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate, max: 60 }
    }
  });

  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new Error("Selected camera did not provide a video track.");
  }
  track.contentHint = "motion";
  return track;
}

export async function acquireMicrophoneTrack(
  options: MicrophoneTrackOptions = {}
): Promise<MediaStreamTrack> {
  const { deviceId, audioMode = "speech" } = options;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioConstraints(audioMode, deviceId),
    video: false
  });

  const track = stream.getAudioTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new Error("Selected microphone did not provide an audio track.");
  }
  track.contentHint = audioMode === "speech" ? "speech" : "music";
  return track;
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
    audio: audioConstraints(audioMode),
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

export async function acquireDisplayMedia(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: 30, max: 60 }
    },
    audio: true
  });

  for (const track of stream.getVideoTracks()) {
    track.contentHint = "detail";
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
