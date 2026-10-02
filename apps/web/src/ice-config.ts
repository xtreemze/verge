const MAX_ICE_SERVERS = 8;
const MAX_URLS_PER_SERVER = 8;
const ALLOWED_SCHEMES = ["stun:", "stuns:", "turn:", "turns:"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseUrls(value: unknown): string | string[] | undefined {
  const urls =
    typeof value === "string"
      ? [value]
      : Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;

  if (
    !urls ||
    urls.length === 0 ||
    urls.length > MAX_URLS_PER_SERVER ||
    urls.some(
      (url) =>
        url.length > 2_048 ||
        !ALLOWED_SCHEMES.some((scheme) => url.startsWith(scheme))
    )
  ) {
    return undefined;
  }

  return typeof value === "string" ? value : urls;
}

function containsTurn(urls: string | string[]): boolean {
  const values = typeof urls === "string" ? [urls] : urls;
  return values.some(
    (url) => url.startsWith("turn:") || url.startsWith("turns:")
  );
}

function parseIceServer(value: unknown): RTCIceServer | undefined {
  if (!isRecord(value)) return undefined;

  const allowed = new Set([
    "urls",
    "username",
    "credential",
    "credentialType"
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;

  const urls = parseUrls(value.urls);
  if (!urls) return undefined;

  const username = value.username;
  const credential = value.credential;
  const credentialType = value.credentialType;

  if (
    username !== undefined &&
    (typeof username !== "string" || username.length > 1_024)
  ) {
    return undefined;
  }

  if (
    credential !== undefined &&
    (typeof credential !== "string" || credential.length > 4_096)
  ) {
    return undefined;
  }

  if (
    credentialType !== undefined &&
    credentialType !== "password"
  ) {
    return undefined;
  }

  if (
    containsTurn(urls) &&
    (typeof username !== "string" || typeof credential !== "string")
  ) {
    return undefined;
  }

  return {
    urls,
    ...(typeof username === "string" ? { username } : {}),
    ...(typeof credential === "string" ? { credential } : {}),
    ...(credentialType === "password" ? { credentialType } : {})
  };
}

export function parseIceServers(value: unknown): RTCIceServer[] {
  const rawServers =
    Array.isArray(value)
      ? value
      : isRecord(value) && Array.isArray(value.iceServers)
        ? value.iceServers
        : undefined;

  if (
    !rawServers ||
    rawServers.length === 0 ||
    rawServers.length > MAX_ICE_SERVERS
  ) {
    throw new Error("ICE configuration is invalid.");
  }

  const servers = rawServers.map(parseIceServer);
  if (servers.some((server) => server === undefined)) {
    throw new Error("ICE configuration is invalid.");
  }

  return servers as RTCIceServer[];
}

export async function loadIceServers(): Promise<RTCIceServer[] | undefined> {
  const runtimeUrl = import.meta.env.VITE_ICE_CONFIG_URL as string | undefined;

  if (runtimeUrl) {
    const response = await fetch(runtimeUrl, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error("Unable to obtain call connectivity credentials.");
    }

    return parseIceServers(await response.json());
  }

  const raw = import.meta.env.VITE_ICE_SERVERS_JSON as string | undefined;
  if (!raw) return undefined;

  try {
    return parseIceServers(JSON.parse(raw) as unknown);
  } catch {
    throw new Error("ICE configuration is invalid.");
  }
}
