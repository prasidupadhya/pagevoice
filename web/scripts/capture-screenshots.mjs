// Captures the landing-page and social-preview screenshots from the real app.
// It imports a public-domain EPUB and opens the reader. Narration is mocked at the
// site's /api routes, so the screenshot shows the real "speaking" state without
// calling the voice service. The mocked voice is labelled generically.
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

// A short silent PCM WAV, returned as audio/mpeg. Browsers sniff the container.
function silentWav(seconds = 1.2, rate = 8000) {
  const samples = Math.floor(rate * seconds);
  const buffer = Buffer.alloc(44 + samples * 2);
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
await context.route("**/api/voices", (route) =>
  route.fulfill({
    json: {
      voices: [{ id: "narrator0000000001", name: "Narrator", locale: "" }],
    },
  }),
);
await context.route("**/api/tts", (route) =>
  route.fulfill({ status: 200, contentType: "audio/mpeg", body: silentWav() }),
);
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
await page.locator(".sentence.speaking").waitFor({ timeout: 60000 });
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
