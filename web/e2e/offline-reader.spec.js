import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  controlledByServiceWorker,
  fixture,
  cachedCDN,
  upload,
  install,
  books,
  stats,
  waitPrepared,
} from "./helpers";
test("real English and Spanish speech, persistence, ZIP, undo and fully offline core flow", async ({
  page,
  context,
}) => {
  const requests = [],
    errors = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api")) requests.push(r.url());
    if (r.method() !== "GET") requests.push(r.url());
  });
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("Page error:", e.message);
  });
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      console.log("Browser:", m.text());
  });
  await cachedCDN(page);
  await page.goto("/app/");
  await expect(
    page.getByRole("heading", { name: "Add a PDF or EPUB to start reading." }),
  ).toBeVisible();
  await upload(page, fixture("sample-epub3.epub"));
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  const [english] = await books(page);
  await page
    .getByRole("button", { name: `Open book · ${english.title}` })
    .last()
    .click();
  await install(page, "kokoro");
  await page
    .getByRole("button", { name: "Prepare audiobook", exact: true })
    .click();
  await waitPrepared(
    page,
    english.chapters.reduce((n, c) => n + c.sentences.length, 0),
  );
  const englishStats = await stats(page);
  for (const s of englishStats) {
    expect(s.rms).toBeGreaterThan(0.002);
    expect(s.duration).toBeGreaterThan(0.5);
    expect(s.duration).toBeLessThan(60);
  }
  await page
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .first()
    .click();
  await expect(page.locator(".sentence.speaking")).toHaveCount(1, {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("tab", { name: "Explore", exact: true }).click();
  await page
    .getByPlaceholder("Find a phrase, a place, a character…")
    .fill("lantern");
  await expect(page.locator(".search-hits article").first()).toBeVisible();
  await page.getByRole("tab", { name: "Export audio", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download audio", exact: true })
    .click();
  const saved = await download;
  await mkdir("test-results/artifacts", { recursive: true });
  const zipPath = "test-results/artifacts/english.zip";
  await saved.saveAs(zipPath);
  const zip = await JSZip.loadAsync(await readFile(zipPath));
  expect(Object.keys(zip.files).some((n) => n.endsWith(".mp3"))).toBe(true);
  expect(zip.file("metadata-and-citations.json")).toBeTruthy();
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  const [restored] = await books(page);
  expect(Object.keys(restored.prepared).length).toBe(englishStats.length);
  await upload(page, fixture("native-text.pdf"));
  await expect(page.locator(".shelf-book")).toHaveCount(2);
  await upload(page, fixture("sample-es.epub"));
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  const spanish = (await books(page)).find((b) => b.language === "es");
  expect(spanish).toBeTruthy();
  await page
    .getByRole("button", { name: `Open book · ${spanish.title}` })
    .click();
  await install(page, "piper");
  await page
    .getByRole("button", { name: "Prepare audiobook", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Object.keys(
          (await books(page)).find((b) => b.id === spanish.id).prepared,
        ).length,
      { timeout: 180000 },
    )
    .toBe(spanish.chapters.reduce((n, c) => n + c.sentences.length, 0));
  const allStats = await stats(page);
  const spanishStats = allStats.filter((s) => s.bookId === spanish.id);
  expect(spanishStats.length).toBeGreaterThan(0);
  for (const s of spanishStats) {
    expect(s.rms).toBeGreaterThan(0.002);
    expect(s.duration).toBeGreaterThan(1);
  }
  await page
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .first()
    .click();
  await expect(page.locator(".sentence.speaking")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Remove book", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(spanish.title);
  await page
    .getByRole("button", { name: "Remove from this browser", exact: true })
    .click();
  await expect(page.locator(".shelf-book")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  // Let the service worker finish installing the shell before disconnecting.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForTimeout(1000);
  await controlledByServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(3);
  await page
    .getByRole("button", { name: `Open book · ${english.title}` })
    .last()
    .click();
  await page
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .first()
    .click();
  await expect(page.locator(".sentence.speaking")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("tab", { name: "Voice & cast", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Narration voice", { exact: true })
    .selectOption("af_bella");
  await page
    .getByRole("button", { name: "Prepare audiobook", exact: true })
    .click();
  await waitPrepared(page, englishStats.length, english.id);
  expect((await stats(page)).every((s) => s.rms > 0.002)).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    "test-results/artifacts/desktop-audio.json",
    JSON.stringify(
      {
        english: englishStats,
        spanish: spanishStats,
        offlineRegenerated: true,
        browser: await page.evaluate(() => navigator.userAgent),
      },
      null,
      2,
    ),
  );
});
