export type ConnectionQualityLevel =
  | "good"
  | "constrained"
  | "poor"
  | "reconnecting";

export interface ConnectionQualityInput {
  connectionState: RTCPeerConnectionState;
  rttMs?: number;
  packetLossPercent?: number;
  jitterMs?: number;
  qualityLimitationReason?: string;
}

export interface ConnectionQualitySnapshot extends ConnectionQualityInput {
  level: ConnectionQualityLevel;
  availableOutgoingBitrate?: number;
  sampledAt: number;
}

function optionalNumber(
  value: unknown,
  scale = 1
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value * scale
    : undefined;
}

export function classifyConnectionQuality(
  input: ConnectionQualityInput
): ConnectionQualityLevel {
  if (
    input.connectionState === "new" ||
    input.connectionState === "connecting" ||
    input.connectionState === "disconnected"
  ) {
    return "reconnecting";
  }

  if (input.connectionState === "failed" || input.connectionState === "closed") {
    return "poor";
  }

  if (
    (input.rttMs ?? 0) >= 1_000 ||
    (input.packetLossPercent ?? 0) >= 8 ||
    (input.jitterMs ?? 0) >= 80
  ) {
    return "poor";
  }

  if (
    (input.rttMs ?? 0) >= 350 ||
    (input.packetLossPercent ?? 0) >= 2 ||
    (input.jitterMs ?? 0) >= 30 ||
    input.qualityLimitationReason === "bandwidth" ||
    input.qualityLimitationReason === "cpu"
  ) {
    return "constrained";
  }

  return "good";
}

export async function sampleConnectionQuality(
  connection: RTCPeerConnection
): Promise<ConnectionQualitySnapshot> {
  const report = await connection.getStats();

  let rttMs: number | undefined;
  let availableOutgoingBitrate: number | undefined;
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitterMs: number | undefined;
  let qualityLimitationReason: string | undefined;

  report.forEach((entry) => {
    const stat = entry as unknown as Record<string, unknown>;
    const type = stat.type;

    if (
      type === "candidate-pair" &&
      stat.state === "succeeded" &&
      (stat.nominated === true || stat.selected === true)
    ) {
      rttMs =
        optionalNumber(stat.currentRoundTripTime, 1_000) ??
        rttMs;
      availableOutgoingBitrate =
        optionalNumber(stat.availableOutgoingBitrate) ??
        availableOutgoingBitrate;
    }

    if (type === "inbound-rtp" && stat.isRemote !== true) {
      packetsLost += optionalNumber(stat.packetsLost) ?? 0;
      packetsReceived += optionalNumber(stat.packetsReceived) ?? 0;
      jitterMs = Math.max(
        jitterMs ?? 0,
        optionalNumber(stat.jitter, 1_000) ?? 0
      );
    }

    if (
      type === "outbound-rtp" &&
      typeof stat.qualityLimitationReason === "string" &&
      stat.qualityLimitationReason !== "none"
    ) {
      qualityLimitationReason = stat.qualityLimitationReason;
    }
  });

  const totalPackets = packetsReceived + Math.max(0, packetsLost);
  const packetLossPercent =
    totalPackets > 0
      ? (Math.max(0, packetsLost) / totalPackets) * 100
      : undefined;

  const input: ConnectionQualityInput = {
    connectionState: connection.connectionState,
    ...(rttMs === undefined ? {} : { rttMs }),
    ...(packetLossPercent === undefined ? {} : { packetLossPercent }),
    ...(jitterMs === undefined ? {} : { jitterMs }),
    ...(qualityLimitationReason === undefined
      ? {}
      : { qualityLimitationReason })
  };

  return {
    ...input,
    level: classifyConnectionQuality(input),
    ...(availableOutgoingBitrate === undefined
      ? {}
      : { availableOutgoingBitrate }),
    sampledAt: Date.now()
  };
}
