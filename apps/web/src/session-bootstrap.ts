import { createRoomId, isValidRoomId } from "@verge/protocol";

export interface SessionBootstrap {
  roomId: string;
  displayName: string;
  invite: string;
  requestedRoom: boolean;
  debug: boolean;
}

export function sessionBootstrap(search: string): SessionBootstrap {
  const params = new URLSearchParams(search);
  const requestedRoom = params.get("room")?.trim() ?? "";
  const validRequestedRoom = isValidRoomId(requestedRoom);
  const displayName = params.get("name")?.trim() ?? "";
  const rawInvite = params.get("invite")?.trim() ?? "";
  const invite =
    rawInvite.length > 0 && rawInvite.length <= 4_096
      ? rawInvite
      : "";

  return {
    roomId: validRequestedRoom ? requestedRoom : createRoomId(),
    displayName,
    invite,
    requestedRoom: validRequestedRoom,
    debug: params.get("debug") === "1"
  };
}
