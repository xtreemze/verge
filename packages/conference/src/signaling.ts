import type { ClientMessage, ServerMessage } from "@verge/protocol";
import { signalingReconnectDelay } from "./reconnect-policy";

export interface SignalingLifecycleEvents {
  onDisconnected?(): void;
  onReconnected?(): void;
}

interface ActiveSession {
  roomId: string;
  displayName: string;
}

export class SignalingClient {
  #socket: WebSocket | undefined;
  #session: ActiveSession | undefined;
  #closedByUser = false;
  #hasConnected = false;
  #disconnected = false;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly lifecycle: SignalingLifecycleEvents = {}
  ) {}

  async connect(roomId: string, displayName: string): Promise<void> {
    this.#closedByUser = false;
    this.#session = { roomId, displayName };
    await this.#openSocket();
  }

  send(message: ClientMessage): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }

  close(): void {
    this.#closedByUser = true;
    this.#session = undefined;
    this.#clearReconnectTimer();

    const socket = this.#socket;
    this.#socket = undefined;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "leave" } satisfies ClientMessage));
    }
    socket?.close();
  }

  async #openSocket(): Promise<void> {
    const session = this.#session;
    if (!session || this.#closedByUser) return;

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.#socket = socket;
      let opened = false;

      socket.onopen = () => {
        if (this.#socket !== socket || this.#closedByUser) {
          socket.close();
          return;
        }

        opened = true;
        const wasDisconnected = this.#disconnected;
        this.#hasConnected = true;
        this.#disconnected = false;
        this.#reconnectAttempt = 0;

        socket.send(
          JSON.stringify({
            type: "join",
            roomId: session.roomId,
            displayName: session.displayName
          } satisfies ClientMessage)
        );

        if (wasDisconnected) {
          this.lifecycle.onReconnected?.();
        }
        resolve();
      };

      socket.onerror = () => {
        if (!opened) {
          reject(new Error("Signaling connection failed"));
        }
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          this.onMessage(JSON.parse(event.data) as ServerMessage);
        } catch {
          // Ignore malformed signaling payloads.
        }
      };

      socket.onclose = () => {
        if (this.#socket === socket) {
          this.#socket = undefined;
        }

        if (!opened && !this.#hasConnected) {
          reject(new Error("Signaling connection failed"));
          return;
        }

        if (
          this.#closedByUser ||
          !this.#session ||
          !this.#hasConnected
        ) {
          return;
        }

        if (!this.#disconnected) {
          this.#disconnected = true;
          this.lifecycle.onDisconnected?.();
        }
        this.#scheduleReconnect();
      };
    });
  }

  #scheduleReconnect(): void {
    if (
      this.#closedByUser ||
      !this.#session ||
      this.#reconnectTimer
    ) {
      return;
    }

    const delay = signalingReconnectDelay(this.#reconnectAttempt);
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#openSocket().catch(() => {
        this.#scheduleReconnect();
      });
    }, delay);
  }

  #clearReconnectTimer(): void {
    if (!this.#reconnectTimer) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }
}
