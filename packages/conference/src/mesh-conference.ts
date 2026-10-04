import type {
  ChatMessage,
  IceCandidate,
  PeerSummary,
  ReceivedFile,
  ServerMessage,
  SessionDescription
} from "@verge/protocol";
import { PeerSession } from "@verge/webrtc";
import { SignalingClient } from "./signaling";
import type {
  ConferenceTransport,
  ConferenceTransportBaseOptions,
  ConferenceTransportCapabilities,
  ConferenceTransportEvents
} from "./transport";

export type MeshConferenceEvents = ConferenceTransportEvents;

export interface MeshConferenceOptions
  extends ConferenceTransportBaseOptions {
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
}

export const MESH_CONFERENCE_CAPABILITIES: ConferenceTransportCapabilities = {
  topology: "mesh",
  directPeerMedia: true,
  selectiveSubscription: false,
  simulcast: false,
  svc: false,
  dataChannels: true
};

export class MeshConference implements ConferenceTransport {
  readonly topology = "mesh" as const;
  readonly capabilities = MESH_CONFERENCE_CAPABILITIES;

  #signaling: SignalingClient;
  #sessions = new Map<string, PeerSession>();
  #options: MeshConferenceOptions;
  #iceServers: RTCIceServer[];

  constructor(options: MeshConferenceOptions) {
    this.#options = options;
    this.#iceServers =
      options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }];
    this.#signaling = new SignalingClient(
      options.signalingUrl,
      (message) => void this.#handleMessage(message),
      {
        onDisconnected: () => {
          this.#resetSessions();
          this.#options.onStatus?.("Signaling interrupted · reconnecting…");
        },
        onReconnected: () => {
          this.#options.onStatus?.("Signaling restored · rejoining room…");
        }
      }
    );
  }

  async start(): Promise<void> {
    await this.#signaling.connect(
      this.#options.roomId,
      this.#options.displayName
    );
  }

  sendChat(text: string): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      text,
      sentAt: new Date().toISOString()
    };
    for (const session of this.#sessions.values()) session.sendChat(message);
    return message;
  }

  async sendFile(
    file: File,
    transferId = crypto.randomUUID()
  ): Promise<void> {
    await Promise.all(
      Array.from(this.#sessions.values(), (session) =>
        session.sendFile(file, transferId)
      )
    );
  }

  cancelFileTransfer(transferId: string): void {
    for (const session of this.#sessions.values()) {
      session.cancelFileTransfer(transferId);
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    await Promise.all(
      Array.from(this.#sessions.values(), (session) =>
        session.replaceVideoTrack(track)
      )
    );
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    await Promise.all(
      Array.from(this.#sessions.values(), (session) =>
        session.replaceAudioTrack(track)
      )
    );
  }

  close(): void {
    this.#resetSessions();
    this.#signaling.close();
  }

  #resetSessions(): void {
    for (const [peerId, session] of this.#sessions) {
      session.close();
      this.#options.onPeerLeft?.(peerId);
    }
    this.#sessions.clear();
  }

  async #handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case "welcome":
        for (const peer of message.peers) {
          const session = this.#createSession(peer, true);
          await session.startOffer();
        }
        this.#options.onReady?.(message.selfId);
        break;
      case "peer-joined":
        break;
      case "peer-left":
        this.#sessions.get(message.peerId)?.close();
        this.#sessions.delete(message.peerId);
        this.#options.onPeerLeft?.(message.peerId);
        break;
      case "signal": {
        const session =
          this.#sessions.get(message.from.id) ??
          this.#createSession(message.from, false);
        const payload: {
          description?: SessionDescription;
          candidate?: IceCandidate;
        } = {};
        if (message.description) payload.description = message.description;
        if (message.candidate) payload.candidate = message.candidate;
        await session.handleSignal(payload);
        break;
      }
      case "error":
        this.#options.onError?.(message.message);
        break;
    }
  }

  #createSession(peer: PeerSummary, initiator: boolean): PeerSession {
    const existing = this.#sessions.get(peer.id);
    if (existing) return existing;

    const session = new PeerSession({
      peer,
      initiator,
      localStream: this.#options.localStream,
      iceServers: this.#iceServers,
      ...(this.#options.iceTransportPolicy
        ? { iceTransportPolicy: this.#options.iceTransportPolicy }
        : {}),
      sendSignal: (payload) => {
        this.#signaling.send({ type: "signal", to: peer.id, ...payload });
      },
      onRemoteStream: (remotePeer, stream) =>
        this.#options.onPeerStream(remotePeer, stream),
      onChatMessage: (remotePeer, message) =>
        this.#options.onChatMessage(remotePeer, message),
      onFile: (remotePeer, file) =>
        this.#options.onFile(remotePeer, file),
      onQualityChange: (remotePeer, quality) =>
        this.#options.onPeerQuality?.(remotePeer, quality),
      onFileProgress: (remotePeer, progress) =>
        this.#options.onFileProgress?.(remotePeer, progress)
    });

    this.#sessions.set(peer.id, session);
    return session;
  }
}
