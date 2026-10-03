export interface SignalingOriginPolicy {
  allowedOrigins: ReadonlySet<string>;
  enforce: boolean;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Signaling origins must use http or https.");
  }
  return url.origin;
}

export function createSignalingOriginPolicy(
  rawAllowedOrigins: string | undefined,
  production: boolean
): SignalingOriginPolicy {
  const values = (rawAllowedOrigins ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedOrigins = new Set(values.map(normalizeOrigin));

  if (production && allowedOrigins.size === 0) {
    throw new Error(
      "VERGE_ALLOWED_ORIGINS must be configured in production."
    );
  }

  return {
    allowedOrigins,
    enforce: production || allowedOrigins.size > 0
  };
}

export function isSignalingOriginAllowed(
  origin: string | undefined,
  policy: SignalingOriginPolicy
): boolean {
  if (!policy.enforce) return true;
  if (!origin) return false;

  try {
    return policy.allowedOrigins.has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}
