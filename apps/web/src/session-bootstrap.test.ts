import { describe, expect, it } from "vitest";
import { isValidRoomId } from "@verge/protocol";
import { sessionBootstrap } from "./session-bootstrap";

describe("sessionBootstrap", () => {
  it("preserves a valid shared room, invite, and display name", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    expect(
      sessionBootstrap(
        `?room=${roomId}&invite=v1.payload.signature&name=%20Phone%20A%20&debug=1`
      )
    ).toEqual({
      roomId,
      displayName: "Phone A",
      invite: "v1.payload.signature",
      requestedRoom: true,
      debug: true
    });
  });

  it("replaces missing or malformed room identifiers", () => {
    const generated = sessionBootstrap("?room=contains%20spaces");
    expect(isValidRoomId(generated.roomId)).toBe(true);
    expect(generated.roomId).toHaveLength(32);
    expect(generated.requestedRoom).toBe(false);
    expect(generated.invite).toBe("");
  });

  it("drops oversized invitation tokens", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    const result = sessionBootstrap(
      `?room=${roomId}&invite=${"x".repeat(4_097)}`
    );
    expect(result.invite).toBe("");
    expect(result.requestedRoom).toBe(true);
  });
});
