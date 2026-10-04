import { defineConfig, devices } from "@playwright/test";

const relayMode = process.env.VERGE_E2E_RELAY === "1";
const inheritedEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string"
  )
);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream"
          ]
        }
      }
    }
  ],
  webServer: [
    {
      command: "pnpm --dir ../signaling dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: inheritedEnv
    },
    {
      command: "pnpm dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: relayMode
        ? {
            ...inheritedEnv,
            VITE_ICE_TRANSPORT_POLICY: "relay",
            VITE_ICE_SERVERS_JSON: JSON.stringify([
              {
                urls: "turn:127.0.0.1:3478?transport=udp",
                username: "verge",
                credential: "vergepass"
              }
            ])
          }
        : inheritedEnv
    }
  ]
});
