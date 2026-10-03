import { describe, expect, it } from "vitest";
import {
  createSignalingOriginPolicy,
  isSignalingOriginAllowed
} from "./origin-policy.ts";

describe("signaling origin policy", () => {
  it("allows unrestricted local development by default", () => {
    const policy =
      createSignalingOriginPolicy(undefined, false);
    expect(
      isSignalingOriginAllowed(undefined, policy)
    ).toBe(true);
    expect(
      isSignalingOriginAllowed(
        "http://localhost:5173",
        policy
      )
    ).toBe(true);
  });

  it("normalizes and enforces configured origins", () => {
    const policy = createSignalingOriginPolicy(
      "https://verge.example, http://localhost:5173/",
      false
    );

    expect(
      isSignalingOriginAllowed(
        "https://verge.example",
        policy
      )
    ).toBe(true);
    expect(
      isSignalingOriginAllowed(
        "http://localhost:5173",
        policy
      )
    ).toBe(true);
    expect(
      isSignalingOriginAllowed(
        "https://attacker.example",
        policy
      )
    ).toBe(false);
    expect(
      isSignalingOriginAllowed(undefined, policy)
    ).toBe(false);
  });

  it("fails closed in production without an allowlist", () => {
    expect(() =>
      createSignalingOriginPolicy(undefined, true)
    ).toThrow("VERGE_ALLOWED_ORIGINS");
  });

  it("rejects non-http origins", () => {
    expect(() =>
      createSignalingOriginPolicy(
        "file:///tmp/verge",
        false
      )
    ).toThrow();
  });
});
