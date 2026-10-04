import { describe, expect, it } from "vitest";
import {
  createRoomInvite,
  inviteAuthOptionsFromEnv,
  verifyRoomInvite
} from "./room-invites.ts";

const options = {
  sharedSecret:
    "0123456789abcdef0123456789abcdef",
  ttlSeconds: 600
};

describe("room invitations", () => {
  it("binds a signed invitation to its room", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    const { token } = createRoomInvite(
      roomId,
      options,
      1_700_000_000_000,
      "0123456789abcdef"
    );

    expect(
      verifyRoomInvite(
        token,
        roomId,
        options,
        1_700_000_100_000
      )
    ).toMatchObject({ ok: true });

    expect(
      verifyRoomInvite(
        token,
        "fedcba9876543210fedcba9876543210",
        options,
        1_700_000_100_000
      )
    ).toEqual({
      ok: false,
      reason: "room-mismatch"
    });
  });

  it("rejects expired and tampered invitations", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    const { token } = createRoomInvite(
      roomId,
      options,
      1_700_000_000_000,
      "0123456789abcdef"
    );

    expect(
      verifyRoomInvite(
        token,
        roomId,
        options,
        1_700_000_601_000
      )
    ).toEqual({ ok: false, reason: "expired" });

    expect(
      verifyRoomInvite(
        `${token}x`,
        roomId,
        options,
        1_700_000_100_000
      )
    ).toEqual({
      ok: false,
      reason: "invalid-signature"
    });
  });

  it("handles invite replay as intentional multi-participant reuse until expiry", () => {
    const roomId = "0123456789abcdef0123456789abcdef";
    const { token } = createRoomInvite(
      roomId,
      options,
      1_700_000_000_000,
      "0123456789abcdef"
    );

    const first = verifyRoomInvite(
      token,
      roomId,
      options,
      1_700_000_100_000
    );
    const replay = verifyRoomInvite(
      token,
      roomId,
      options,
      1_700_000_200_000
    );

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
  });

  it("rejects malformed tokens and unsafe production configuration", () => {
    expect(
      verifyRoomInvite(
        "not-an-invite",
        "room",
        options
      )
    ).toEqual({ ok: false, reason: "malformed" });

    expect(() =>
      inviteAuthOptionsFromEnv({}, true)
    ).toThrow(/required in production/);

    expect(() =>
      inviteAuthOptionsFromEnv(
        { VERGE_INVITE_SHARED_SECRET: "short" },
        false
      )
    ).toThrow(/at least 32 characters/);
  });
});
