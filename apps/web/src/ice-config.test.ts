import { describe, expect, it } from "vitest";
import { parseIceServers } from "./ice-config";

describe("parseIceServers", () => {
  it("accepts STUN and authenticated TURN", () => {
    expect(
      parseIceServers({
        iceServers: [
          {
            urls:
              "stun:stun.example.test:3478"
          },
          {
            urls: [
              "turn:turn.example.test:3478",
              "turns:turn.example.test:5349"
            ],
            username: "ephemeral-user",
            credential: "ephemeral-secret"
          }
        ]
      })
    ).toHaveLength(2);
  });

  it("requires credentials for TURN", () => {
    expect(() =>
      parseIceServers([
        {
          urls:
            "turn:turn.example.test:3478"
        }
      ])
    ).toThrow(
      "ICE configuration is invalid."
    );
  });

  it("rejects unsupported schemes and unknown fields", () => {
    expect(() =>
      parseIceServers([
        {
          urls:
            "https://example.test/turn"
        }
      ])
    ).toThrow();

    expect(() =>
      parseIceServers([
        {
          urls:
            "stun:stun.example.test:3478",
          secretAdminFlag: true
        }
      ])
    ).toThrow();
  });

  it("bounds configured servers", () => {
    expect(() =>
      parseIceServers(
        Array.from(
          { length: 9 },
          (_, index) => ({
            urls:
              `stun:stun-${index}.example.test:3478`
          })
        )
      )
    ).toThrow();
  });
});
