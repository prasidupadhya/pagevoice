import { test, expect } from "@playwright/test";
import {
  controlledByServiceWorker,
  fixture,
  upload,
  books,
  mockNarration,
} from "./helpers";

test("reading, search and saved books work offline; only narration uses the network", async ({
  page,
  context,
}) => {
  const requests = [];
  const errors = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() !== "GET" || path.startsWith("/api"))
      requests.push(`${r.method()} ${path}`);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await mockNarration(page);
  await page.goto("/app/");
  await expect(
    page.getByRole("heading", { name: "Add a PDF or EPUB to start reading." }),
  ).toBeVisible();
  await upload(page, fixture("sample-epub3.epub"));
  await upload(page, fixture("native-text.pdf"));
  await upload(page, fixture("sample-es.epub"));
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  const [english] = (await books(page)).filter((b) => b.language === "en");
  await page
    .getByRole("button", { name: `Open book · ${english.title}` })
    .last()
    .click();
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByPlaceholder("Find a phrase, a place, a character…")
    .fill("lantern");
  await expect(page.locator(".search-hits article").first()).toBeVisible();
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  // Let the service worker install the shell before going offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1000);
  await controlledByServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  await page
    .getByRole("button", { name: `Open book · ${english.title}` })
    .last()
    .click();
  await expect(page.locator(".sentence").first()).toBeVisible();
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByPlaceholder("Find a phrase, a place, a character…")
    .fill("lantern");
  await expect(page.locator(".search-hits article").first()).toBeVisible();
  expect(
    requests.every(
      (r) => r.startsWith("GET /api/") || r.startsWith("POST /api/tts"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
