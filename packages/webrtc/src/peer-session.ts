import type {
  ChatMessage,
  IceCandidate,
  PeerSummary,
  ReceivedFile,
  SessionDescription
} from "@verge/protocol";
import { applyCodecPreferences } from "./codecs";
import {
  AdaptiveVideoPolicy,
  applyVideoAdaptation
} from "./adaptive-video";
import {
  sampleConnectionQuality,
  type ConnectionQualitySnapshot
} from "./quality";
import {
  ICE_RESTART_MAX_ATTEMPTS,
  iceRestartDelay
} from "./recovery-policy";

const FILE_CHUNK_SIZE = 64 * 1024;
const FILE_HIGH_WATER_MARK = 4 * 1024 * 1024;
const FILE_LOW_WATER_MARK = 512 * 1024;

export interface PeerSessionEvents {
  onRemoteStream(peer: PeerSummary, stream: MediaStream): void;
  onChatMessage(peer: PeerSummary, message: ChatMessage): void;
  onFile(peer: PeerSummary, file: ReceivedFile): void;
  onStateChange?(peer: PeerSummary, state: RTCPeerConnectionState): void;
  onQualityChange?(
    peer: PeerSummary,
    quality: ConnectionQualitySnapshot
  ): void;
}

export interface PeerSessionOptions extends PeerSessionEvents {
  peer: PeerSummary;
  localStream: MediaStream;
  iceServers: RTCIceServer[];
  initiator: boolean;
  sendSignal(payload: {
    description?: SessionDescription;
    candidate?: IceCandidate;
  }): void;
}

interface FileMetadata {
  kind: "meta";
  id: string;
  name: string;
  size: number;
  mediaType: string;
  sha256: string;
}

interface FileDone {
  kind: "done";
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256(blob: Blob): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  );
}

async function waitForWritable(
  channel: RTCDataChannel
): Promise<void> {
  if (channel.bufferedAmount <= FILE_HIGH_WATER_MARK) return;
  channel.bufferedAmountLowThreshold = FILE_LOW_WATER_MARK;
  await new Promise<void>((resolve) => {
    channel.addEventListener(
      "bufferedamountlow",
      () => resolve(),
      { once: true }
    );
  });
}

function descriptionFromLocal(
  description: RTCSessionDescription
): SessionDescription {
  return { type: description.type, sdp: description.sdp };
}

export class PeerSession {
  readonly peer: PeerSummary;
  readonly connection: RTCPeerConnection;

  #events: PeerSessionEvents;
  #sendSignal: PeerSessionOptions["sendSignal"];
  #pendingCandidates: IceCandidate[] = [];
  #chatChannel: RTCDataChannel | undefined;
  #qualityTimer: ReturnType<typeof setInterval> | undefined;
  #qualitySampleInFlight = false;
  #videoPolicy = new AdaptiveVideoPolicy();
  #initiator: boolean;
  #restartAttempts = 0;
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;

  constructor(options: PeerSessionOptions) {
    this.peer = options.peer;
    this.#events = options;
    this.#sendSignal = options.sendSignal;
    this.#initiator = options.initiator;
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers,
      bundlePolicy: "max-bundle"
    });

    for (const track of options.localStream.getTracks()) {
      this.connection.addTrack(track, options.localStream);
    }

    this.connection.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.#sendSignal({
        candidate: candidate.toJSON() as IceCandidate
      });
    };

    this.connection.ontrack = (event) => {
      const stream =
        event.streams[0] ?? new MediaStream([event.track]);
      this.#events.onRemoteStream(this.peer, stream);
    };

    this.connection.onconnectionstatechange = () => {
      const state = this.connection.connectionState;
      this.#events.onStateChange?.(this.peer, state);
      this.#handleConnectionState(state);
      void this.#sampleQuality();
    };

    this.connection.ondatachannel = ({ channel }) => {
      if (channel.label === "chat") {
        this.#bindChatChannel(channel);
      } else if (channel.label.startsWith("file:")) {
        this.#receiveFile(channel);
      }
    };

    if (options.initiator) {
      this.#bindChatChannel(
        this.connection.createDataChannel("chat", {
          ordered: true
        })
      );
    }

    this.#qualityTimer = setInterval(() => {
      void this.#sampleQuality();
    }, 3_000);
  }

  async startOffer(
    options: { iceRestart?: boolean } = {}
  ): Promise<void> {
    applyCodecPreferences(this.connection);
    const offer = await this.connection.createOffer({
      iceRestart: options.iceRestart ?? false
    });
    await this.connection.setLocalDescription(offer);
    if (this.connection.localDescription) {
      this.#sendSignal({
        description: descriptionFromLocal(
          this.connection.localDescription
        )
      });
    }
  }

  async handleSignal(payload: {
    description?: SessionDescription;
    candidate?: IceCandidate;
  }): Promise<void> {
    if (payload.description) {
      await this.connection.setRemoteDescription(
        payload.description
      );

      for (const candidate of this.#pendingCandidates) {
        await this.connection.addIceCandidate(candidate);
      }
      this.#pendingCandidates = [];

      if (payload.description.type === "offer") {
        applyCodecPreferences(this.connection);
        const answer = await this.connection.createAnswer();
        await this.connection.setLocalDescription(answer);
        if (this.connection.localDescription) {
          this.#sendSignal({
            description: descriptionFromLocal(
              this.connection.localDescription
            )
          });
        }
      }
    }

    if (payload.candidate) {
      if (this.connection.remoteDescription) {
        await this.connection.addIceCandidate(payload.candidate);
      } else {
        this.#pendingCandidates.push(payload.candidate);
      }
    }
  }

  sendChat(message: ChatMessage): void {
    if (this.#chatChannel?.readyState !== "open") return;
    this.#chatChannel.send(JSON.stringify(message));
  }

  async sendFile(file: File): Promise<void> {
    const digest = await sha256(file);
    const id = crypto.randomUUID();
    const channel = this.connection.createDataChannel(
      `file:${id}`,
      { ordered: true }
    );
    channel.binaryType = "arraybuffer";

    const metadata: FileMetadata = {
      kind: "meta",
      id,
      name: file.name,
      size: file.size,
      mediaType:
        file.type || "application/octet-stream",
      sha256: digest
    };

    await new Promise<void>((resolve, reject) => {
      channel.addEventListener(
        "open",
        async () => {
          try {
            channel.send(JSON.stringify(metadata));
            for (
              let offset = 0;
              offset < file.size;
              offset += FILE_CHUNK_SIZE
            ) {
              await waitForWritable(channel);
              channel.send(
                await file
                  .slice(
                    offset,
                    Math.min(
                      offset + FILE_CHUNK_SIZE,
                      file.size
                    )
                  )
                  .arrayBuffer()
              );
            }
            const done: FileDone = { kind: "done" };
            channel.send(JSON.stringify(done));
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        { once: true }
      );
      channel.addEventListener(
        "error",
        () =>
          reject(
            new Error("File data channel failed")
          ),
        { once: true }
      );
    });
  }

  async replaceTrack(
    kind: "audio" | "video",
    track: MediaStreamTrack
  ): Promise<void> {
    const sender = this.connection
      .getSenders()
      .find((candidate) => candidate.track?.kind === kind);
    if (!sender) {
      throw new Error(`No active ${kind} sender is available.`);
    }

    await sender.replaceTrack(track);

    if (kind === "video") {
      try {
        await applyVideoAdaptation(
          sender,
          this.#videoPolicy.tier
        );
      } catch {
        // Encoding adaptation is best-effort across WebRTC implementations.
      }
    }
  }

  async replaceVideoTrack(
    track: MediaStreamTrack
  ): Promise<void> {
    await this.replaceTrack("video", track);
  }

  async replaceAudioTrack(
    track: MediaStreamTrack
  ): Promise<void> {
    await this.replaceTrack("audio", track);
  }

  close(): void {
    this.#closed = true;
    this.#clearRestartTimer();
    if (this.#qualityTimer) {
      clearInterval(this.#qualityTimer);
      this.#qualityTimer = undefined;
    }
    this.#chatChannel?.close();
    this.connection.close();
  }

  #handleConnectionState(
    state: RTCPeerConnectionState
  ): void {
    if (state === "connected") {
      this.#restartAttempts = 0;
      this.#clearRestartTimer();
      return;
    }

    if (!this.#initiator || this.#closed) return;
    this.#scheduleIceRestart(state);
  }

  #scheduleIceRestart(
    state: RTCPeerConnectionState
  ): void {
    if (this.#restartTimer || this.#closed) return;

    const delay = iceRestartDelay(
      state,
      this.#restartAttempts
    );
    if (delay === null) return;

    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      void this.#restartIce();
    }, delay);
  }

  async #restartIce(): Promise<void> {
    if (
      this.#closed ||
      this.connection.connectionState === "connected" ||
      this.#restartAttempts >= ICE_RESTART_MAX_ATTEMPTS
    ) {
      return;
    }

    this.#restartAttempts += 1;

    try {
      this.connection.restartIce();
      await this.startOffer({ iceRestart: true });
    } catch {
      // A later bounded retry may still recover a transient failure.
    }

    const stateAfterRestart =
      this.connection.connectionState as RTCPeerConnectionState;
    if (
      !this.#closed &&
      stateAfterRestart !== "connected"
    ) {
      this.#scheduleIceRestart("disconnected");
    }
  }

  #clearRestartTimer(): void {
    if (!this.#restartTimer) return;
    clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;
  }

  async #sampleQuality(): Promise<void> {
    if (
      this.#qualitySampleInFlight ||
      this.connection.connectionState === "closed"
    ) {
      return;
    }

    this.#qualitySampleInFlight = true;
    try {
      const quality =
        await sampleConnectionQuality(this.connection);
      this.#events.onQualityChange?.(
        this.peer,
        quality
      );

      const nextTier = this.#videoPolicy.observe(
        quality.level,
        quality.sampledAt
      );
      if (nextTier) {
        const sender = this.connection
          .getSenders()
          .find(
            (candidate) =>
              candidate.track?.kind === "video"
          );
        if (sender) {
          try {
            await applyVideoAdaptation(
              sender,
              nextTier
            );
          } catch {
            // Keep the call running when sender parameters are unsupported.
          }
        }
      }
    } catch {
      // Stats are diagnostic and must never interrupt the call.
    } finally {
      this.#qualitySampleInFlight = false;
    }
  }

  #bindChatChannel(channel: RTCDataChannel): void {
    this.#chatChannel = channel;
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.#events.onChatMessage(
          this.peer,
          JSON.parse(event.data) as ChatMessage
        );
      } catch {
        // Ignore malformed peer payloads.
      }
    };
  }

  #receiveFile(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    let metadata: FileMetadata | undefined;
    const chunks: ArrayBuffer[] = [];

    channel.onmessage = async (event) => {
      if (typeof event.data === "string") {
        const message = JSON.parse(
          event.data
        ) as FileMetadata | FileDone;
        if (message.kind === "meta") {
          metadata = message;
          return;
        }

        if (message.kind === "done" && metadata) {
          const blob = new Blob(chunks, {
            type: metadata.mediaType
          });
          const digest = await sha256(blob);
          this.#events.onFile(this.peer, {
            id: metadata.id,
            name: metadata.name,
            mediaType: metadata.mediaType,
            size: metadata.size,
            sha256: metadata.sha256,
            verified:
              digest === metadata.sha256 &&
              blob.size === metadata.size,
            blob
          });
          channel.close();
        }
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        chunks.push(event.data);
      }
    };
  }
}
