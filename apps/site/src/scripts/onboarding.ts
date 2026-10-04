import {
  acquireLocalMedia,
  stopStream,
  supportsNativeBackgroundBlur
} from "@verge/media";
import {
  createRoomId,
  isValidRoomId
} from "@verge/protocol";
import {
  evaluateBrowserReadiness,
  type BrowserCapabilitySnapshot
} from "../lib/readiness";

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function browserCapabilities(): BrowserCapabilitySnapshot {
  const mediaDevices = navigator.mediaDevices;
  const webrtc =
    typeof window.RTCPeerConnection === "function";

  return {
    secureContext: window.isSecureContext,
    webrtc,
    userMedia:
      typeof mediaDevices?.getUserMedia === "function",
    codecPreferences:
      typeof window.RTCRtpTransceiver === "function" &&
      typeof RTCRtpTransceiver.prototype.setCodecPreferences === "function",
    dataChannel:
      webrtc &&
      "createDataChannel" in RTCPeerConnection.prototype,
    secureRandom:
      typeof globalThis.crypto?.getRandomValues === "function",
    displayCapture:
      typeof mediaDevices?.getDisplayMedia === "function"
  };
}

function createRoomIdSafely(): string | undefined {
  try {
    return createRoomId();
  } catch {
    return undefined;
  }
}

export function initializeOnboarding(): void {
  const root = document.querySelector("[data-onboarding]");
  if (!(root instanceof HTMLElement)) return;

  const configuredAppUrl = root.dataset.appUrl ?? "";
  const readiness = evaluateBrowserReadiness(
    browserCapabilities()
  );

  for (const capability of readiness.capabilities) {
    const item = byId(`cap-${capability.id}`);
    if (!(item instanceof HTMLElement)) continue;

    item.dataset.state = capability.supported
      ? "pass"
      : "fail";

    const state = item.querySelector(".capability-state");
    if (state) {
      state.textContent = capability.supported
        ? "Ready"
        : capability.required
          ? "Unavailable"
          : "Optional unavailable";
    }
  }

  const progressBrowser = byId("progress-browser");
  if (progressBrowser instanceof HTMLElement) {
    progressBrowser.dataset.state = readiness.ready
      ? "pass"
      : "fail";
  }

  const browserStatus = byId("browser-status");
  if (browserStatus instanceof HTMLElement) {
    browserStatus.dataset.state = readiness.ready
      ? "pass"
      : "fail";

    if (!readiness.ready) {
      browserStatus.textContent =
        "Missing required capabilities: " +
        readiness.missingRequired
          .map((item) => item.label)
          .join(", ") +
        ".";
    } else if (readiness.unavailableOptional.length > 0) {
      browserStatus.textContent =
        "Core conferencing APIs are ready. Optional unavailable: " +
        readiness.unavailableOptional
          .map((item) => item.label)
          .join(", ") +
        ".";
    } else {
      browserStatus.textContent =
        "Core conferencing APIs are ready, including screen sharing.";
    }
  }

  const roomInput = byId("room-id");
  const roomOutput = byId("room-output");
  const roomNote = byId("room-note");
  const generateRoom = byId("generate-room");
  const copyRoom = byId("copy-room");
  const copyStatus = byId("copy-status");
  const progressRoom = byId("progress-room");
  const launch = byId("launch-verge");
  const openDevelopment = byId("open-development");
  const handoffStatus = byId("handoff-status");

  function setRoomGenerationError(): void {
    if (roomNote instanceof HTMLElement) {
      roomNote.dataset.state = "error";
      roomNote.textContent =
        "Secure room-code generation is unavailable in this browser.";
    }
  }

  function updateRoom(): void {
    if (!(roomInput instanceof HTMLInputElement)) return;

    const value = roomInput.value.trim();
    const valid = isValidRoomId(value);

    if (roomOutput) {
      roomOutput.textContent = valid ? value : "—";
    }

    if (roomNote instanceof HTMLElement) {
      roomNote.dataset.state =
        value.length > 0 && !valid ? "error" : "";
      roomNote.textContent = valid
        ? "Room code is ready."
        : value.length > 0
          ? "Use only letters, numbers, underscores, and hyphens."
          : "Letters, numbers, underscores, and hyphens; up to 64 characters.";
    }

    if (progressRoom instanceof HTMLElement) {
      progressRoom.dataset.state = valid ? "pass" : "";
    }

    try {
      if (valid) {
        sessionStorage.setItem("verge-room", value);
      } else {
        sessionStorage.removeItem("verge-room");
      }
    } catch {
      // Storage is an optional convenience, not state authority.
    }

    if (
      launch instanceof HTMLAnchorElement &&
      openDevelopment instanceof HTMLAnchorElement &&
      handoffStatus instanceof HTMLElement
    ) {
      if (configuredAppUrl && valid) {
        const target = new URL(
          configuredAppUrl,
          window.location.href
        );
        target.searchParams.set("room", value);
        launch.href = target.toString();
        launch.hidden = false;
        openDevelopment.hidden = true;
        handoffStatus.textContent =
          "Room code is ready to hand off to the configured Verge deployment.";
      } else if (configuredAppUrl) {
        launch.hidden = true;
        openDevelopment.hidden = true;
        handoffStatus.textContent =
          "Choose a valid room code before opening Verge.";
      } else {
        launch.hidden = true;
        openDevelopment.hidden = false;
      }
    }
  }

  if (roomInput instanceof HTMLInputElement) {
    const fromQuery =
      new URLSearchParams(window.location.search).get("room");
    let saved = "";

    try {
      saved = sessionStorage.getItem("verge-room") ?? "";
    } catch {
      saved = "";
    }

    const initial =
      fromQuery && isValidRoomId(fromQuery)
        ? fromQuery
        : saved && isValidRoomId(saved)
          ? saved
          : createRoomIdSafely();

    roomInput.value = initial ?? "";
    roomInput.addEventListener("input", updateRoom);
    updateRoom();

    if (!initial) {
      setRoomGenerationError();
    }
  }

  generateRoom?.addEventListener("click", () => {
    if (!(roomInput instanceof HTMLInputElement)) return;

    const nextRoom = createRoomIdSafely();
    if (!nextRoom) {
      setRoomGenerationError();
      return;
    }

    roomInput.value = nextRoom;
    updateRoom();
    roomInput.focus();
    roomInput.select();
  });

  copyRoom?.addEventListener("click", async () => {
    if (!(roomInput instanceof HTMLInputElement)) return;
    const value = roomInput.value.trim();
    if (!isValidRoomId(value)) return;

    try {
      await navigator.clipboard.writeText(value);
      if (copyStatus) {
        copyStatus.textContent = "Room code copied.";
      }
    } catch {
      roomInput.focus();
      roomInput.select();
      if (copyStatus) {
        copyStatus.textContent =
          "Clipboard access was unavailable. The room code is selected.";
      }
    }
  });

  const testDevices = byId("test-devices");
  const stopDevices = byId("stop-devices");
  const preview = byId("device-preview");
  const deviceStatus = byId("device-status");
  const progressDevices = byId("progress-devices");

  let previewStream: MediaStream | undefined;

  function stopPreview(): void {
    if (previewStream) {
      stopStream(previewStream);
      previewStream = undefined;
    }

    if (preview instanceof HTMLVideoElement) {
      preview.srcObject = null;
      preview.hidden = true;
    }

    if (stopDevices instanceof HTMLButtonElement) {
      stopDevices.disabled = true;
    }
  }

  testDevices?.addEventListener("click", async () => {
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !==
        "function"
    ) {
      if (deviceStatus instanceof HTMLElement) {
        deviceStatus.dataset.state = "error";
        deviceStatus.textContent =
          "Camera and microphone capture are not available in this browser.";
      }
      return;
    }

    stopPreview();

    if (deviceStatus instanceof HTMLElement) {
      deviceStatus.dataset.state = "";
      deviceStatus.textContent =
        "Waiting for browser permission…";
    }

    try {
      previewStream = await acquireLocalMedia({
        audioMode: "speech"
      });

      if (preview instanceof HTMLVideoElement) {
        preview.srcObject = previewStream;
        preview.hidden = false;
        await preview.play().catch(() => undefined);
      }

      if (stopDevices instanceof HTMLButtonElement) {
        stopDevices.disabled = false;
      }

      if (deviceStatus instanceof HTMLElement) {
        const videoTracks =
          previewStream.getVideoTracks().length;
        const audioTracks =
          previewStream.getAudioTracks().length;
        const cameraTrack =
          previewStream.getVideoTracks()[0];
        const blur = cameraTrack
          ? supportsNativeBackgroundBlur(cameraTrack)
          : false;
        deviceStatus.dataset.state = "";
        deviceStatus.textContent =
          "Ready: " +
          videoTracks +
          " camera track and " +
          audioTracks +
          " microphone track available. Native background blur: " +
          (blur ? "available." : "not exposed by this camera/browser.");
      }

      if (progressDevices instanceof HTMLElement) {
        progressDevices.dataset.state = "pass";
      }
    } catch (error) {
      if (deviceStatus instanceof HTMLElement) {
        const denied =
          error instanceof DOMException &&
          error.name === "NotAllowedError";
        deviceStatus.dataset.state = "error";
        deviceStatus.textContent = denied
          ? "Camera or microphone permission was denied. You can change site permissions in the browser and retry."
          : "The browser could not start the requested camera and microphone.";
      }
    }
  });

  stopDevices?.addEventListener("click", () => {
    stopPreview();
    if (deviceStatus instanceof HTMLElement) {
      deviceStatus.dataset.state = "";
      deviceStatus.textContent =
        "Device preview stopped. The readiness check remains complete.";
    }
  });

  window.addEventListener("pagehide", stopPreview);
}
