import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  parseClientMessage,
  type ClientMessage,
  type PeerSummary,
  type ServerMessage
} from "@verge/protocol";
import { WebSocket, WebSocketServer } from "ws";
import {
  createSignalingOriginPolicy,
  isSignalingOriginAllowed
} from "./origin-policy.ts";
import { consumeFixedWindow } from "./rate-limit.ts";
import {
  createRoomInvite,
  inviteAuthOptionsFromEnv,
  verifyRoomInvite
} from "./room-invites.ts";
import {
  createIceConfiguration,
  turnCredentialOptionsFromEnv
} from "./turn-credentials.ts";

interface ClientContext {
  id: string;
  displayName?: string;
  roomId?: string;
  windowStartedAt: number;
  messagesInWindow: number;
  lastActivityAt: number;
  authWindowStartedAt: number;
  authFailuresInWindow: number;
}

function positiveIntegerEnv(
  name: string,
  fallback: number
): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

const port = positiveIntegerEnv("PORT", 8787);
const maxRoomSize = positiveIntegerEnv(
  "VERGE_MAX_ROOM_SIZE",
  8
);
const rateWindowMs = positiveIntegerEnv(
  "VERGE_SIGNAL_RATE_WINDOW_MS",
  10_000
);
const maxMessagesPerWindow = positiveIntegerEnv(
  "VERGE_SIGNAL_MAX_MESSAGES_PER_WINDOW",
  120
);
const idleTimeoutMs = positiveIntegerEnv(
  "VERGE_SIGNAL_IDLE_TIMEOUT_MS",
  30 * 60_000
);
const sweepIntervalMs = positiveIntegerEnv(
  "VERGE_SIGNAL_SWEEP_INTERVAL_MS",
  60_000
);
const authFailureWindowMs = positiveIntegerEnv(
  "VERGE_AUTH_FAILURE_WINDOW_MS",
  60_000
);
const maxAuthFailuresPerWindow = positiveIntegerEnv(
  "VERGE_AUTH_MAX_FAILURES",
  8
);

const production = process.env.NODE_ENV === "production";
const originPolicy = createSignalingOriginPolicy(
  process.env.VERGE_ALLOWED_ORIGINS,
  production
);
const inviteAuthOptions = inviteAuthOptionsFromEnv(
  process.env,
  production
);
const turnOptions = turnCredentialOptionsFromEnv(process.env);

const rooms = new Map<string, Map<string, WebSocket>>();
const clients = new WeakMap<WebSocket, ClientContext>();
const connections = new Set<WebSocket>();

function requestOrigin(request: IncomingMessage): string | undefined {
  const origin = request.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
}

function requestPath(request: IncomingMessage): string {
  return new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`
  ).pathname;
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

const httpServer = createServer((request, response) => {
  const path = requestPath(request);

  if (request.method === "GET" && path === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method === "GET" && path === "/api/ice") {
    const origin = requestOrigin(request);
    if (
      origin &&
      !isSignalingOriginAllowed(origin, originPolicy)
    ) {
      sendJson(response, 403, { error: "Origin is not allowed." });
      return;
    }

    if (!turnOptions) {
      sendJson(response, 503, {
        error: "ICE credential service is not configured."
      });
      return;
    }

    sendJson(response, 200, createIceConfiguration(turnOptions));
    return;
  }

  if (request.method === "POST" && path === "/api/rooms") {
    const origin = requestOrigin(request);
    if (
      origin &&
      !isSignalingOriginAllowed(origin, originPolicy)
    ) {
      sendJson(response, 403, { error: "Origin is not allowed." });
      return;
    }

    if (!inviteAuthOptions) {
      sendJson(response, 404, { error: "Room invitations are disabled." });
      return;
    }

    const roomId = randomBytes(16).toString("hex");
    const created = createRoomInvite(
      roomId,
      inviteAuthOptions
    );
    sendJson(response, 201, {
      roomId,
      invite: created.token,
      expiresAt: new Date(
        created.payload.expiresAt * 1_000
      ).toISOString()
    });
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

const server = new WebSocketServer({
  noServer: true,
  maxPayload: 256 * 1024
});

httpServer.on("upgrade", (request, socket, head) => {
  const path = requestPath(request);
  if (path !== "/" && path !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (
    !isSignalingOriginAllowed(
      requestOrigin(request),
      originPolicy
    )
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  server.handleUpgrade(request, socket, head, (webSocket) => {
    server.emit("connection", webSocket, request);
  });
});

function send(
  socket: WebSocket,
  message: ServerMessage
): void {
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

function recordAuthFailure(
  context: ClientContext,
  now: number
): boolean {
  if (
    now - context.authWindowStartedAt >=
    authFailureWindowMs
  ) {
    context.authWindowStartedAt = now;
    context.authFailuresInWindow = 0;
  }

  context.authFailuresInWindow += 1;
  return (
    context.authFailuresInWindow <=
    maxAuthFailuresPerWindow
  );
}

function broadcast(
  roomId: string,
  message: ServerMessage,
  exceptId?: string
): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [id, socket] of room) {
    if (id !== exceptId) {
      send(socket, message);
    }
  }
}

function leaveRoom(socket: WebSocket): void {
  const context = clients.get(socket);
  if (!context?.roomId) return;

  const roomId = context.roomId;
  const room = rooms.get(roomId);
  room?.delete(context.id);
  if (room?.size === 0) {
    rooms.delete(roomId);
  }

  delete context.roomId;
  broadcast(roomId, {
    type: "peer-left",
    peerId: context.id
  });
}

function joinRoom(
  socket: WebSocket,
  context: ClientContext,
  roomId: string,
  displayName: string,
  invite: string | undefined
): void {
  if (inviteAuthOptions) {
    const verified =
      typeof invite === "string"
        ? verifyRoomInvite(
            invite,
            roomId,
            inviteAuthOptions
          )
        : { ok: false as const, reason: "malformed" as const };

    if (!verified.ok) {
      const withinBudget = recordAuthFailure(
        context,
        Date.now()
      );
      send(socket, {
        type: "error",
        message:
          "Room invitation is invalid or expired."
      });
      if (!withinBudget) {
        socket.close(
          1008,
          "Too many failed room authorization attempts"
        );
      }
      return;
    }
  }

  leaveRoom(socket);

  const room =
    rooms.get(roomId) ??
    new Map<string, WebSocket>();

  if (room.size >= maxRoomSize) {
    send(socket, {
      type: "error",
      message: "Room is full."
    });
    return;
  }

  const peers = Array.from(room.keys(), (id) => {
    const peerSocket = room.get(id);
    const peerContext = peerSocket
      ? clients.get(peerSocket)
      : undefined;
    return {
      id,
      displayName: peerContext?.displayName ?? "Peer"
    };
  });

  context.roomId = roomId;
  context.displayName = displayName;
  room.set(context.id, socket);
  rooms.set(roomId, room);

  send(socket, {
    type: "welcome",
    selfId: context.id,
    peers
  });
  broadcast(
    roomId,
    {
      type: "peer-joined",
      peer: peerFrom(context)
    },
    context.id
  );
}

function forwardSignal(
  context: ClientContext,
  message: Extract<ClientMessage, { type: "signal" }>
): void {
  if (!context.roomId) return;

  const target = rooms
    .get(context.roomId)
    ?.get(message.to);
  if (!target) return;

  send(target, {
    type: "signal",
    from: peerFrom(context),
    ...(message.description
      ? { description: message.description }
      : {}),
    ...(message.candidate
      ? { candidate: message.candidate }
      : {})
  });
}

server.on("connection", (socket) => {
  const now = Date.now();
  const context: ClientContext = {
    id: randomUUID(),
    windowStartedAt: now,
    messagesInWindow: 0,
    lastActivityAt: now,
    authWindowStartedAt: now,
    authFailuresInWindow: 0
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
      send(socket, {
        type: "error",
        message: "Signaling rate limit exceeded."
      });
      socket.close(1008, "Rate limit exceeded");
      return;
    }

    if (isBinary) {
      send(socket, {
        type: "error",
        message: "Invalid signaling message."
      });
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      send(socket, {
        type: "error",
        message: "Invalid signaling message."
      });
      return;
    }

    const message = parseClientMessage(raw);
    if (!message) {
      send(socket, {
        type: "error",
        message: "Invalid signaling message."
      });
      return;
    }

    switch (message.type) {
      case "join":
        joinRoom(
          socket,
          context,
          message.roomId,
          message.displayName
        );
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
    if (
      context &&
      context.lastActivityAt < cutoff
    ) {
      socket.close(1001, "Idle timeout");
    }
  }
}, sweepIntervalMs);
sweepTimer.unref();

server.on("close", () => {
  clearInterval(sweepTimer);
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(
    `Verge signaling/control plane listening on http://0.0.0.0:${port}`
  );
});
