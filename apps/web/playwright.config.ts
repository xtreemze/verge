import { defineConfig, devices } from "@playwright/test";

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
      timeout: 120_000
    },
    {
      command: "pnpm dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
