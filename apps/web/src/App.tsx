import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup
} from "solid-js";
import {
  createConferenceTransport,
  type ConferenceTransport
} from "@verge/conference";
import {
  acquireDisplayMedia,
  acquireLocalMedia,
  setNativeBackgroundBlur,
  setTrackEnabled,
  stopStream,
  supportsNativeBackgroundBlur,
  type AudioMode
} from "@verge/media";
import type {
  ChatMessage,
  PeerSummary,
  ReceivedFile
} from "@verge/protocol";
import {
  supportedVideoMimeTypes,
  type ConnectionQualitySnapshot
} from "@verge/webrtc";
import { loadIceServers } from "./ice-config";

interface RemotePeer {
  peer: PeerSummary;
  stream: MediaStream;
}

interface DisplayMessage extends ChatMessage {
  author: string;
  self: boolean;
}

interface Download {
  id: string;
  name: string;
  from: string;
  verified: boolean;
  url: string;
}

function randomRoom(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function initialRoom(): string {
  return new URLSearchParams(location.search).get("room") ?? randomRoom();
}

function signalingUrl(): string {
  if (import.meta.env.VITE_SIGNALING_URL) {
    return import.meta.env.VITE_SIGNALING_URL;
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.hostname}:8787`;
}

function attachVideo(
  element: HTMLVideoElement,
  stream: MediaStream,
  muted = false
): void {
  element.srcObject = stream;
  element.muted = muted;
  void element.play().catch(() => undefined);
}

function connectionQualityTitle(
  quality: ConnectionQualitySnapshot
): string {
  const details: string[] = [];
  if (quality.rttMs !== undefined) {
    details.push(`RTT ${Math.round(quality.rttMs)} ms`);
  }
  if (quality.packetLossPercent !== undefined) {
    details.push(
      `loss ${quality.packetLossPercent.toFixed(1)}%`
    );
  }
  if (quality.jitterMs !== undefined) {
    details.push(
      `jitter ${Math.round(quality.jitterMs)} ms`
    );
  }
  if (quality.icePath === "relay") {
    details.push("TURN relay");
  } else if (quality.icePath === "direct") {
    details.push("direct ICE");
  }
  return details.join(" · ");
}

export function App() {
  const [roomId, setRoomId] = createSignal(initialRoom());
  const [displayName, setDisplayName] = createSignal("");
  const [audioMode, setAudioMode] = createSignal<AudioMode>("speech");
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remotePeers, setRemotePeers] = createSignal<RemotePeer[]>([]);
  const [peerQuality, setPeerQuality] = createSignal<
    Record<string, ConnectionQualitySnapshot>
  >({});
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [downloads, setDownloads] = createSignal<Download[]>([]);
  const [messageText, setMessageText] = createSignal("");
  const [connected, setConnected] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [status, setStatus] = createSignal("Ready");
  const [micEnabled, setMicEnabled] = createSignal(true);
  const [cameraEnabled, setCameraEnabled] = createSignal(true);
  const [screenSharing, setScreenSharing] = createSignal(false);
  const [blurEnabled, setBlurEnabled] = createSignal(false);
  const [blurAvailable, setBlurAvailable] = createSignal(false);

  let conference: ConferenceTransport | undefined;
  let displayStream: MediaStream | undefined;

  const codecs = createMemo(() => {
    try {
      return supportedVideoMimeTypes();
    } catch {
      return [];
    }
  });

  function upsertPeer(peer: PeerSummary, stream: MediaStream): void {
    setRemotePeers((current) => [
      ...current.filter((item) => item.peer.id !== peer.id),
      { peer, stream }
    ]);
  }

  async function join(): Promise<void> {
    if (joining() || connected()) return;
    if (!displayName().trim()) {
      setStatus("Enter your name.");
      return;
    }
    if (!roomId().trim()) {
      setStatus("Enter a room identifier.");
      return;
    }

    setJoining(true);
    setStatus("Requesting camera and microphone…");

    try {
      const stream = await acquireLocalMedia({ audioMode: audioMode() });
      setLocalStream(stream);
      const cameraTrack = stream.getVideoTracks()[0];
      setBlurAvailable(
        cameraTrack ? supportsNativeBackgroundBlur(cameraTrack) : false
      );

      const iceServers = await loadIceServers();
      conference = createConferenceTransport({
        topology: "mesh",
        signalingUrl: signalingUrl(),
        roomId: roomId(),
        displayName: displayName().trim(),
        localStream: stream,
        ...(iceServers ? { iceServers } : {}),
        onReady: () => {
          setConnected(true);
          setStatus("Connected");
          const url = new URL(location.href);
          url.searchParams.set("room", roomId());
          history.replaceState(null, "", url);
        },
        onPeerStream: upsertPeer,
        onPeerLeft: (peerId) => {
          setRemotePeers((current) =>
            current.filter((item) => item.peer.id !== peerId)
          );
          setPeerQuality((current) => {
            const next = { ...current };
            delete next[peerId];
            return next;
          });
        },
        onPeerQuality: (peer, quality) =>
          setPeerQuality((current) => ({
            ...current,
            [peer.id]: quality
          })),
        onChatMessage: (peer, message) =>
          setMessages((current) => [
            ...current,
            { ...message, author: peer.displayName, self: false }
          ]),
        onFile: (peer, file) => receiveFile(peer, file),
        onError: (message) => setStatus(message)
      });

      await conference.start();
    } catch (error) {
      const stream = localStream();
      if (stream) stopStream(stream);
      setLocalStream(undefined);
      setStatus(error instanceof Error ? error.message : "Unable to join.");
    } finally {
      setJoining(false);
    }
  }

  function receiveFile(peer: PeerSummary, file: ReceivedFile): void {
    const url = URL.createObjectURL(file.blob);
    setDownloads((current) => [
      ...current,
      {
        id: file.id,
        name: file.name,
        from: peer.displayName,
        verified: file.verified,
        url
      }
    ]);
  }

  function leave(): void {
    conference?.close();
    conference = undefined;
    if (displayStream) stopStream(displayStream);
    displayStream = undefined;
    const stream = localStream();
    if (stream) stopStream(stream);
    setLocalStream(undefined);
    setRemotePeers([]);
    setPeerQuality({});
    setConnected(false);
    setScreenSharing(false);
    setBlurEnabled(false);
    setStatus("Left room");
  }

  function toggleMicrophone(): void {
    const stream = localStream();
    if (!stream) return;
    const next = !micEnabled();
    setTrackEnabled(stream, "audio", next);
    setMicEnabled(next);
  }

  function toggleCamera(): void {
    const stream = localStream();
    if (!stream) return;
    const next = !cameraEnabled();
    setTrackEnabled(stream, "video", next);
    setCameraEnabled(next);
  }

  async function toggleBlur(): Promise<void> {
    const track = localStream()?.getVideoTracks()[0];
    if (!track) return;
    const next = !blurEnabled();
    const applied = await setNativeBackgroundBlur(track, next);
    if (applied) {
      setBlurEnabled(next);
    } else {
      setStatus("Native background blur is unavailable on this device.");
    }
  }

  async function stopScreenShare(): Promise<void> {
    const camera = localStream()?.getVideoTracks()[0];
    if (camera && conference) await conference.replaceVideoTrack(camera);
    if (displayStream) stopStream(displayStream);
    displayStream = undefined;
    setScreenSharing(false);
  }

  async function toggleScreenShare(): Promise<void> {
    if (screenSharing()) {
      await stopScreenShare();
      return;
    }

    if (!conference) return;
    try {
      const stream = await acquireDisplayMedia();
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stopStream(stream);
        return;
      }
      displayStream = stream;
      await conference.replaceVideoTrack(track);
      setScreenSharing(true);
      track.onended = () => void stopScreenShare();
    } catch {
      setStatus("Screen sharing was cancelled.");
    }
  }

  function sendMessage(event: SubmitEvent): void {
    event.preventDefault();
    const text = messageText().trim();
    if (!text || !conference) return;
    const message = conference.sendChat(text);
    setMessages((current) => [
      ...current,
      { ...message, author: displayName().trim(), self: true }
    ]);
    setMessageText("");
  }

  async function sendSelectedFile(
    event: Event & { currentTarget: HTMLInputElement }
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !conference) return;
    setStatus(`Sending ${file.name}…`);
    try {
      await conference.sendFile(file);
      setStatus(`Sent ${file.name}`);
    } catch {
      setStatus(`Could not send ${file.name}`);
    }
  }

  async function copyInvite(): Promise<void> {
    const url = new URL(location.href);
    url.searchParams.set("room", roomId());
    await navigator.clipboard.writeText(url.toString());
    setStatus("Invite link copied");
  }

  onCleanup(() => {
    conference?.close();
    if (displayStream) stopStream(displayStream);
    const stream = localStream();
    if (stream) stopStream(stream);
    for (const download of downloads()) URL.revokeObjectURL(download.url);
  });

  return (
    <main class="app-shell">
      <Show
        when={connected()}
        fallback={
          <section class="lobby">
            <div class="brand">Verge</div>
            <h1>Meet at the edge.</h1>
            <p class="lede">
              Peer-to-peer audio, video, screen sharing, chat, and files.
              The signaling server introduces peers; your media does not pass
              through it.
            </p>

            <div class="lobby-card">
              <label>
                Your name
                <input
                  autocomplete="name"
                  value={displayName()}
                  onInput={(event) => setDisplayName(event.currentTarget.value)}
                  placeholder="Carlos"
                />
              </label>
              <label>
                Room
                <input
                  value={roomId()}
                  onInput={(event) => setRoomId(event.currentTarget.value)}
                  spellcheck={false}
                />
              </label>
              <label>
                Audio processing
                <select
                  value={audioMode()}
                  onChange={(event) =>
                    setAudioMode(event.currentTarget.value as AudioMode)
                  }
                >
                  <option value="speech">Speech · noise suppression</option>
                  <option value="original">Original · stereo / unprocessed</option>
                </select>
              </label>
              <button class="primary" disabled={joining()} onClick={() => void join()}>
                {joining() ? "Joining…" : "Join room"}
              </button>
            </div>

            <div class="privacy-note">
              <strong>Private by transport.</strong> WebRTC encrypts media and
              data in transit. TURN may relay encrypted packets when direct
              connectivity is impossible.
            </div>
            <p class="status" role="status">{status()}</p>
          </section>
        }
      >
        <section class="conference">
          <header class="topbar">
            <div>
              <div class="brand compact">Verge</div>
              <strong>{roomId()}</strong>
              <span class="peer-count">
                {remotePeers().length + 1} participant
                {remotePeers().length === 0 ? "" : "s"}
              </span>
            </div>
            <div class="top-actions">
              <button onClick={() => void copyInvite()}>Copy invite</button>
              <button class="danger" onClick={leave}>Leave</button>
            </div>
          </header>

          <div class="workspace">
            <section class="stage" aria-label="Conference video">
              <div class="video-grid">
                <Show when={localStream()}>
                  {(stream) => (
                    <article class="video-tile">
                      <video
                        ref={(element) => attachVideo(element, stream(), true)}
                        autoplay
                        playsinline
                      />
                      <span class="nameplate">You</span>
                    </article>
                  )}
                </Show>

                <For each={remotePeers()}>
                  {(item) => (
                    <article class="video-tile">
                      <video
                        ref={(element) => attachVideo(element, item.stream)}
                        autoplay
                        playsinline
                      />
                      <span class="nameplate">
                        <span>{item.peer.displayName}</span>
                        <Show when={peerQuality()[item.peer.id]}>
                          {(quality) => (
                            <span
                              class={`quality-badge quality-${quality().level}`}
                              title={connectionQualityTitle(quality())}
                            >
                              {quality().icePath === "unknown"
                                ? quality().level
                                : `${quality().level} · ${quality().icePath}`}
                            </span>
                          )}
                        </Show>
                      </span>
                    </article>
                  )}
                </For>

                <Show when={remotePeers().length === 0}>
                  <div class="empty-peer">
                    Share the invite link to add another participant.
                  </div>
                </Show>
              </div>

              <div class="controls" aria-label="Call controls">
                <button
                  classList={{ active: micEnabled() }}
                  onClick={toggleMicrophone}
                >
                  {micEnabled() ? "Mute" : "Unmute"}
                </button>
                <button
                  classList={{ active: cameraEnabled() }}
                  onClick={toggleCamera}
                >
                  {cameraEnabled() ? "Camera off" : "Camera on"}
                </button>
                <button
                  classList={{ active: screenSharing() }}
                  onClick={() => void toggleScreenShare()}
                >
                  {screenSharing() ? "Stop sharing" : "Share screen"}
                </button>
                <button
                  disabled={!blurAvailable()}
                  classList={{ active: blurEnabled() }}
                  onClick={() => void toggleBlur()}
                  title={
                    blurAvailable()
                      ? "Use the browser/device background blur capability"
                      : "Native background blur is not available on this device"
                  }
                >
                  {blurEnabled() ? "Remove blur" : "Background blur"}
                </button>
              </div>

              <details class="diagnostics">
                <summary>Media capabilities</summary>
                <span>Video codecs: {codecs().join(", ") || "not detected"}</span>
                <span>Audio: Opus preferred</span>
                <span>Topology: {conference?.topology ?? "mesh"} · direct peer media</span>
              </details>
              <p class="status" role="status">{status()}</p>
            </section>

            <aside class="side-panel">
              <section class="chat">
                <div class="panel-heading">
                  <h2>Chat</h2>
                  <label class="file-button">
                    Send file
                    <input
                      type="file"
                      onChange={(event) => void sendSelectedFile(event)}
                    />
                  </label>
                </div>

                <div class="messages" aria-live="polite">
                  <For each={messages()}>
                    {(message) => (
                      <article
                        class="message"
                        classList={{ self: message.self }}
                      >
                        <strong>{message.author}</strong>
                        <p>{message.text}</p>
                        <time>{new Date(message.sentAt).toLocaleTimeString()}</time>
                      </article>
                    )}
                  </For>
                </div>

                <form class="composer" onSubmit={sendMessage}>
                  <input
                    aria-label="Message"
                    value={messageText()}
                    onInput={(event) => setMessageText(event.currentTarget.value)}
                    placeholder="Message everyone"
                  />
                  <button type="submit">Send</button>
                </form>
              </section>

              <Show when={downloads().length > 0}>
                <section class="downloads">
                  <h2>Files</h2>
                  <For each={downloads()}>
                    {(download) => (
                      <a href={download.url} download={download.name}>
                        <span>{download.name}</span>
                        <small>
                          from {download.from} ·{" "}
                          {download.verified ? "SHA-256 verified" : "verification failed"}
                        </small>
                      </a>
                    )}
                  </For>
                </section>
              </Show>
            </aside>
          </div>
        </section>
      </Show>
    </main>
  );
}
