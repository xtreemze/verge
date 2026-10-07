import { describe, expect, it, vi } from "vitest";
import {
  CONFERENCE_PRESENTATION_COMMAND_EVENT,
  CONFERENCE_PRESENTATION_STATE_EVENT,
  createConferenceProjectSiteAdapter,
  type ConferencePresentationSnapshot,
  type ConferencePresentationSource,
} from "./presentation";

const snapshot: ConferencePresentationSnapshot = {
  topology: "mesh",
  capabilities: {
    topology: "mesh",
    directPeerMedia: true,
    selectiveSubscription: false,
    simulcast: false,
    svc: false,
    dataChannels: true,
  },
  peers: [],
  messages: [],
  files: [],
  transfers: [],
  status: "connected",
};

function createSource(): ConferencePresentationSource & {
  emit(): void;
  unsubscribe: ReturnType<typeof vi.fn>;
  sendChat: ReturnType<typeof vi.fn>;
} {
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const sendChat = vi.fn(() => ({ id: "message-1" }) as never);
  return {
    getSnapshot: () => snapshot,
    subscribe(next) {
      listener = next;
      return unsubscribe;
    },
    sendChat,
    sendFile: vi.fn(async () => undefined),
    cancelFileTransfer: vi.fn(),
    replaceVideoTrack: vi.fn(async () => undefined),
    replaceAudioTrack: vi.fn(async () => undefined),
    emit() {
      listener?.();
    },
    unsubscribe,
  };
}

describe("conference project-site adapter", () => {
  it("projects snapshots without owning conference lifecycle", () => {
    const source = createSource();
    const host = new EventTarget() as HTMLElement;
    const controller = new AbortController();
    const states: ConferencePresentationSnapshot[] = [];
    host.addEventListener(CONFERENCE_PRESENTATION_STATE_EVENT, (event) => {
      states.push((event as CustomEvent<ConferencePresentationSnapshot>).detail);
    });

    const cleanup = createConferenceProjectSiteAdapter(source).mount({
      host,
      signal: controller.signal,
    });

    expect(typeof cleanup).toBe("function");
    expect(states).toEqual([snapshot]);

    source.emit();
    expect(states).toEqual([snapshot, snapshot]);

    controller.abort();
    source.emit();
    expect(states).toEqual([snapshot, snapshot]);
    expect(source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("delegates bounded commands to the injected source", async () => {
    const source = createSource();
    const host = new EventTarget() as HTMLElement;
    const controller = new AbortController();
    createConferenceProjectSiteAdapter(source).mount({
      host,
      signal: controller.signal,
    });

    host.dispatchEvent(
      new CustomEvent(CONFERENCE_PRESENTATION_COMMAND_EVENT, {
        detail: { type: "send-chat", text: "hello" },
      }),
    );

    await Promise.resolve();
    expect(source.sendChat).toHaveBeenCalledWith("hello");
  });

  it("does not expose start, close, room creation, signaling, or device acquisition", async () => {
    const source = await import("./presentation");
    const text = JSON.stringify(Object.keys(source));

    expect(text).not.toContain("createConferenceTransport");
    expect(text).not.toContain("start");
    expect(text).not.toContain("close");
    expect(text).not.toContain("getUserMedia");
  });
});
