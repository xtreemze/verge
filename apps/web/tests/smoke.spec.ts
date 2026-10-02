import { expect, test } from "@playwright/test";

test("renders a shareable conferencing lobby", async ({ page }) => {
  await page.goto("/?room=verge-smoke");

  await expect(page.getByRole("heading", { name: "Meet at the edge." })).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Room")).toHaveValue("verge-smoke");
  await expect(page.getByRole("button", { name: "Join room" })).toBeVisible();
  await expect(page.getByText("Private by transport.")).toBeVisible();
});
