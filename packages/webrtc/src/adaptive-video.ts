import type { ConnectionQualityLevel } from "./quality";

export type VideoAdaptationTier = "high" | "medium" | "low";

export type VideoPublicationKind =
  | "camera"
  | "screen-detail"
  | "screen-motion";

export interface VideoEncodingTarget {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
}

const TARGETS: Record<
  VideoPublicationKind,
  Record<VideoAdaptationTier, VideoEncodingTarget>
> = {
  camera: {
    high: {
      maxBitrate: 2_500_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1
    },
    medium: {
      maxBitrate: 1_200_000,
      maxFramerate: 24,
      scaleResolutionDownBy: 1.5
    },
    low: {
      maxBitrate: 500_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 2.5
    }
  },
  "screen-detail": {
    high: {
      maxBitrate: 5_000_000,
      maxFramerate: 15,
      scaleResolutionDownBy: 1
    },
    medium: {
      maxBitrate: 2_500_000,
      maxFramerate: 12,
      scaleResolutionDownBy: 1.25
    },
    low: {
      maxBitrate: 900_000,
      maxFramerate: 8,
      scaleResolutionDownBy: 1.75
    }
  },
  "screen-motion": {
    high: {
      maxBitrate: 6_000_000,
      maxFramerate: 60,
      scaleResolutionDownBy: 1
    },
    medium: {
      maxBitrate: 3_000_000,
      maxFramerate: 30,
      scaleResolutionDownBy: 1.25
    },
    low: {
      maxBitrate: 1_200_000,
      maxFramerate: 20,
      scaleResolutionDownBy: 1.5
    }
  }
};

const TIER_RANK: Record<VideoAdaptationTier, number> = {
  high: 0,
  medium: 1,
  low: 2
};

function desiredTier(
  level: ConnectionQualityLevel
): VideoAdaptationTier {
  switch (level) {
    case "good":
      return "high";
    case "constrained":
      return "medium";
    case "poor":
    case "reconnecting":
      return "low";
  }
}

export class AdaptiveVideoPolicy {
  #tier: VideoAdaptationTier = "high";
  #pendingTier: VideoAdaptationTier | undefined;
  #pendingSamples = 0;
  #lastChangeAt = Number.NEGATIVE_INFINITY;

  get tier(): VideoAdaptationTier {
    return this.#tier;
  }

  observe(
    level: ConnectionQualityLevel,
    now = Date.now()
  ): VideoAdaptationTier | undefined {
    let candidate = desiredTier(level);

    if (
      TIER_RANK[candidate] < TIER_RANK[this.#tier] &&
      TIER_RANK[this.#tier] - TIER_RANK[candidate] > 1
    ) {
      candidate = "medium";
    }

    if (candidate === this.#tier) {
      this.#pendingTier = undefined;
      this.#pendingSamples = 0;
      return undefined;
    }

    if (candidate !== this.#pendingTier) {
      this.#pendingTier = candidate;
      this.#pendingSamples = 1;
    } else {
      this.#pendingSamples += 1;
    }

    const worsening =
      TIER_RANK[candidate] > TIER_RANK[this.#tier];
    const requiredSamples = worsening
      ? candidate === "low"
        ? 1
        : 2
      : 4;
    const cooldownMs = worsening ? 3_000 : 12_000;

    if (
      this.#pendingSamples < requiredSamples ||
      now - this.#lastChangeAt < cooldownMs
    ) {
      return undefined;
    }

    this.#tier = candidate;
    this.#pendingTier = undefined;
    this.#pendingSamples = 0;
    this.#lastChangeAt = now;
    return this.#tier;
  }
}

export function videoPublicationKind(
  track: MediaStreamTrack
): VideoPublicationKind {
  const settings = track.getSettings() as MediaTrackSettings & {
    displaySurface?: string;
  };

  if (typeof settings.displaySurface !== "string") {
    return "camera";
  }

  return track.contentHint === "detail"
    ? "screen-detail"
    : "screen-motion";
}

export function videoEncodingTarget(
  kind: VideoPublicationKind,
  tier: VideoAdaptationTier
): VideoEncodingTarget {
  return TARGETS[kind][tier];
}

export async function applyVideoAdaptation(
  sender: RTCRtpSender,
  tier: VideoAdaptationTier
): Promise<boolean> {
  const track = sender.track;
  if (!track || track.kind !== "video") return false;

  const parameters = sender.getParameters();
  const encoding = parameters.encodings[0];
  if (!encoding) return false;

  const target = videoEncodingTarget(
    videoPublicationKind(track),
    tier
  );

  encoding.maxBitrate = target.maxBitrate;
  encoding.maxFramerate = target.maxFramerate;
  encoding.scaleResolutionDownBy =
    target.scaleResolutionDownBy;

  await sender.setParameters(parameters);
  return true;
}
