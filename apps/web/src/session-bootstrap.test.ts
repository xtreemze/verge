import { describe, expect, it } from "vitest";
import { isValidRoomId } from "@verge/protocol";
import { sessionBootstrap } from "./session-bootstrap";

describe("sessionBootstrap", () => {
  it("preserves a valid shared room and trims the display name", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    expect(
      sessionBootstrap(`?room=${roomId}&name=%20Phone%20A%20&debug=1`)
    ).toEqual({
      roomId,
      displayName: "Phone A",
      debug: true
    });
  });

  it("replaces missing or malformed room identifiers", () => {
    const generated = sessionBootstrap("?room=too-short");
    expect(isValidRoomId(generated.roomId)).toBe(true);
    expect(generated.roomId).toHaveLength(32);
  });
});
