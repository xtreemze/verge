import { expect, test } from "@playwright/test";

test("renders a shareable conferencing lobby", async ({ page }) => {
  const room = "0123456789abcdef0123456789abcdef";
  await page.goto(`/?room=${room}&name=Phone%20A&debug=1`);

  await expect(page.getByRole("heading", { name: "Meet at the edge." })).toBeVisible();
  await expect(page.getByLabel("Your name")).toHaveValue("Phone A");
  await expect(page.getByLabel("Room")).toHaveValue(room);
  await expect(page.getByRole("button", { name: "Join room" })).toBeVisible();
  await expect(page.getByText("Private by transport.")).toBeVisible();
});
