import { expect, test } from "@playwright/test";

test("connects two peers with real WebRTC media and chat", async ({
  browser,
  page
}) => {
  const room = `webrtc-${crypto.randomUUID().slice(0, 8)}`;
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

    await expect(page.locator(".nameplate", { hasText: "Bob" })).toBeVisible();
    await expect(
      secondPage.locator(".nameplate", { hasText: "Alice" })
    ).toBeVisible();

    const message = `hello-${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Message").fill(message);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(
      secondPage.locator(".message", { hasText: message })
    ).toBeVisible({ timeout: 10_000 });

    await secondPage.getByRole("button", { name: "Leave" }).click();
    await expect(page.getByText("1 participant")).toBeVisible({
      timeout: 10_000
    });
  } finally {
    await secondContext.close();
  }
});
