import { isValidRoomId } from "@verge/protocol";

export interface CreatedProtectedRoom {
  roomId: string;
  invite: string;
  expiresAt: string;
}

export function roomInviteEndpoint(): string | undefined {
  const configured = import.meta.env.VITE_ROOM_INVITE_URL as
    | string
    | undefined;
  return configured?.trim() || undefined;
}

function isCreatedProtectedRoom(
  value: unknown
): value is CreatedProtectedRoom {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.roomId === "string" &&
    isValidRoomId(record.roomId) &&
    typeof record.invite === "string" &&
    record.invite.length > 0 &&
    record.invite.length <= 4_096 &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt))
  );
}

export async function createProtectedRoom(
  endpoint: string
): Promise<CreatedProtectedRoom> {
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Unable to create a protected room.");
  }

  const value: unknown = await response.json();
  if (!isCreatedProtectedRoom(value)) {
    throw new Error("Room invitation service returned invalid data.");
  }

  return value;
}
