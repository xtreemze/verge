export interface BrowserCapabilitySnapshot {
  secureContext: boolean;
  webrtc: boolean;
  userMedia: boolean;
  codecPreferences: boolean;
  dataChannel: boolean;
  secureRandom: boolean;
  displayCapture: boolean;
}

export const BROWSER_CAPABILITY_DEFINITIONS = [
  { id: "secure", key: "secureContext", label: "Secure context", required: true },
  { id: "webrtc", key: "webrtc", label: "WebRTC", required: true },
  {
    id: "user-media",
    key: "userMedia",
    label: "Camera + microphone API",
    required: true
  },
  {
    id: "codec-preferences",
    key: "codecPreferences",
    label: "WebRTC codec preferences",
    required: true
  },
  {
    id: "data-channel",
    key: "dataChannel",
    label: "WebRTC data channels",
    required: true
  },
  {
    id: "secure-random",
    key: "secureRandom",
    label: "Secure room IDs",
    required: true
  },
  {
    id: "display-capture",
    key: "displayCapture",
    label: "Screen sharing",
    required: false
  }
] as const satisfies ReadonlyArray<{
  id: string;
  key: keyof BrowserCapabilitySnapshot;
  label: string;
  required: boolean;
}>;

export interface EvaluatedBrowserCapability {
  id: string;
  label: string;
  required: boolean;
  supported: boolean;
}

export interface BrowserReadiness {
  ready: boolean;
  capabilities: EvaluatedBrowserCapability[];
  missingRequired: EvaluatedBrowserCapability[];
  unavailableOptional: EvaluatedBrowserCapability[];
}

export function evaluateBrowserReadiness(
  snapshot: BrowserCapabilitySnapshot
): BrowserReadiness {
  const capabilities = BROWSER_CAPABILITY_DEFINITIONS.map(
    (definition) => ({
      id: definition.id,
      label: definition.label,
      required: definition.required,
      supported: snapshot[definition.key]
    })
  );

  const missingRequired = capabilities.filter(
    (capability) =>
      capability.required && !capability.supported
  );
  const unavailableOptional = capabilities.filter(
    (capability) =>
      !capability.required && !capability.supported
  );

  return {
    ready: missingRequired.length === 0,
    capabilities,
    missingRequired,
    unavailableOptional
  };
}
