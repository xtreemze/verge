export interface PeerSummary {
  id: string;
  displayName: string;
}

export interface SessionDescription {
  type: "answer" | "offer" | "pranswer" | "rollback";
  sdp?: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
}

export type ClientMessage =
  | { type: "join"; roomId: string; displayName: string }
  | {
      type: "signal";
      to: string;
      description?: SessionDescription;
      candidate?: IceCandidate;
    }
  | { type: "leave" };

export type ServerMessage =
  | { type: "welcome"; selfId: string; peers: PeerSummary[] }
  | { type: "peer-joined"; peer: PeerSummary }
  | { type: "peer-left"; peerId: string }
  | {
      type: "signal";
      from: PeerSummary;
      description?: SessionDescription;
      candidate?: IceCandidate;
    }
  | { type: "error"; message: string };

export interface ChatMessage {
  id: string;
  text: string;
  sentAt: string;
}

export interface ReceivedFile {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  verified: boolean;
  blob: Blob;
}

export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PEER_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

const MAX_SDP_LENGTH = 220_000;
const MAX_CANDIDATE_LENGTH = 8_192;
const MAX_MID_LENGTH = 256;
const MAX_USERNAME_FRAGMENT_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNullableBoundedString(
  value: unknown,
  maxLength: number
): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function parseSessionDescription(
  value: unknown
): SessionDescription | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["type", "sdp"])) return undefined;

  const type = value.type;
  if (
    type !== "answer" &&
    type !== "offer" &&
    type !== "pranswer" &&
    type !== "rollback"
  ) {
    return undefined;
  }

  if (type === "rollback") {
    return value.sdp === undefined ? { type } : undefined;
  }

  if (typeof value.sdp !== "string" || value.sdp.length > MAX_SDP_LENGTH) {
    return undefined;
  }

  return { type, sdp: value.sdp };
}

function parseIceCandidate(value: unknown): IceCandidate | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "candidate",
      "sdpMid",
      "sdpMLineIndex",
      "usernameFragment"
    ])
  ) {
    return undefined;
  }

  if (
    typeof value.candidate !== "string" ||
    value.candidate.length > MAX_CANDIDATE_LENGTH ||
    !isNullableBoundedString(value.sdpMid, MAX_MID_LENGTH) ||
    !isNullableBoundedString(
      value.usernameFragment,
      MAX_USERNAME_FRAGMENT_LENGTH
    )
  ) {
    return undefined;
  }

  const index = value.sdpMLineIndex;
  if (
    index !== null &&
    (!Number.isInteger(index) || typeof index !== "number" || index < 0)
  ) {
    return undefined;
  }

  return {
    candidate: value.candidate,
    sdpMid: value.sdpMid,
    sdpMLineIndex: index,
    usernameFragment: value.usernameFragment
  };
}

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

export function isValidPeerId(peerId: string): boolean {
  return PEER_ID_PATTERN.test(peerId);
}

export function isValidDisplayName(displayName: string): boolean {
  const length = displayName.trim().length;
  return length >= 1 && length <= 80;
}

export function parseClientMessage(value: unknown): ClientMessage | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  switch (value.type) {
    case "join":
      if (
        !hasOnlyKeys(value, ["type", "roomId", "displayName"]) ||
        typeof value.roomId !== "string" ||
        typeof value.displayName !== "string" ||
        !isValidRoomId(value.roomId) ||
        !isValidDisplayName(value.displayName)
      ) {
        return undefined;
      }
      return {
        type: "join",
        roomId: value.roomId,
        displayName: value.displayName.trim()
      };

    case "leave":
      return hasOnlyKeys(value, ["type"]) ? { type: "leave" } : undefined;

    case "signal": {
      if (
        !hasOnlyKeys(value, ["type", "to", "description", "candidate"]) ||
        typeof value.to !== "string" ||
        !isValidPeerId(value.to)
      ) {
        return undefined;
      }

      const description =
        value.description === undefined
          ? undefined
          : parseSessionDescription(value.description);
      const candidate =
        value.candidate === undefined
          ? undefined
          : parseIceCandidate(value.candidate);

      if (
        (value.description !== undefined && !description) ||
        (value.candidate !== undefined && !candidate) ||
        (!description && !candidate)
      ) {
        return undefined;
      }

      return {
        type: "signal",
        to: value.to,
        ...(description ? { description } : {}),
        ...(candidate ? { candidate } : {})
      };
    }

    default:
      return undefined;
  }
}
