import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
import { fixture, cachedCDN, upload, install, books } from "./helpers";
test("scanned PDF OCR runs locally and after language data is cached offline", async ({
  page,
  context,
}) => {
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type()))
      console.log(m.type(), m.text());
  });
  await cachedCDN(page);
  await page.goto("/app/");
  await expect(page.locator(".empty-room")).toBeVisible();
  await upload(page, fixture("scanned-reader.pdf"));
  await expect(page.locator(".error-banner")).toContainText("Download");
  await install(page, "ocr");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect
    .poll(
      async () => {
        if (await page.locator(".error-banner").count())
          throw Error(await page.locator(".error-banner").innerText());
        return page.locator(".shelf-book").count();
      },
      { timeout: 90000 },
    )
    .toBe(1);
  const [book] = await books(page);
  expect(book.language).toBe("en");
  expect(book.chapters.flatMap((c) => c.sentences).join(" ")).toContain(
    "Maria opened a book",
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  await upload(page, fixture("scanned-reader.pdf"));
  await expect(page.locator(".shelf-book")).toHaveCount(2, { timeout: 90000 });
  expect(
    (await books(page))[1].chapters.flatMap((c) => c.sentences).join(" "),
  ).toContain("birds in the garden");
});
test("selected chapter waits for 20 consecutive sentences, prepares ahead and deletion cancels work", async ({
  page,
}) => {
  await cachedCDN(page);
  await page.goto("/app/");
  await expect(page.locator(".empty-room")).toBeVisible();
  const z = new JSZip();
  z.file("mimetype", "application/epub+zip");
  z.file(
    "META-INF/container.xml",
    '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
  );
  z.file(
    "book.opf",
    "<package><metadata><title>Una biblioteca tranquila</title><language>es</language><creator>PageVoice tests</creator></metadata><manifest>" +
      [1, 2, 3, 4]
        .map(
          (i) =>
            `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`,
        )
        .join("") +
      "</manifest><spine>" +
      [1, 2, 3, 4].map((i) => `<itemref idref="c${i}"/>`).join("") +
      "</spine></package>",
  );
  for (const i of [1, 2, 3, 4])
    z.file(
      `c${i}.xhtml`,
      `<html><body><h1>Capítulo ${i}</h1><p>${Array.from({ length: i < 3 ? 2 : i === 3 ? 23 : 30 }, (_, s) => `María lee el libro junto al mar y escucha las olas en la mañana ${s + 1}.`).join(" ")}</p></body></html>`,
    );
  await upload(page, {
    name: "progressive.es.epub",
    mimeType: "application/epub+zip",
    buffer: await z.generateAsync({ type: "nodebuffer" }),
  });
  const [book] = await books(page);
  await page.getByRole("button", { name: `Open book · ${book.title}` }).click();
  await install(page, "piper");
  await page
    .locator(".chapter-drawer")
    .getByRole("button", { name: /^3 Capítulo 3/ })
    .click();
  await page
    .locator(".sentence")
    .first()
    .getByRole("button", { name: "Listen from here · 1", exact: true })
    .click();
  let smallestPlaying = Infinity,
    previousAtStart;
  await expect
    .poll(
      async () => {
        const b = (await books(page))[0],
          count = Object.keys(b.prepared).length;
        const playing = await page.locator(".sentence.speaking").count();
        if (playing) {
          smallestPlaying = Math.min(smallestPlaying, count);
          previousAtStart = Object.keys(b.prepared).some(
            (k) => k.startsWith("0:") || k.startsWith("1:"),
          );
        }
        if (count < 20) expect(playing).toBe(0);
        return playing;
      },
      { timeout: 150000 },
    )
    .toBe(1);
  expect(smallestPlaying).toBeGreaterThanOrEqual(20);
  expect(previousAtStart).toBe(false);
  expect(smallestPlaying).toBeLessThan(57);
  await expect
    .poll(
      async () =>
        Object.keys((await books(page))[0].prepared).some((k) =>
          k.startsWith("3:"),
        ),
      { timeout: 60000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Remove book", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(book.title);
  await page
    .getByRole("button", { name: "Remove from this browser", exact: true })
    .click();
  await expect
    .poll(async () => (await books(page)).length, { timeout: 15000 })
    .toBe(0);
  const count = await page.evaluate(async () => {
    const open = indexedDB.open("pagevoice-offline-v1");
    const db = await new Promise(
      (r) => (open.onsuccess = () => r(open.result)),
    );
    const get = db.transaction("audio").objectStore("audio").getAll();
    const audio = await new Promise(
      (r) => (get.onsuccess = () => r(get.result)),
    );
    db.close();
    return audio.length;
  });
  expect(count).toBe(0);
  await mkdir("test-results/artifacts", { recursive: true });
  await writeFile(
    "test-results/artifacts/progressive-buffer.json",
    JSON.stringify(
      {
        smallestPlaying,
        previousAtStart,
        chapter4Prepared: true,
        remainingAudioAfterDelete: count,
      },
      null,
      2,
    ),
  );
});
