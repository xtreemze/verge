import {
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { isValidRoomId } from "@verge/protocol";

export interface InviteAuthOptions {
  sharedSecret: string;
  ttlSeconds: number;
}

export interface RoomInvitePayload {
  version: 1;
  roomId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export type RoomInviteVerification =
  | { ok: true; payload: RoomInvitePayload }
  | {
      ok: false;
      reason:
        | "malformed"
        | "invalid-signature"
        | "room-mismatch"
        | "expired";
    };

function positiveInteger(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invitation TTL must be a positive integer.");
  }
  return value;
}

export function inviteAuthOptionsFromEnv(
  env: NodeJS.ProcessEnv,
  production: boolean
): InviteAuthOptions | undefined {
  const sharedSecret =
    env.VERGE_INVITE_SHARED_SECRET?.trim() ?? "";

  if (!sharedSecret) {
    if (production) {
      throw new Error(
        "VERGE_INVITE_SHARED_SECRET is required in production."
      );
    }
    return undefined;
  }

  if (sharedSecret.length < 32) {
    throw new Error(
      "VERGE_INVITE_SHARED_SECRET must be at least 32 characters."
    );
  }

  return {
    sharedSecret,
    ttlSeconds: positiveInteger(
      env.VERGE_INVITE_TTL_SECONDS,
      24 * 60 * 60
    )
  };
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(
  signingInput: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");
}

function isPayload(value: unknown): value is RoomInvitePayload {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 5 ||
    record.version !== 1 ||
    typeof record.roomId !== "string" ||
    !isValidRoomId(record.roomId) ||
    typeof record.issuedAt !== "number" ||
    !Number.isSafeInteger(record.issuedAt) ||
    typeof record.expiresAt !== "number" ||
    !Number.isSafeInteger(record.expiresAt) ||
    record.expiresAt <= record.issuedAt ||
    typeof record.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(record.nonce)
  ) {
    return false;
  }

  return true;
}

export function createRoomInvite(
  roomId: string,
  options: InviteAuthOptions,
  nowMs = Date.now(),
  nonce = randomBytes(18).toString("base64url")
): {
  token: string;
  payload: RoomInvitePayload;
} {
  if (!isValidRoomId(roomId)) {
    throw new Error("Cannot create an invite for an invalid room.");
  }

  const issuedAt = Math.floor(nowMs / 1_000);
  const payload: RoomInvitePayload = {
    version: 1,
    roomId,
    issuedAt,
    expiresAt: issuedAt + options.ttlSeconds,
    nonce
  };
  const encodedPayload = base64UrlEncode(
    JSON.stringify(payload)
  );
  const signingInput = `v1.${encodedPayload}`;
  return {
    token: `${signingInput}.${signature(
      signingInput,
      options.sharedSecret
    )}`,
    payload
  };
}

export function verifyRoomInvite(
  token: string,
  expectedRoomId: string,
  options: InviteAuthOptions,
  nowMs = Date.now()
): RoomInviteVerification {
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "v1" ||
    !parts[1] ||
    !parts[2]
  ) {
    return { ok: false, reason: "malformed" };
  }

  const signingInput = `v1.${parts[1]}`;
  const expectedSignature = signature(
    signingInput,
    options.sharedSecret
  );
  const actual = Buffer.from(parts[2], "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return { ok: false, reason: "invalid-signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(parts[1]));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!isPayload(payload)) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.roomId !== expectedRoomId) {
    return { ok: false, reason: "room-mismatch" };
  }

  if (payload.expiresAt <= Math.floor(nowMs / 1_000)) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, payload };
}
