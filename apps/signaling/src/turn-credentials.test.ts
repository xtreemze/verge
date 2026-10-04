import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createIceConfiguration,
  turnCredentialOptionsFromEnv
} from "./turn-credentials";

describe("TURN credential configuration", () => {
  it("creates coturn REST credentials with a bounded expiry", () => {
    const response = createIceConfiguration(
      {
        stunUrls: ["stun:turn.example.com:3478"],
        turnUrls: [
          "turn:turn.example.com:3478?transport=udp",
          "turn:turn.example.com:3478?transport=tcp"
        ],
        sharedSecret: "test-secret",
        ttlSeconds: 600
      },
      1_700_000_000_000,
      "device-a"
    );

    const turn = response.iceServers[1]!;
    expect(turn.username).toBe("1700000600:device-a");
    expect(turn.credential).toBe(
      createHmac("sha1", "test-secret")
        .update("1700000600:device-a")
        .digest("base64")
    );
    expect(response.expiresAt).toBe("2023-11-14T22:23:20.000Z");
  });

  it("rejects incomplete TURN shared-secret configuration", () => {
    expect(() =>
      turnCredentialOptionsFromEnv({
        VERGE_TURN_URLS: "turn:turn.example.com:3478"
      })
    ).toThrow(/configured together/);
  });

  it("supports STUN-only development configuration", () => {
    expect(
      turnCredentialOptionsFromEnv({
        VERGE_STUN_URLS: "stun:stun.example.com:3478"
      })
    ).toMatchObject({
      stunUrls: ["stun:stun.example.com:3478"],
      turnUrls: []
    });
  });
});
