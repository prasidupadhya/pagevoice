// Captures the landing-page and social-preview screenshots from the real app.
// It imports a public-domain EPUB, opens the reader and starts narration with the
// real on-device voice, which is fetched from Hugging Face on the first run.
//
//   npm run build && npm run preview   (in another terminal)
//   node scripts/capture-screenshots.mjs [http://127.0.0.1:4173]
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

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
const page = await context.newPage();
page.on("pageerror", (e) => console.error("Page error:", e.message));

await page.goto(`${base}/app/`);
await page.getByRole("button", { name: "Display" }).click();
await page.getByRole("radio", { name: "Paper" }).check();
await page.keyboard.press("Escape");
await page.getByLabel("Choose a file", { exact: true }).setInputFiles(book);
await page.getByRole("button", { name: "Open", exact: true }).click();
await page.locator(".sentence").first().waitFor();
await page
  .getByRole("button", { name: "Listen from here · 3", exact: true })
  .click();
await page.locator(".sentence.speaking").waitFor({ timeout: 600000 });
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
