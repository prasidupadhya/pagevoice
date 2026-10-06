import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
test("native PDF actually parses in the bundled worker", async ({ page }) => {
  page.on("console", (m) => console.log(m.type(), m.text()));
  page.on("pageerror", (e) => console.log("Page error", e.message));
  await page.goto("/");
  await expect(page.locator(".empty-room")).toBeVisible();
  await page
    .getByLabel("Choose a file", { exact: true })
    .setInputFiles(
      fileURLToPath(
        new URL("../src/browser/fixtures/native-text.pdf", import.meta.url),
      ),
    );
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  await page.getByRole("button", { name: /Open book/ }).click();
  await expect(
    page.getByRole("heading", { name: "Chapter One: The Lantern", level: 1 }),
  ).toBeVisible();
});
