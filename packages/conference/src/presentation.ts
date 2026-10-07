import type { ChatMessage, PeerSummary, ReceivedFile } from "@verge/protocol";
import type { ConnectionQualitySnapshot, FileTransferProgress } from "@verge/webrtc";
import type {
  ConferenceTopology,
  ConferenceTransportCapabilities,
} from "./transport";

export const CONFERENCE_PRESENTATION_STATE_EVENT =
  "verge-conference-presentation-state" as const;
export const CONFERENCE_PRESENTATION_COMMAND_EVENT =
  "verge-conference-presentation-command" as const;
export const CONFERENCE_PRESENTATION_ERROR_EVENT =
  "verge-conference-presentation-error" as const;

export interface ConferencePresentationPeer {
  readonly peer: PeerSummary;
  readonly stream?: MediaStream;
  readonly quality?: ConnectionQualitySnapshot;
}

export interface ConferencePresentationSnapshot {
  readonly topology: ConferenceTopology;
  readonly capabilities: ConferenceTransportCapabilities;
  readonly selfId?: string;
  readonly peers: readonly ConferencePresentationPeer[];
  readonly messages: readonly Readonly<{
    peer: PeerSummary;
    message: ChatMessage;
  }>[];
  readonly files: readonly Readonly<{
    peer: PeerSummary;
    file: ReceivedFile;
  }>[];
  readonly transfers: readonly Readonly<{
    peer: PeerSummary;
    progress: FileTransferProgress;
  }>[];
  readonly status?: string;
  readonly error?: string;
}

export type ConferencePresentationCommand =
  | Readonly<{ type: "send-chat"; text: string }>
  | Readonly<{ type: "send-file"; file: File; transferId?: string }>
  | Readonly<{ type: "cancel-file-transfer"; transferId: string }>
  | Readonly<{ type: "replace-video-track"; track: MediaStreamTrack }>
  | Readonly<{ type: "replace-audio-track"; track: MediaStreamTrack }>;

export interface ConferencePresentationSource {
  getSnapshot(): ConferencePresentationSnapshot;
  subscribe(listener: () => void): () => void;
  sendChat(text: string): ChatMessage;
  sendFile(file: File, transferId?: string): Promise<void>;
  cancelFileTransfer(transferId: string): void;
  replaceVideoTrack(track: MediaStreamTrack): Promise<void>;
  replaceAudioTrack(track: MediaStreamTrack): Promise<void>;
}

export interface ConferenceProjectSiteContext {
  readonly host: HTMLElement;
  readonly signal: AbortSignal;
}

export interface ConferenceProjectSiteAdapter {
  mount(
    context: ConferenceProjectSiteContext,
  ): void | (() => void) | Promise<void | (() => void)>;
}

function isPresentationCommand(value: unknown): value is ConferencePresentationCommand {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const type = (value as { readonly type?: unknown }).type;
  return (
    type === "send-chat" ||
    type === "send-file" ||
    type === "cancel-file-transfer" ||
    type === "replace-video-track" ||
    type === "replace-audio-track"
  );
}

async function executePresentationCommand(
  source: ConferencePresentationSource,
  command: ConferencePresentationCommand,
): Promise<void> {
  switch (command.type) {
    case "send-chat":
      source.sendChat(command.text);
      return;
    case "send-file":
      await source.sendFile(command.file, command.transferId);
      return;
    case "cancel-file-transfer":
      source.cancelFileTransfer(command.transferId);
      return;
    case "replace-video-track":
      await source.replaceVideoTrack(command.track);
      return;
    case "replace-audio-track":
      await source.replaceAudioTrack(command.track);
      return;
  }
}

/**
 * Adapts a running Verge conference projection to the generic project-site
 * capability host. It never creates, starts, closes, or owns a conference
 * transport and never acquires media devices.
 *
 * The host receives immutable presentation snapshots through a DOM event and
 * may send only the bounded commands listed above. Room membership, signaling,
 * topology, WebRTC sessions, capture, chat/file delivery, and peer lifecycle
 * remain authoritative in Verge.
 */
export function createConferenceProjectSiteAdapter(
  source: ConferencePresentationSource,
): ConferenceProjectSiteAdapter {
  return {
    mount({ host, signal }) {
      let active = true;

      const publish = () => {
        if (!active) return;
        host.dispatchEvent(
          new CustomEvent<ConferencePresentationSnapshot>(
            CONFERENCE_PRESENTATION_STATE_EVENT,
            { detail: source.getSnapshot() },
          ),
        );
      };

      const reportError = (error: unknown) => {
        if (!active) return;
        host.dispatchEvent(
          new CustomEvent(CONFERENCE_PRESENTATION_ERROR_EVENT, {
            detail: { error },
          }),
        );
      };

      const onCommand = (event: Event) => {
        if (!(event instanceof CustomEvent) || !isPresentationCommand(event.detail)) {
          return;
        }
        void executePresentationCommand(source, event.detail).catch(reportError);
      };

      const unsubscribe = source.subscribe(publish);
      host.addEventListener(CONFERENCE_PRESENTATION_COMMAND_EVENT, onCommand);
      publish();

      const cleanup = () => {
        if (!active) return;
        active = false;
        unsubscribe();
        host.removeEventListener(CONFERENCE_PRESENTATION_COMMAND_EVENT, onCommand);
      };

      signal.addEventListener("abort", cleanup, { once: true });
      return cleanup;
    },
  };
}
