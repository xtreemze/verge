import type {
  ChatMessage,
  PeerSummary,
  ReceivedFile
} from "@verge/protocol";

export type ConferenceTopology = "mesh" | "sfu";

export interface ConferenceTransportCapabilities {
  topology: ConferenceTopology;
  directPeerMedia: boolean;
  selectiveSubscription: boolean;
  simulcast: boolean;
  svc: boolean;
  dataChannels: boolean;
}

export interface ConferenceTransportEvents {
  onReady?(selfId: string): void;
  onPeerStream(peer: PeerSummary, stream: MediaStream): void;
  onPeerLeft?(peerId: string): void;
  onChatMessage(peer: PeerSummary, message: ChatMessage): void;
  onFile(peer: PeerSummary, file: ReceivedFile): void;
  onError?(message: string): void;
}

export interface ConferenceTransportBaseOptions
  extends ConferenceTransportEvents {
  roomId: string;
  displayName: string;
  localStream: MediaStream;
}

export interface ConferenceTransport {
  readonly topology: ConferenceTopology;
  readonly capabilities: ConferenceTransportCapabilities;

  start(): Promise<void>;
  sendChat(text: string): ChatMessage;
  sendFile(file: File): Promise<void>;
  replaceVideoTrack(track: MediaStreamTrack): Promise<void>;
  close(): void;
}
