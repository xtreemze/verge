import { createRoomId, isValidRoomId } from "@verge/protocol";

export interface SessionBootstrap {
  roomId: string;
  displayName: string;
  debug: boolean;
}

export function sessionBootstrap(search: string): SessionBootstrap {
  const params = new URLSearchParams(search);
  const requestedRoom = params.get("room")?.trim() ?? "";
  const displayName = params.get("name")?.trim() ?? "";

  return {
    roomId: isValidRoomId(requestedRoom) ? requestedRoom : createRoomId(),
    displayName,
    debug: params.get("debug") === "1"
  };
}
