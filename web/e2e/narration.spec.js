import { test, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  fixture,
  upload,
  books,
  stats,
  waitPrepared,
  mockNarration,
} from "./helpers";

test("narration sends one sentence per request, plays it, saves it and exports MP3 files", async ({
  page,
}) => {
  const sent = await mockNarration(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/app/");
  await upload(page, fixture("sample-epub3.epub"));
  const [book] = await books(page);
  const sentences = book.chapters.flatMap((c) => c.sentences);
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  await page
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .first()
    .click();
  await expect(page.locator(".sentence.speaking")).toHaveCount(1, {
    timeout: 15000,
  });
  await waitPrepared(page, sentences.length);
  // Every request carries exactly one sentence of the book and the chosen voice.
  expect(sent.length).toBeGreaterThanOrEqual(sentences.length);
  for (const body of sent) {
    expect(sentences).toContain(body.text);
    expect(Object.keys(body).sort()).toEqual(["text", "voice"]);
    expect(body.voice).toBe("voice123456");
  }
  const records = await stats(page);
  expect(records.length).toBe(sentences.length);
  expect(records.every((r) => r.duration > 0)).toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("tab", { name: "Export audio", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download audio", exact: true })
    .click();
  await mkdir("test-results/artifacts", { recursive: true });
  await (await download).saveAs("test-results/artifacts/narration.zip");
  const zip = await JSZip.loadAsync(
    await readFile("test-results/artifacts/narration.zip"),
  );
  expect(Object.keys(zip.files).some((n) => n.endsWith(".mp3"))).toBe(true);
  expect(zip.file("metadata-and-citations.json")).toBeTruthy();
  // Prepared audio survives a reload, so narration does not start over.
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  expect(
    (await books(page))[0].prepared &&
      Object.keys((await books(page))[0].prepared).length,
  ).toBe(sentences.length);
  expect(errors).toEqual([]);
});

test("a narration outage is explained where the reader needs it", async ({
  page,
}) => {
  await mockNarration(page, { voicesStatus: 503 });
  await page.goto("/app/");
  await upload(page, fixture("sample-epub3.epub"));
  const [book] = await books(page);
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  await page.getByRole("tab", { name: "Voice & cast", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Narration is not set up on this server yet.",
  );
  await expect(page.getByRole("alert")).not.toContainText(/Error|stack|at /);
});
