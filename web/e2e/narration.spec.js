import { test, expect } from "@playwright/test";
import models from "../src/offline/model-assets.json" with { type: "json" };
import {
  cachedCDN,
  controlledByServiceWorker,
  fixture,
  upload,
  books,
  stats,
  waitPrepared,
} from "./helpers";

const pinned = new Set(
  Object.values(models).flatMap((m) => m.assets.map((a) => a.url)),
);

test("narration runs in the browser: the voice is fetched once, nothing is uploaded, audio is kept", async ({
  page,
  context,
}) => {
  await cachedCDN(page);
  const requests = [],
    errors = [];
  page.on("request", (r) => requests.push(r));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/");
  await upload(page, fixture("sample-epub3.epub"));
  const [book] = await books(page);
  const sentences = book.chapters.flatMap((c) => c.sentences);
  expect(book.settings).toMatchObject({ engine: "local", voice: "af_heart" });
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  // Audio is no longer exported, so there is no export tab.
  await expect(page.getByRole("tab", { name: "Export audio" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .first()
    .click();
  await expect(page.locator(".sentence.speaking")).toHaveCount(1, {
    timeout: 180000,
  });
  await waitPrepared(page, sentences.length);
  const records = await stats(page);
  expect(records.length).toBe(sentences.length);
  expect(records.every((r) => r.duration > 0.2)).toBe(true);
  // The only requests that leave this site are GETs for the pinned voice files.
  for (const r of requests) {
    const url = new URL(r.url());
    if (url.protocol === "blob:" || url.protocol === "data:") continue;
    expect(r.method()).toBe("GET");
    if (url.origin !== new URL(page.url()).origin)
      expect(pinned.has(r.url())).toBe(true);
  }
  // Prepared audio survives a reload, so narration does not start over.
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  expect(Object.keys((await books(page))[0].prepared).length).toBe(
    sentences.length,
  );
  // Once fetched, the voice works offline: a new sentence can be narrated.
  await controlledByServiceWorker(page);
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  await page
    .getByRole("button", { name: "Edit sentence · 1", exact: true })
    .first()
    .click();
  await context.setOffline(true);
  await page
    .getByLabel("Sentence text")
    .fill("A new first line, read offline.");
  await page
    .getByRole("button", { name: "Regenerate this sentence", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 120000 });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  // The open section's first sentence was replaced and narrated again.
  const edited = (await books(page))[0],
    chapter = edited.chapters.findIndex(
      (c) => c.sentences[0] === "A new first line, read offline.",
    );
  expect(chapter).toBeGreaterThanOrEqual(0);
  expect(edited.prepared[`${chapter}:0`]).toBeTruthy();
  expect(errors).toEqual([]);
});

test("the voice tab offers only voices in the book's language", async ({
  page,
}) => {
  await page.goto("/app/");
  await upload(page, fixture("sample-es.epub"));
  const [book] = await books(page);
  expect(book.settings.voice).toBe("davefx");
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  await page.getByRole("tab", { name: "Voice & cast", exact: true }).click();
  const options = await page
    .getByRole("combobox", { name: "Narration voice", exact: true })
    .locator("option")
    .allTextContents();
  expect(options.length).toBe(3);
  expect(options.every((o) => /Spanish|español/u.test(o))).toBe(true);
});
