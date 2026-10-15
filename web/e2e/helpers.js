import { expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import manifest from "../src/offline/model-assets.json" with { type: "json" };
const fixture = (name) =>
  fileURLToPath(new URL(`../src/browser/fixtures/${name}`, import.meta.url));
const assets = Object.values(manifest).flatMap((m) => m.assets);
async function cachedCDN(page) {
  // Real pinned weights downloaded and hash-verified by scripts/cache-e2e-models.mjs.
  // Only the transport is local in this test; inference is the production worker.
  await page.route("https://huggingface.co/**", async (route) => {
    const a = assets.find((a) => a.url === route.request().url());
    if (!a) {
      await route.abort();
      return;
    }
    if (a.size > 5000000) {
      await route.continue();
      return;
    }
    try {
      await route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "content-type": a.path.endsWith(".json")
            ? "application/json"
            : "application/octet-stream",
        },
        body: await readFile(`/tmp/pagevoice-model-files/${a.sha256}`),
      });
    } catch {
      await route.continue();
    }
  });
  await page.route("https://cdn.jsdelivr.net/**", async (route) => {
    const a = assets.find((a) => a.url === route.request().url());
    if (!a) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: await readFile(`/tmp/pagevoice-model-files/${a.sha256}`),
    });
  });
}
async function upload(page, path) {
  await page.getByLabel("Choose a file", { exact: true }).setInputFiles(path);
  await expect(page.locator(".import-progress")).toHaveCount(0, {
    timeout: 90000,
  });
}
async function install(page, id) {
  await page
    .getByRole("button", { name: "Document tools", exact: true })
    .first()
    .click();
  const row = page.locator(`[data-model="${id}"]`);
  if (!(await row.getByText("Cached", { exact: true }).count())) {
    await row.getByRole("button", { name: "Download", exact: true }).click();
    await expect(row.getByText("Cached", { exact: true })).toBeVisible({
      timeout: 180000,
    });
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
// A page loaded before its service worker activated is not controlled by it.
// Reloading once under the worker is what a real user does before going offline.
async function controlledByServiceWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
}
async function books(page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("pagevoice-offline-v1");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const r = db.transaction("books").objectStore("books").getAll();
    const result = await new Promise(
      (resolve) => (r.onsuccess = () => resolve(r.result)),
    );
    db.close();
    return result;
  });
}
async function waitPrepared(page, count, id) {
  await expect
    .poll(
      async () => {
        if (await page.locator(".error-banner").count())
          throw Error(await page.locator(".error-banner").innerText());
        const loaded = await books(page);
        const b = id ? loaded.find((b) => b.id === id) : loaded[0];
        return Object.keys(b?.prepared || {}).length;
      },
      { timeout: 300000 },
    )
    .toBeGreaterThanOrEqual(count);
}
// Narration tests use a fixed voice from a mocked service (see mockNarration).
const VOICE = { id: "voice123456", name: "Test voice", locale: "en" };
// Silent PCM WAV bytes. The mocked service returns them as audio/mpeg; browsers
// sniff the container, so this exercises the same playback and storage paths.
function silentWav(seconds = 1.2, rate = 8000) {
  const samples = Math.floor(rate * seconds),
    buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
/** Mocks the site's narration routes. Returns the bodies sent to /api/tts. */
async function mockNarration(page, { voicesStatus = 200, delayMs = 0 } = {}) {
  const sent = [];
  await page.route("**/api/voices", (route) =>
    voicesStatus === 200
      ? route.fulfill({ json: { voices: [VOICE] } })
      : route.fulfill({
          status: voicesStatus,
          json: { error: "ttsNotConfigured" },
        }),
  );
  await page.route("**/api/tts", async (route) => {
    sent.push(route.request().postDataJSON());
    // Real services take time per sentence; instant replies would hide buffering.
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "audio/mpeg",
      body: silentWav(),
    });
  });
  return sent;
}
// Stored narration records: which sentences have audio, and how long each lasts.
async function stats(page) {
  return page.evaluate(async () => {
    const open = indexedDB.open("pagevoice-offline-v1");
    const db = await new Promise(
      (r) => (open.onsuccess = () => r(open.result)),
    );
    const get = db.transaction("audio").objectStore("audio").getAll();
    const records = await new Promise(
      (r) => (get.onsuccess = () => r(get.result)),
    );
    db.close();
    return records.map((a) => ({
      bookId: a.bookId,
      row: a.row,
      duration: a.duration,
    }));
  });
}
export {
  fixture,
  cachedCDN,
  upload,
  install,
  books,
  stats,
  waitPrepared,
  controlledByServiceWorker,
  mockNarration,
  VOICE,
};
