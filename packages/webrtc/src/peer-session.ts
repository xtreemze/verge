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
import {
  FILE_CHUNK_SIZE,
  FILE_HIGH_WATER_MARK,
  FILE_LOW_WATER_MARK,
  IncomingFileReceiver,
  parseFileControlMessage,
  sha256Blob,
  type FileDone,
  type FileMetadata,
  type FileTransferProgress
} from "./file-transfer";

export interface PeerSessionEvents {
  onRemoteStream(peer: PeerSummary, stream: MediaStream): void;
  onChatMessage(peer: PeerSummary, message: ChatMessage): void;
  onFile(peer: PeerSummary, file: ReceivedFile): void;
  onStateChange?(peer: PeerSummary, state: RTCPeerConnectionState): void;
  onQualityChange?(
    peer: PeerSummary,
    quality: ConnectionQualitySnapshot
  ): void;
  onFileProgress?(
    peer: PeerSummary,
    progress: FileTransferProgress
  ): void;
}

export interface PeerSessionOptions extends PeerSessionEvents {
  peer: PeerSummary;
  localStream: MediaStream;
  iceServers: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  initiator: boolean;
  sendSignal(payload: {
    description?: SessionDescription;
    candidate?: IceCandidate;
  }): void;
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
  #outgoingFileChannels = new Map<string, RTCDataChannel>();
  #cancelledFileTransfers = new Set<string>();

  constructor(options: PeerSessionOptions) {
    this.peer = options.peer;
    this.#events = options;
    this.#sendSignal = options.sendSignal;
    this.#initiator = options.initiator;
    this.connection = new RTCPeerConnection({
      iceServers: options.iceServers,
      iceTransportPolicy: options.iceTransportPolicy ?? "all",
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

  async sendFile(
    file: File,
    transferId = crypto.randomUUID()
  ): Promise<void> {
    const id = transferId;
    this.#events.onFileProgress?.(this.peer, {
      id,
      name: file.name,
      direction: "send",
      state: "hashing",
      bytesTransferred: 0,
      totalBytes: file.size
    });
    const digest = await sha256Blob(file);
    const channel = this.connection.createDataChannel(
      `file:${id}`,
      { ordered: true }
    );
    channel.binaryType = "arraybuffer";

    this.#outgoingFileChannels.set(id, channel);

    const metadata: FileMetadata = {
      kind: "meta",
      version: 1,
      id,
      name: file.name,
      size: file.size,
      mediaType:
        file.type || "application/octet-stream",
      sha256: digest,
      chunkSize: FILE_CHUNK_SIZE
    };

    await new Promise<void>((resolve, reject) => {
      channel.addEventListener(
        "open",
        async () => {
          try {
            channel.send(JSON.stringify(metadata));
            this.#events.onFileProgress?.(this.peer, {
              id,
              name: file.name,
              direction: "send",
              state: "transferring",
              bytesTransferred: 0,
              totalBytes: file.size
            });
            for (
              let offset = 0;
              offset < file.size;
              offset += FILE_CHUNK_SIZE
            ) {
              if (this.#cancelledFileTransfers.has(id)) {
                throw new DOMException(
                  "File transfer cancelled",
                  "AbortError"
                );
              }
              await waitForWritable(channel);
              const end = Math.min(
                offset + FILE_CHUNK_SIZE,
                file.size
              );
              channel.send(
                await file.slice(offset, end).arrayBuffer()
              );
              this.#events.onFileProgress?.(this.peer, {
                id,
                name: file.name,
                direction: "send",
                state: "transferring",
                bytesTransferred: end,
                totalBytes: file.size
              });
            }
            const done: FileDone = { kind: "done" };
            channel.send(JSON.stringify(done));
            this.#events.onFileProgress?.(this.peer, {
              id,
              name: file.name,
              direction: "send",
              state: "completed",
              bytesTransferred: file.size,
              totalBytes: file.size
            });
            this.#outgoingFileChannels.delete(id);
            resolve();
          } catch (error) {
            const cancelled =
              this.#cancelledFileTransfers.delete(id);
            this.#outgoingFileChannels.delete(id);
            this.#events.onFileProgress?.(this.peer, {
              id,
              name: file.name,
              direction: "send",
              state: cancelled ? "cancelled" : "failed",
              bytesTransferred: 0,
              totalBytes: file.size
            });
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

  cancelFileTransfer(id: string): void {
    this.#cancelledFileTransfers.add(id);
    const channel = this.#outgoingFileChannels.get(id);
    if (!channel) return;
    if (channel.readyState === "open") {
      channel.send(JSON.stringify({ kind: "cancel" }));
    }
    channel.close();
    this.#outgoingFileChannels.delete(id);
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
    for (const channel of this.#outgoingFileChannels.values()) {
      channel.close();
    }
    this.#outgoingFileChannels.clear();
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
    let receiver: IncomingFileReceiver | undefined;
    let processing = Promise.resolve();

    const abort = async (): Promise<void> => {
      const active = receiver;
      receiver = undefined;
      await active?.abort();
    };

    channel.onclose = () => {
      void abort();
    };

    channel.onerror = () => {
      void abort();
    };

    channel.onmessage = (event) => {
      processing = processing
        .then(async () => {
          if (typeof event.data === "string") {
            let raw: unknown;
            try {
              raw = JSON.parse(event.data);
            } catch {
              throw new Error("Malformed file transfer control message.");
            }

            const message = parseFileControlMessage(raw);
            if (!message) {
              throw new Error("Unsupported file transfer control message.");
            }

            if (message.kind === "meta") {
              if (receiver) {
                throw new Error("Duplicate file transfer metadata.");
              }
              receiver = await IncomingFileReceiver.create(message);
              this.#events.onFileProgress?.(this.peer, {
                id: message.id,
                name: message.name,
                direction: "receive",
                state: "transferring",
                bytesTransferred: 0,
                totalBytes: message.size
              });
              return;
            }

            if (message.kind === "cancel") {
              const active = receiver;
              receiver = undefined;
              if (active) {
                await active.abort();
                this.#events.onFileProgress?.(this.peer, {
                  id: active.metadata.id,
                  name: active.metadata.name,
                  direction: "receive",
                  state: "cancelled",
                  bytesTransferred: active.receivedBytes,
                  totalBytes: active.metadata.size
                });
              }
              channel.close();
              return;
            }

            if (message.kind === "done") {
              if (!receiver) {
                throw new Error("File transfer completed without metadata.");
              }
              const completed = receiver;
              receiver = undefined;
              const file = await completed.finish();
              this.#events.onFileProgress?.(this.peer, {
                id: file.id,
                name: file.name,
                direction: "receive",
                state: "completed",
                bytesTransferred: file.size,
                totalBytes: file.size
              });
              this.#events.onFile(this.peer, file);
              channel.close();
            }
            return;
          }

          if (event.data instanceof ArrayBuffer) {
            if (!receiver) {
              throw new Error("File bytes arrived before metadata.");
            }
            await receiver.write(event.data);
            this.#events.onFileProgress?.(this.peer, {
              id: receiver.metadata.id,
              name: receiver.metadata.name,
              direction: "receive",
              state: "transferring",
              bytesTransferred: receiver.receivedBytes,
              totalBytes: receiver.metadata.size
            });
          }
        })
        .catch(async () => {
          await abort();
          channel.close();
        });
    };
  }
}
