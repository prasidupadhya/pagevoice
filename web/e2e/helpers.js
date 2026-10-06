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
    .getByRole("button", { name: "Offline tools", exact: true })
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
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle("pagevoice-audio");
    const out = [];
    for (const a of records) {
      const blob =
        a.blob || (await (await directory.getFileHandle(a.path)).getFile());
      const buffer = await blob.arrayBuffer(),
        view = new DataView(buffer),
        rate = view.getUint32(24, true);
      let sum = 0,
        peak = 0;
      for (let p = 44; p < buffer.byteLength; p += 2) {
        const x = view.getInt16(p, true) / 32768;
        sum += x * x;
        peak = Math.max(peak, Math.abs(x));
      }
      out.push({
        bookId: a.bookId,
        row: a.row,
        duration: (buffer.byteLength - 44) / 2 / rate,
        rms: Math.sqrt(sum / ((buffer.byteLength - 44) / 2)),
        peak,
        rtf: a.rtf,
        bytes: blob.size,
      });
    }
    db.close();
    return out;
  });
}

export { fixture, cachedCDN, upload, install, books, stats, waitPrepared };
