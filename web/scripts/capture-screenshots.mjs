// Captures the landing-page and social-preview screenshots from the real app.
// It imports a public-domain EPUB, downloads the Kokoro voice from its pinned
// CDN source, and plays real narration so the "listening" state is genuine.
//
//   npm run build && npm run preview   (in another terminal)
//   node scripts/capture-screenshots.mjs [http://127.0.0.1:4173]
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import manifest from "../src/offline/model-assets.json" with { type: "json" };

const base = process.argv[2] || "http://127.0.0.1:4173";
const book = fileURLToPath(
  new URL("../../rag/eval/books/wilde.epub", import.meta.url),
);
const out = (name) =>
  fileURLToPath(new URL(`../public/${name}`, import.meta.url));

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
});
// Serve model files already fetched by cache-e2e-models.mjs; otherwise use the
// network. The app verifies every file's SHA-256 either way.
const assets = Object.values(manifest).flatMap((m) => m.assets);
await context.route(/huggingface\.co|cdn\.jsdelivr\.net/u, async (route) => {
  const asset = assets.find((a) => a.url === route.request().url());
  // Large bodies are unreliable through request interception; fetch those.
  if (!asset || asset.size > 5000000) return route.continue();
  try {
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: await readFile(`/tmp/pagevoice-model-files/${asset.sha256}`),
    });
  } catch {
    await route.continue();
  }
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("Page error:", e.message));

await page.goto(`${base}/app/`);
await page.getByRole("button", { name: "Display" }).click();
await page.getByRole("radio", { name: "Paper" }).check();
await page.keyboard.press("Escape");

await page.getByLabel("Choose a file", { exact: true }).setInputFiles(book);
await page.getByRole("button", { name: "Open", exact: true }).click();
await page.locator(".sentence").first().waitFor();

// Download the English voice (hash-verified by the app) unless cached.
await page.getByRole("button", { name: "Offline tools" }).click();
const row = page.locator('[data-model="kokoro"]');
if (!(await row.getByText("Cached", { exact: true }).count())) {
  await row.getByRole("button", { name: "Download", exact: true }).click();
  await row
    .getByText("Cached", { exact: true })
    .waitFor({ timeout: 15 * 60000 });
}
await page.getByRole("button", { name: "Close", exact: true }).click();

// A short buffer gets narration started quickly on a CPU-only machine.
await page.getByRole("tab", { name: "Voice & cast" }).click();
await page.getByLabel("Start after").selectOption("5");
await page.getByRole("tab", { name: "Read" }).click();

await page
  .getByRole("button", { name: "Listen from here · 3", exact: true })
  .click();
await page.locator(".sentence.speaking").waitFor({ timeout: 10 * 60000 });
await page.getByLabel("Playback speed").selectOption("1.25");
await page.mouse.move(0, 0);
await page.waitForTimeout(500);

await page.screenshot({
  path: out("screenshots/reader-desktop.jpg"),
  type: "jpeg",
  quality: 82,
  scale: "css",
});
await page.setViewportSize({ width: 1200, height: 630 });
await page.waitForTimeout(400);
await page.screenshot({ path: out("og-image.png"), scale: "css" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({
  path: out("screenshots/reader-mobile.jpg"),
  type: "jpeg",
  quality: 80,
  scale: "device",
});

await page.getByRole("button", { name: "Pause" }).click();
console.log("Captured screenshots; playback paused.");
await browser.close();
