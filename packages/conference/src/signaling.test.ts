import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalingClient } from "./signaling";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  networkClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
}

describe("SignalingClient", () => {
  const realWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    globalThis.WebSocket =
      FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = realWebSocket;
  });

  it("rejoins the same room after a transient socket disconnect", async () => {
    const disconnected = vi.fn();
    const reconnected = vi.fn();
    const client = new SignalingClient(
      "ws://signal.test/ws",
      () => undefined,
      { onDisconnected: disconnected, onReconnected: reconnected }
    );

    const connecting = client.connect("room-abc", "Alice");
    const first = FakeWebSocket.instances[0]!;
    first.open();
    await connecting;

    expect(JSON.parse(first.sent[0]!)).toEqual({
      type: "join",
      roomId: "room-abc",
      displayName: "Alice"
    });

    first.networkClose();
    expect(disconnected).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeWebSocket.instances[1]!;
    expect(second).toBeDefined();

    second.open();
    await Promise.resolve();

    expect(JSON.parse(second.sent[0]!)).toEqual({
      type: "join",
      roomId: "room-abc",
      displayName: "Alice"
    });
    expect(reconnected).toHaveBeenCalledTimes(1);

    client.close();
  });

  it("does not reconnect after an explicit close", async () => {
    const client = new SignalingClient(
      "ws://signal.test/ws",
      () => undefined
    );

    const connecting = client.connect("room-abc", "Alice");
    const first = FakeWebSocket.instances[0]!;
    first.open();
    await connecting;

    client.close();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
