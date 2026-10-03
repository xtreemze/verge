export type ConnectionQualityLevel =
  | "good"
  | "constrained"
  | "poor"
  | "reconnecting";

export type IcePath = "direct" | "relay" | "unknown";

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
  icePath: IcePath;
  localCandidateType?: RTCIceCandidateType;
  remoteCandidateType?: RTCIceCandidateType;
  sampledAt: number;
}

const ICE_CANDIDATE_TYPES = new Set<RTCIceCandidateType>([
  "host",
  "srflx",
  "prflx",
  "relay"
]);

function candidateType(
  value: unknown
): RTCIceCandidateType | undefined {
  return typeof value === "string" &&
    ICE_CANDIDATE_TYPES.has(value as RTCIceCandidateType)
    ? (value as RTCIceCandidateType)
    : undefined;
}

export function classifyIcePath(
  local: RTCIceCandidateType | undefined,
  remote: RTCIceCandidateType | undefined
): IcePath {
  if (!local || !remote) return "unknown";
  return local === "relay" || remote === "relay"
    ? "relay"
    : "direct";
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

  if (
    input.connectionState === "failed" ||
    input.connectionState === "closed"
  ) {
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

  let selectedCandidatePairId: string | undefined;
  report.forEach((entry) => {
    const stat = entry as unknown as Record<string, unknown>;
    if (
      stat.type === "transport" &&
      typeof stat.selectedCandidatePairId === "string"
    ) {
      selectedCandidatePairId = stat.selectedCandidatePairId;
    }
  });

  let selectedLocalCandidateId: string | undefined;
  let selectedRemoteCandidateId: string | undefined;
  let rttMs: number | undefined;
  let availableOutgoingBitrate: number | undefined;
  let packetsLost = 0;
  let packetsReceived = 0;
  let jitterMs: number | undefined;
  let qualityLimitationReason: string | undefined;

  report.forEach((entry) => {
    const stat = entry as unknown as Record<string, unknown>;
    const type = stat.type;

    if (type === "candidate-pair") {
      const isSelected =
        selectedCandidatePairId !== undefined
          ? stat.id === selectedCandidatePairId
          : stat.state === "succeeded" &&
            (stat.nominated === true || stat.selected === true);

      if (isSelected) {
        selectedLocalCandidateId =
          typeof stat.localCandidateId === "string"
            ? stat.localCandidateId
            : selectedLocalCandidateId;
        selectedRemoteCandidateId =
          typeof stat.remoteCandidateId === "string"
            ? stat.remoteCandidateId
            : selectedRemoteCandidateId;
        rttMs =
          optionalNumber(stat.currentRoundTripTime, 1_000) ??
          rttMs;
        availableOutgoingBitrate =
          optionalNumber(stat.availableOutgoingBitrate) ??
          availableOutgoingBitrate;
      }
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

  let localCandidateType: RTCIceCandidateType | undefined;
  let remoteCandidateType: RTCIceCandidateType | undefined;

  report.forEach((entry) => {
    const stat = entry as unknown as Record<string, unknown>;
    if (
      selectedLocalCandidateId !== undefined &&
      stat.id === selectedLocalCandidateId &&
      stat.type === "local-candidate"
    ) {
      localCandidateType = candidateType(stat.candidateType);
    }
    if (
      selectedRemoteCandidateId !== undefined &&
      stat.id === selectedRemoteCandidateId &&
      stat.type === "remote-candidate"
    ) {
      remoteCandidateType = candidateType(stat.candidateType);
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
    icePath: classifyIcePath(
      localCandidateType,
      remoteCandidateType
    ),
    ...(localCandidateType === undefined
      ? {}
      : { localCandidateType }),
    ...(remoteCandidateType === undefined
      ? {}
      : { remoteCandidateType }),
    sampledAt: Date.now()
  };
}
