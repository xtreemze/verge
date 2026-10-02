import { randomUUID } from "node:crypto";
import {
  parseClientMessage,
  type ClientMessage,
  type PeerSummary,
  type ServerMessage
} from "@verge/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { consumeFixedWindow } from "./rate-limit.js";

interface ClientContext {
  id: string;
  displayName?: string;
  roomId?: string;
  windowStartedAt: number;
  messagesInWindow: number;
  lastActivityAt: number;
}

const port = Number(process.env.PORT ?? 8787);
const maxRoomSize = Number(process.env.VERGE_MAX_ROOM_SIZE ?? 8);
const rateWindowMs = Number(process.env.VERGE_SIGNAL_RATE_WINDOW_MS ?? 10_000);
const maxMessagesPerWindow = Number(
  process.env.VERGE_SIGNAL_MAX_MESSAGES_PER_WINDOW ?? 120
);
const idleTimeoutMs = Number(
  process.env.VERGE_SIGNAL_IDLE_TIMEOUT_MS ?? 30 * 60_000
);
const sweepIntervalMs = Number(
  process.env.VERGE_SIGNAL_SWEEP_INTERVAL_MS ?? 60_000
);

const rooms = new Map<string, Map<string, WebSocket>>();
const clients = new WeakMap<WebSocket, ClientContext>();
const connections = new Set<WebSocket>();

const server = new WebSocketServer({
  port,
  maxPayload: 256 * 1024
});

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function peerFrom(context: ClientContext): PeerSummary {
  return {
    id: context.id,
    displayName: context.displayName ?? "Peer"
  };
}

function broadcast(
  roomId: string,
  message: ServerMessage,
  exceptId?: string
): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [id, socket] of room) {
    if (id !== exceptId) send(socket, message);
  }
}

function leaveRoom(socket: WebSocket): void {
  const context = clients.get(socket);
  if (!context?.roomId) return;

  const roomId = context.roomId;
  const room = rooms.get(roomId);
  room?.delete(context.id);
  if (room?.size === 0) rooms.delete(roomId);

  delete context.roomId;
  broadcast(roomId, { type: "peer-left", peerId: context.id });
}

function joinRoom(
  socket: WebSocket,
  context: ClientContext,
  roomId: string,
  displayName: string
): void {
  leaveRoom(socket);
  const room = rooms.get(roomId) ?? new Map<string, WebSocket>();
  if (room.size >= maxRoomSize) {
    send(socket, { type: "error", message: "Room is full." });
    return;
  }

  const peers = Array.from(room.keys(), (id) => {
    const peerSocket = room.get(id);
    const peerContext = peerSocket ? clients.get(peerSocket) : undefined;
    return { id, displayName: peerContext?.displayName ?? "Peer" };
  });

  context.roomId = roomId;
  context.displayName = displayName;
  room.set(context.id, socket);
  rooms.set(roomId, room);

  send(socket, { type: "welcome", selfId: context.id, peers });
  broadcast(
    roomId,
    { type: "peer-joined", peer: peerFrom(context) },
    context.id
  );
}

function forwardSignal(
  context: ClientContext,
  message: Extract<ClientMessage, { type: "signal" }>
): void {
  if (!context.roomId) return;
  const target = rooms.get(context.roomId)?.get(message.to);
  if (!target) return;

  send(target, {
    type: "signal",
    from: peerFrom(context),
    ...(message.description ? { description: message.description } : {}),
    ...(message.candidate ? { candidate: message.candidate } : {})
  });
}

server.on("connection", (socket) => {
  const now = Date.now();
  const context: ClientContext = {
    id: randomUUID(),
    windowStartedAt: now,
    messagesInWindow: 0,
    lastActivityAt: now
  };
  clients.set(socket, context);
  connections.add(socket);

  socket.on("message", (data, isBinary) => {
    const messageTime = Date.now();
    context.lastActivityAt = messageTime;

    if (
      !consumeFixedWindow(
        context,
        messageTime,
        rateWindowMs,
        maxMessagesPerWindow
      )
    ) {
      send(socket, { type: "error", message: "Signaling rate limit exceeded." });
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    if (isBinary) {
      send(socket, { type: "error", message: "Invalid signaling message." });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", message: "Invalid signaling message." });
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      send(socket, { type: "error", message: "Invalid signaling message." });
      return;
    }

    switch (message.type) {
      case "join":
        joinRoom(socket, context, message.roomId, message.displayName);
        break;
      case "signal":
        forwardSignal(context, message);
        break;
      case "leave":
        leaveRoom(socket);
        break;
    }
  });

  socket.on("close", () => {
    connections.delete(socket);
    leaveRoom(socket);
  });
});

const sweepTimer = setInterval(() => {
  const cutoff = Date.now() - idleTimeoutMs;
  for (const socket of connections) {
    const context = clients.get(socket);
    if (context && context.lastActivityAt < cutoff) {
      socket.close(1001, "Idle timeout");
    }
  }
}, sweepIntervalMs);
sweepTimer.unref();

server.on("close", () => clearInterval(sweepTimer));

console.log(`Verge signaling listening on ws://localhost:${port}`);
