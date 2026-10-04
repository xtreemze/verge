import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

async function expectRemoteMedia(
  page: import("@playwright/test").Page,
  displayName: string
): Promise<void> {
  const tile = page.locator(".video-tile", {
    has: page.locator(".nameplate", { hasText: displayName })
  });

  await expect(tile).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(
      () =>
        tile.locator("video").evaluate((element) => {
          const video = element as HTMLVideoElement;
          const stream = video.srcObject as MediaStream | null;
          return {
            audio: stream?.getAudioTracks().length ?? 0,
            video: stream?.getVideoTracks().length ?? 0
          };
        }),
      { timeout: 15_000 }
    )
    .toEqual({ audio: 1, video: 1 });
}

test("certifies two-peer WebRTC media, chat, files, and cleanup", async ({
  browser,
  page
}) => {
  const room = crypto.randomUUID().replaceAll("-", "");
  const secondContext = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    permissions: ["camera", "microphone"]
  });
  const secondPage = await secondContext.newPage();

  try {
    await Promise.all([
      page.goto(`/?room=${room}`),
      secondPage.goto(`/?room=${room}`)
    ]);

    await page.getByLabel("Your name").fill("Alice");
    await secondPage.getByLabel("Your name").fill("Bob");

    await page.getByRole("button", { name: "Join room" }).click();
    await expect(page.getByText("1 participant")).toBeVisible();

    await secondPage.getByRole("button", { name: "Join room" }).click();

    await expect(page.getByText("2 participants")).toBeVisible({
      timeout: 15_000
    });
    await expect(secondPage.getByText("2 participants")).toBeVisible({
      timeout: 15_000
    });

    await expectRemoteMedia(page, "Bob");
    await expectRemoteMedia(secondPage, "Alice");

    if (process.env.VERGE_E2E_RELAY === "1") {
      await expect(page.locator(".quality-badge").first()).toContainText(
        "relay",
        { timeout: 15_000 }
      );
      await expect(secondPage.locator(".quality-badge").first()).toContainText(
        "relay",
        { timeout: 15_000 }
      );
    }

    const message = `hello-${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Message").fill(message);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      secondPage.locator(".message", { hasText: message })
    ).toBeVisible({ timeout: 10_000 });

    const fileName = `verge-${crypto.randomUUID().slice(0, 8)}.txt`;
    const fileBody = "Verge deterministic P2P file certification.";
    await page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(fileBody)
    });

    const receivedFile = secondPage.locator(".downloads a", {
      hasText: fileName
    });
    await expect(receivedFile).toBeVisible({ timeout: 15_000 });
    await expect(receivedFile).toContainText("SHA-256 verified");

    await secondPage.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByText("1 participant")).toBeVisible({
      timeout: 10_000
    });
    await expect(
      page.locator(".nameplate", { hasText: "Bob" })
    ).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});
