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
  acquireCameraTrack,
  acquireDisplayMedia,
  acquireLocalMedia,
  acquireMicrophoneTrack,
  enumerateMediaDevices,
  setAudioOutputDevice,
  setNativeBackgroundBlur,
  setTrackEnabled,
  stopStream,
  supportsAudioOutputSelection,
  supportsDisplayCapture,
  supportsNativeBackgroundBlur,
  type AudioMode,
  type MediaDeviceGroups,
  type ScreenShareMode
} from "@verge/media";
import {
  isValidRoomId,
  type ChatMessage,
  type PeerSummary,
  type ReceivedFile
} from "@verge/protocol";
import {
  supportedVideoMimeTypes,
  type ConnectionQualitySnapshot,
  type FileTransferProgress
} from "@verge/webrtc";
import { loadIceServers } from "./ice-config";
import { sessionBootstrap } from "./session-bootstrap";

interface RemotePeer {
  peer: PeerSummary;
  stream: MediaStream;
}

interface DisplayMessage extends ChatMessage {
  author: string;
  self: boolean;
}

interface ActiveTransfer {
  key: string;
  peerId: string;
  peerName: string;
  progress: FileTransferProgress;
}

interface Download {
  id: string;
  name: string;
  from: string;
  verified: boolean;
  url: string;
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
  muted = false,
  outputDeviceId = ""
): void {
  element.srcObject = stream;
  element.muted = muted;
  void element.play().catch(() => undefined);

  if (!muted && outputDeviceId) {
    void setAudioOutputDevice(element, outputDeviceId).catch(
      () => undefined
    );
  }
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
  const bootstrap = sessionBootstrap(location.search);
  const [roomId, setRoomId] = createSignal(bootstrap.roomId);
  const [displayName, setDisplayName] = createSignal(bootstrap.displayName);
  const [audioMode, setAudioMode] = createSignal<AudioMode>("speech");
  const [localStream, setLocalStream] = createSignal<MediaStream>();
  const [remotePeers, setRemotePeers] = createSignal<RemotePeer[]>([]);
  const [peerQuality, setPeerQuality] = createSignal<
    Record<string, ConnectionQualitySnapshot>
  >({});
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [downloads, setDownloads] = createSignal<Download[]>([]);
  const [activeTransfers, setActiveTransfers] =
    createSignal<ActiveTransfer[]>([]);
  const [messageText, setMessageText] = createSignal("");
  const [connected, setConnected] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [status, setStatus] = createSignal("Ready");
  const [micEnabled, setMicEnabled] = createSignal(true);
  const [cameraEnabled, setCameraEnabled] = createSignal(true);
  const [screenSharing, setScreenSharing] = createSignal(false);
  const [screenShareMode, setScreenShareMode] =
    createSignal<ScreenShareMode>("detail");
  const [blurEnabled, setBlurEnabled] = createSignal(false);
  const [blurAvailable, setBlurAvailable] = createSignal(false);
  const [cameras, setCameras] = createSignal<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] =
    createSignal<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = createSignal<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = createSignal("");
  const [selectedMicrophoneId, setSelectedMicrophoneId] =
    createSignal("");
  const [selectedSpeakerId, setSelectedSpeakerId] = createSignal("");
  const [switchingDevice, setSwitchingDevice] = createSignal(false);
  const audioOutputSelectionAvailable =
    supportsAudioOutputSelection();
  const displayCaptureAvailable = supportsDisplayCapture();
  const secureContext = window.isSecureContext;

  if (bootstrap.debug) {
    console.info("[verge:diagnostics]", {
      secureContext,
      displayCaptureAvailable,
      signalingUrl: signalingUrl(),
      userAgent: navigator.userAgent
    });
  }

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

  async function applySpeakerToRemoteVideos(
    deviceId: string
  ): Promise<void> {
    const elements =
      document.querySelectorAll<HTMLVideoElement>(
        "video[data-remote-video]"
      );
    await Promise.all(
      Array.from(elements, (element) =>
        setAudioOutputDevice(element, deviceId)
      )
    );
  }

  async function refreshDevices(): Promise<
    MediaDeviceGroups | undefined
  > {
    try {
      const devices = await enumerateMediaDevices();
      setCameras(devices.cameras);
      setMicrophones(devices.microphones);
      setSpeakers(devices.speakers);

      if (audioOutputSelectionAvailable) {
        const current = selectedSpeakerId();
        const stillAvailable = devices.speakers.some(
          (device) => device.deviceId === current
        );

        if (!current || !stillAvailable) {
          const fallback =
            devices.speakers.find(
              (device) => device.deviceId === "default"
            ) ?? devices.speakers[0];
          const fallbackId = fallback?.deviceId ?? "";
          setSelectedSpeakerId(fallbackId);

          if (current && fallbackId) {
            await applySpeakerToRemoteVideos(fallbackId);
            setStatus(
              "Selected speaker is unavailable; using the default output."
            );
          }
        }
      }

      return devices;
    } catch {
      // Enumeration can fail before permission or during OS changes.
      return undefined;
    }
  }

  async function join(): Promise<void> {
    if (joining() || connected()) return;
    if (!displayName().trim()) {
      setStatus("Enter your name.");
      return;
    }
    if (!isValidRoomId(roomId().trim())) {
      setStatus("Room identifier must be 32 URL-safe characters.");
      return;
    }
    if (!secureContext) {
      setStatus("Camera and microphone require HTTPS or localhost.");
      return;
    }

    setJoining(true);
    setStatus("Requesting camera and microphone…");

    try {
      const stream = await acquireLocalMedia({ audioMode: audioMode() });
      setLocalStream(stream);
      const cameraTrack = stream.getVideoTracks()[0];
      const microphoneTrack = stream.getAudioTracks()[0];
      setSelectedCameraId(
        cameraTrack?.getSettings().deviceId ?? ""
      );
      setSelectedMicrophoneId(
        microphoneTrack?.getSettings().deviceId ?? ""
      );
      setBlurAvailable(
        cameraTrack ? supportsNativeBackgroundBlur(cameraTrack) : false
      );
      await refreshDevices();

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
        onFileProgress: (peer, progress) =>
          setActiveTransfers((current) => {
            const key = `${peer.id}:${progress.id}:${progress.direction}`;
            const next = current.filter((item) => item.key !== key);
            if (
              progress.state === "completed" ||
              progress.state === "cancelled"
            ) {
              return next;
            }
            return [
              ...next,
              {
                key,
                peerId: peer.id,
                peerName: peer.displayName,
                progress
              }
            ];
          }),
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
    setActiveTransfers([]);
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

  async function switchCamera(deviceId: string): Promise<void> {
    const stream = localStream();
    if (!stream || !deviceId || switchingDevice()) return;

    setSwitchingDevice(true);
    setStatus("Switching camera…");
    let nextTrack: MediaStreamTrack | undefined;
    try {
      nextTrack = await acquireCameraTrack({ deviceId });
      nextTrack.enabled = cameraEnabled();

      const blurSupported =
        supportsNativeBackgroundBlur(nextTrack);
      if (blurEnabled() && blurSupported) {
        await setNativeBackgroundBlur(nextTrack, true);
      } else if (blurEnabled() && !blurSupported) {
        setBlurEnabled(false);
      }
      setBlurAvailable(blurSupported);

      const previous = stream.getVideoTracks()[0];
      if (!screenSharing() && conference) {
        await conference.replaceVideoTrack(nextTrack);
      }
      if (previous) {
        stream.removeTrack(previous);
        previous.stop();
      }
      stream.addTrack(nextTrack);
      setSelectedCameraId(
        nextTrack.getSettings().deviceId ?? deviceId
      );
      await refreshDevices();
      setStatus("Camera switched");
    } catch (error) {
      nextTrack?.stop();
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to switch camera."
      );
    } finally {
      setSwitchingDevice(false);
    }
  }

  async function switchMicrophone(
    deviceId: string
  ): Promise<void> {
    const stream = localStream();
    if (!stream || !deviceId || switchingDevice()) return;

    setSwitchingDevice(true);
    setStatus("Switching microphone…");
    let nextTrack: MediaStreamTrack | undefined;
    try {
      nextTrack = await acquireMicrophoneTrack({
        deviceId,
        audioMode: audioMode()
      });
      nextTrack.enabled = micEnabled();

      if (conference) {
        await conference.replaceAudioTrack(nextTrack);
      }

      const previous = stream.getAudioTracks()[0];
      if (previous) {
        stream.removeTrack(previous);
        previous.stop();
      }
      stream.addTrack(nextTrack);
      setSelectedMicrophoneId(
        nextTrack.getSettings().deviceId ?? deviceId
      );
      await refreshDevices();
      setStatus("Microphone switched");
    } catch (error) {
      nextTrack?.stop();
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to switch microphone."
      );
    } finally {
      setSwitchingDevice(false);
    }
  }

  async function switchSpeaker(deviceId: string): Promise<void> {
    if (
      !audioOutputSelectionAvailable ||
      !deviceId ||
      switchingDevice()
    ) {
      return;
    }

    const previous = selectedSpeakerId();
    setSwitchingDevice(true);
    setSelectedSpeakerId(deviceId);
    setStatus("Switching speaker…");

    try {
      await applySpeakerToRemoteVideos(deviceId);
      setStatus("Speaker switched");
    } catch (error) {
      setSelectedSpeakerId(previous);
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to switch speaker."
      );
    } finally {
      setSwitchingDevice(false);
    }
  }

  async function recoverDevicesAfterChange(): Promise<void> {
    if (!connected() || switchingDevice()) {
      await refreshDevices();
      return;
    }

    const devices = await refreshDevices();
    if (!devices) return;

    const cameraId = selectedCameraId();
    if (
      cameraId &&
      !devices.cameras.some(
        (device) => device.deviceId === cameraId
      )
    ) {
      const fallback = devices.cameras[0];
      if (fallback) {
        await switchCamera(fallback.deviceId);
        setStatus(
          "Selected camera was removed; switched to another camera."
        );
      }
    }

    const microphoneId = selectedMicrophoneId();
    if (
      microphoneId &&
      !devices.microphones.some(
        (device) => device.deviceId === microphoneId
      )
    ) {
      const fallback =
        devices.microphones.find(
          (device) => device.deviceId === "default"
        ) ?? devices.microphones[0];
      if (fallback) {
        await switchMicrophone(fallback.deviceId);
        setStatus(
          "Selected microphone was removed; switched to another microphone."
        );
      }
    }
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
    if (!displayCaptureAvailable) {
      setStatus("Screen sharing is unavailable in this browser.");
      return;
    }
    try {
      const stream = await acquireDisplayMedia({ mode: screenShareMode() });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stopStream(stream);
        return;
      }
      displayStream = stream;
      await conference.replaceVideoTrack(track);
      setScreenSharing(true);
      track.onended = () => void stopScreenShare();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Screen sharing was cancelled."
      );
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
    const transferId = crypto.randomUUID();
    setStatus(`Sending ${file.name}…`);
    try {
      await conference.sendFile(file, transferId);
      setStatus(`Sent ${file.name}`);
    } catch {
      setStatus(`Could not send ${file.name}`);
    }
  }

  function cancelTransfer(transferId: string): void {
    conference?.cancelFileTransfer(transferId);
    setActiveTransfers((current) =>
      current.filter((item) => item.progress.id !== transferId)
    );
    setStatus("File transfer cancelled");
  }

  async function copyInvite(): Promise<void> {
    const url = new URL(location.href);
    url.searchParams.set("room", roomId());
    await navigator.clipboard.writeText(url.toString());
    setStatus("Invite link copied");
  }

  const handleDeviceChange = () => {
    void recoverDevicesAfterChange();
  };
  navigator.mediaDevices.addEventListener(
    "devicechange",
    handleDeviceChange
  );

  onCleanup(() => {
    navigator.mediaDevices.removeEventListener(
      "devicechange",
      handleDeviceChange
    );
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
              <button
                class="primary"
                data-testid="join-room"
                disabled={joining()}
                onClick={() => void join()}
              >
                {joining() ? "Joining…" : "Join room"}
              </button>
            </div>

            <div class="privacy-note">
              <strong>Private by transport.</strong> WebRTC encrypts media and
              data in transit. TURN may relay encrypted packets when direct
              connectivity is impossible.
            </div>
            <p class="status" role="status" data-testid="lobby-status">{status()}</p>
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
                        ref={(element) => {
                          element.dataset.remoteVideo = "";
                          attachVideo(
                            element,
                            item.stream,
                            false,
                            selectedSpeakerId()
                          );
                        }}
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
                <label class="share-mode">
                  <span>Share quality</span>
                  <select
                    aria-label="Screen share quality"
                    value={screenShareMode()}
                    disabled={screenSharing()}
                    onChange={(event) =>
                      setScreenShareMode(
                        event.currentTarget.value as ScreenShareMode
                      )
                    }
                  >
                    <option value="detail">Text / UI · detail</option>
                    <option value="motion">Video / motion</option>
                  </select>
                </label>
                <button
                  classList={{ active: screenSharing() }}
                  disabled={!displayCaptureAvailable && !screenSharing()}
                  onClick={() => void toggleScreenShare()}
                  title={
                    !displayCaptureAvailable
                      ? "Screen sharing is unavailable in this browser"
                      : screenShareMode() === "detail"
                        ? "Favor text and interface clarity at a lower frame rate"
                        : "Favor smoother animation and video at a higher frame rate"
                  }
                >
                  {screenSharing()
                    ? `Stop sharing · ${screenShareMode()}`
                    : "Share screen"}
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

              <details class="device-settings">
                <summary>Devices</summary>
                <div class="device-grid">
                  <label>
                    Camera
                    <select
                      value={selectedCameraId()}
                      disabled={
                        switchingDevice() || cameras().length === 0
                      }
                      onChange={(event) =>
                        void switchCamera(event.currentTarget.value)
                      }
                    >
                      <For each={cameras()}>
                        {(device, index) => (
                          <option value={device.deviceId}>
                            {device.label ||
                              `Camera ${index() + 1}`}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <label>
                    Microphone
                    <select
                      value={selectedMicrophoneId()}
                      disabled={
                        switchingDevice() ||
                        microphones().length === 0
                      }
                      onChange={(event) =>
                        void switchMicrophone(
                          event.currentTarget.value
                        )
                      }
                    >
                      <For each={microphones()}>
                        {(device, index) => (
                          <option value={device.deviceId}>
                            {device.label ||
                              `Microphone ${index() + 1}`}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <Show
                    when={
                      audioOutputSelectionAvailable &&
                      speakers().length > 0
                    }
                  >
                    <label>
                      Speaker
                      <select
                        value={selectedSpeakerId()}
                        disabled={switchingDevice()}
                        onChange={(event) =>
                          void switchSpeaker(
                            event.currentTarget.value
                          )
                        }
                      >
                        <For each={speakers()}>
                          {(device, index) => (
                            <option value={device.deviceId}>
                              {device.label ||
                                `Speaker ${index() + 1}`}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Show>
                </div>
              </details>

              <details class="diagnostics" open={bootstrap.debug}>
                <summary>Media capabilities</summary>
                <span>Secure context: {secureContext ? "yes" : "no"}</span>
                <span>Display capture: {displayCaptureAvailable ? "available" : "unavailable"}</span>
                <span>Video codecs: {codecs().join(", ") || "not detected"}</span>
                <span>Audio: Opus preferred</span>
                <span>Topology: {conference?.topology ?? "mesh"} · direct peer media</span>
                <span>Signaling: {signalingUrl()}</span>
              </details>
              <p class="status" role="status" data-testid="conference-status">{status()}</p>
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

              <Show when={activeTransfers().length > 0}>
                <section class="downloads">
                  <h2>Transfers</h2>
                  <For each={activeTransfers()}>
                    {(item) => (
                      <div class="transfer-row">
                        <span>
                          {item.progress.direction === "send" ? "To" : "From"}{" "}
                          {item.peerName} · {item.progress.name}
                        </span>
                        <progress
                          max={Math.max(item.progress.totalBytes, 1)}
                          value={item.progress.bytesTransferred}
                        />
                        <small>{item.progress.state}</small>
                        <Show when={item.progress.direction === "send"}>
                          <button
                            type="button"
                            onClick={() =>
                              cancelTransfer(item.progress.id)
                            }
                          >
                            Cancel
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </section>
              </Show>

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
