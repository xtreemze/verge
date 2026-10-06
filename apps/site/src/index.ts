import {
  PREFERRED_AUDIO_MIME_TYPES,
  PREFERRED_VIDEO_MIME_TYPES,
  codecDisplayName,
} from "@verge/webrtc/codec-policy";

const LUUM_EMBED_URL = "https://xtreemze.github.io/timeline/embed/luum-embed.js";

function codecPolicyNote(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "video/av1":
    case "video/vp9":
      return "preferred when the browser exposes it";
    case "video/h265":
      return "used when the platform exposes HEVC";
    case "video/h264":
      return "broad compatibility path";
    case "video/vp8":
      return "compatibility fallback";
    case "audio/opus":
      return "preferred audio codec";
    default:
      return "runtime capability";
  }
}

function renderCodecPolicy(): void {
  const list = document.querySelector<HTMLUListElement>("#codec-list");
  if (!list) return;

  const policy = [
    ...PREFERRED_VIDEO_MIME_TYPES,
    ...PREFERRED_AUDIO_MIME_TYPES,
  ];

  list.replaceChildren(
    ...policy.map((mimeType) => {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      const note = document.createElement("span");
      label.textContent = codecDisplayName(mimeType);
      note.textContent = codecPolicyNote(mimeType);
      item.append(label, note);
      return item;
    }),
  );
}

type LuumGraphElement = HTMLElement & {
  nodes: readonly {
    id: string;
    label: string;
    detail?: string;
    color?: string;
    position?: Readonly<{ x: number; y: number }>;
  }[];
  edges: readonly {
    id: string;
    sourceId: string;
    targetId: string;
    label?: string;
    color?: string;
  }[];
};

async function upgradeArchitectureGraph(): Promise<void> {
  const graph = document.querySelector<LuumGraphElement>("#verge-architecture-graph");
  const fallback = document.querySelector<HTMLElement>("[data-luum-architecture-fallback]");
  if (!graph || !fallback) return;

  try {
    await import(/* @vite-ignore */ LUUM_EMBED_URL);
    await customElements.whenDefined("luum-embed-graph");

    graph.nodes = [
      { id: "capture", label: "Capture", detail: "camera · microphone · display", color: "#9bc2ff", position: { x: 18, y: 50 } },
      { id: "rendezvous", label: "Rendezvous", detail: "auth · SDP/ICE · TURN", color: "#ffd38a", position: { x: 50, y: 24 } },
      { id: "transport", label: "Peer transport", detail: "SRTP · data channels", color: "#9be2bd", position: { x: 82, y: 50 } },
      { id: "chat", label: "Chat", detail: "ordered data channel", color: "#d8beff", position: { x: 62, y: 80 } },
      { id: "files", label: "Files", detail: "chunked · SHA-256 verified", color: "#ffaaa5", position: { x: 38, y: 80 } },
    ];
    graph.edges = [
      { id: "capture-signal", sourceId: "capture", targetId: "rendezvous", label: "signal" },
      { id: "signal-transport", sourceId: "rendezvous", targetId: "transport", label: "negotiate" },
      { id: "capture-transport", sourceId: "capture", targetId: "transport", label: "media" },
      { id: "transport-chat", sourceId: "transport", targetId: "chat", label: "data" },
      { id: "transport-files", sourceId: "transport", targetId: "files", label: "data" },
    ];

    graph.hidden = false;
    fallback.hidden = true;
  } catch {
    graph.hidden = true;
    fallback.hidden = false;
  }
}

renderCodecPolicy();
void upgradeArchitectureGraph();
