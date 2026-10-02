import type { ClientMessage, ServerMessage } from "@verge/protocol";

export class SignalingClient {
  #socket: WebSocket | undefined;

  constructor(
    private readonly url: string,
    private readonly onMessage: (message: ServerMessage) => void
  ) {}

  async connect(roomId: string, displayName: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.#socket = socket;
      socket.onopen = () => {
        this.send({ type: "join", roomId, displayName });
        resolve();
      };
      socket.onerror = () => reject(new Error("Signaling connection failed"));
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          this.onMessage(JSON.parse(event.data) as ServerMessage);
        } catch {
          // Ignore malformed signaling payloads.
        }
      };
    });
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }

  close(): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "leave" });
    }
    this.#socket?.close();
  }
}
