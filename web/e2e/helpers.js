import { expect } from "@playwright/test";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
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
    const path = `/tmp/pagevoice-model-files/${a.sha256}`;
    // Playwright cannot hand very large bodies to the page; those use the network.
    if (a.size > 20000000 || !(await stat(path).catch(() => null))) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": a.path.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
      },
      path,
    });
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
  books,
  stats,
  waitPrepared,
  controlledByServiceWorker,
};
