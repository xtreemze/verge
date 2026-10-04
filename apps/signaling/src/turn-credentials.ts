import { createHmac, randomUUID } from "node:crypto";

export interface TurnCredentialOptions {
  stunUrls: string[];
  turnUrls: string[];
  sharedSecret: string;
  ttlSeconds: number;
}

export interface IceConfigurationResponse {
  iceServers: RTCIceServer[];
  expiresAt: string;
}

function splitUrls(
  raw: string | undefined,
  schemes: readonly string[]
): string[] {
  if (!raw) return [];
  const urls = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const url of urls) {
    if (!schemes.some((scheme) => url.startsWith(scheme))) {
      throw new Error(`Invalid ICE URL scheme: ${url}`);
    }
  }
  return urls;
}

function positiveInteger(
  raw: string | undefined,
  fallback: number
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("TURN credential TTL must be a positive integer.");
  }
  return value;
}

export function turnCredentialOptionsFromEnv(
  env: NodeJS.ProcessEnv
): TurnCredentialOptions | undefined {
  const stunUrls = splitUrls(env.VERGE_STUN_URLS, ["stun:", "stuns:"]);
  const turnUrls = splitUrls(env.VERGE_TURN_URLS, ["turn:", "turns:"]);
  const sharedSecret = env.VERGE_TURN_SHARED_SECRET?.trim() ?? "";

  if (turnUrls.length === 0 && sharedSecret.length === 0) {
    if (stunUrls.length === 0) return undefined;
    return {
      stunUrls,
      turnUrls: [],
      sharedSecret: "",
      ttlSeconds: positiveInteger(
        env.VERGE_TURN_CREDENTIAL_TTL_SECONDS,
        3_600
      )
    };
  }

  if (turnUrls.length === 0 || sharedSecret.length === 0) {
    throw new Error(
      "VERGE_TURN_URLS and VERGE_TURN_SHARED_SECRET must be configured together."
    );
  }

  return {
    stunUrls,
    turnUrls,
    sharedSecret,
    ttlSeconds: positiveInteger(
      env.VERGE_TURN_CREDENTIAL_TTL_SECONDS,
      3_600
    )
  };
}

export function createIceConfiguration(
  options: TurnCredentialOptions,
  nowMs = Date.now(),
  userId = randomUUID()
): IceConfigurationResponse {
  const expiresAtSeconds =
    Math.floor(nowMs / 1_000) + options.ttlSeconds;
  const iceServers: RTCIceServer[] = [];

  if (options.stunUrls.length > 0) {
    iceServers.push({ urls: options.stunUrls });
  }

  if (options.turnUrls.length > 0) {
    const username = `${expiresAtSeconds}:${userId}`;
    const credential = createHmac("sha1", options.sharedSecret)
      .update(username)
      .digest("base64");

    iceServers.push({
      urls: options.turnUrls,
      username,
      credential
    });
  }

  return {
    iceServers,
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString()
  };
}
