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

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

export function isValidDisplayName(displayName: string): boolean {
  const length = displayName.trim().length;
  return length >= 1 && length <= 80;
}
