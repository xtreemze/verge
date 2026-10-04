import { describe, expect, it } from "vitest";
import {
  ROOM_ID_PATTERN,
  createRoomId,
  isValidRoomId,
  parseClientMessage
} from "./index";

describe("room identifiers", () => {
  it("creates a secure identifier within the canonical contract", () => {
    const roomId = createRoomId();

    expect(roomId).toHaveLength(32);
    expect(roomId).toMatch(ROOM_ID_PATTERN);
    expect(isValidRoomId(roomId)).toBe(true);
  });
});

describe("parseClientMessage", () => {
  it("accepts and normalizes a valid join", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "room_42",
        displayName: "  Carlos  "
      })
    ).toEqual({
      type: "join",
      roomId: "room_42",
      displayName: "Carlos"
    });
  });

  it("accepts a bounded invitation token on join", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "room_42",
        displayName: "Carlos",
        invite: "v1.payload.signature"
      })
    ).toEqual({
      type: "join",
      roomId: "room_42",
      displayName: "Carlos",
      invite: "v1.payload.signature"
    });
  });

  it("rejects oversized invitation tokens", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "room_42",
        displayName: "Carlos",
        invite: "x".repeat(4_097)
      })
    ).toBeUndefined();
  });

  it("rejects unknown fields", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "room",
        displayName: "Carlos",
        admin: true
      })
    ).toBeUndefined();
  });

  it("rejects malformed room and peer identifiers", () => {
    expect(
      parseClientMessage({
        type: "join",
        roomId: "../room",
        displayName: "Carlos"
      })
    ).toBeUndefined();

    expect(
      parseClientMessage({
        type: "signal",
        to: "../../peer",
        candidate: {
          candidate: "",
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null
        }
      })
    ).toBeUndefined();
  });

  it("rejects oversized SDP", () => {
    expect(
      parseClientMessage({
        type: "signal",
        to: "78025973-d945-4b73-a8bd-c718356e0197",
        description: {
          type: "offer",
          sdp: "x".repeat(220_001)
        }
      })
    ).toBeUndefined();
  });

  it("accepts bounded ICE candidates", () => {
    expect(
      parseClientMessage({
        type: "signal",
        to: "78025973-d945-4b73-a8bd-c718356e0197",
        candidate: {
          candidate:
            "candidate:1 1 UDP 1 192.0.2.1 3478 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "abc"
        }
      })
    ).toEqual({
      type: "signal",
      to: "78025973-d945-4b73-a8bd-c718356e0197",
      candidate: {
        candidate:
          "candidate:1 1 UDP 1 192.0.2.1 3478 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
        usernameFragment: "abc"
      }
    });
  });

  it("requires signal content and exact leave shape", () => {
    expect(
      parseClientMessage({
        type: "signal",
        to: "78025973-d945-4b73-a8bd-c718356e0197"
      })
    ).toBeUndefined();

    expect(
      parseClientMessage({ type: "leave" })
    ).toEqual({ type: "leave" });
    expect(
      parseClientMessage({
        type: "leave",
        reason: "bye"
      })
    ).toBeUndefined();
  });
});
