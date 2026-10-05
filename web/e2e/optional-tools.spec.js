import { test, expect } from "@playwright/test";
import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { fixture, cachedCDN, upload, install, books, stats } from "./helpers";
test("measures Spanish Piper versus Supertonic, local embeddings/NER, and chaptered M4B", async ({
  page,
}) => {
  page.on("console", (m) => {
    if (["warning", "error"].includes(m.type()))
      console.log(m.type(), m.text());
  });
  await cachedCDN(page);
  await page.goto("/");
  await expect(page.locator(".empty-room")).toBeVisible();
  await upload(page, fixture("sample-es.epub"));
  await expect(page.locator(".shelf-book")).toHaveCount(1);
  const [b] = await books(page);
  await page.getByRole("button", { name: `Open book · ${b.title}` }).click();
  await install(page, "piper");
  await page
    .getByRole("button", { name: "Prepare audiobook", exact: true })
    .click();
  const prepared = async () => {
    await expect
      .poll(
        async () => {
          if (await page.locator(".error-banner").count())
            throw Error(await page.locator(".error-banner").innerText());
          return Object.keys((await books(page))[0].prepared).length;
        },
        { timeout: 180000 },
      )
      .toBe(3);
  };
  await prepared();
  const piper = await stats(page);
  await page
    .getByRole("button", { name: "Voice & cast", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Speech engine", { exact: true })
    .selectOption("supertonic");
  await install(page, "supertonic");
  await page
    .getByRole("button", { name: "Prepare audiobook", exact: true })
    .click();
  await prepared();
  const supertonic = await stats(page);
  for (const s of supertonic) {
    expect(s.rms).toBeGreaterThan(0.002);
    expect(s.duration).toBeGreaterThan(1);
    expect(s.duration).toBeLessThan(60);
  }
  await install(page, "embeddings");
  await install(page, "ner");
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page
    .getByRole("button", { name: "Build meaning index", exact: true })
    .click();
  await expect
    .poll(async () => (await books(page))[0].semantics?.records.length || 0, {
      timeout: 180000,
    })
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Find character names", exact: true })
    .click();
  await expect
    .poll(async () => (await books(page))[0].entities?.length || 0, {
      timeout: 180000,
    })
    .toBeGreaterThan(0);
  await page
    .getByPlaceholder("Find a phrase, a place, a character…")
    .fill("olas");
  await page
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="hybrid"]') })
    .selectOption("hybrid");
  await expect(page.locator(".search-hits article")).not.toHaveCount(0, {
    timeout: 30000,
  });
  await install(page, "ffmpeg");
  await page.getByRole("button", { name: "Export audio", exact: true }).click();
  await page
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="m4b"]') })
    .selectOption("m4b");
  const download = page.waitForEvent("download", { timeout: 90000 });
  await page
    .getByRole("button", { name: "Download audio", exact: true })
    .click();
  const d = await download;
  await mkdir("test-results/artifacts", { recursive: true });
  await d.saveAs("test-results/artifacts/spanish.m4b");
  const data = await readFile("test-results/artifacts/spanish.m4b");
  expect(data.subarray(4, 8).toString()).toBe("ftyp");
  const updated = (await books(page))[0];
  const workerFile = (await readdir("dist/assets")).find((f) =>
    /^knowledge.worker-.*\.js$/.test(f),
  );
  const semanticChecks = await page.evaluate(
    async ({ workerFile, records }) => {
      const worker = new Worker(`/assets/${workerFile}`, { type: "module" });
      const result = [];
      for (const query of [
        "olas",
        "el sonido del mar",
        "costa y océano",
        "galaxia tuberculosis",
        "el y la",
      ]) {
        const started = performance.now();
        const vector = await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.result);
          worker.postMessage({ id: 1, kind: "embeddings", query });
        });
        const ranked = records
          .map((r) => ({
            chapter: r.chapter,
            sentence: r.sentence,
            similarity: r.vector.reduce((sum, x, i) => sum + x * vector[i], 0),
          }))
          .sort((a, b) => b.similarity - a.similarity);
        result.push({ query, latencyMs: performance.now() - started, ranked });
      }
      worker.terminate();
      return result;
    },
    { workerFile, records: updated.semantics.records },
  );
  await writeFile(
    "test-results/artifacts/local-model-benchmark.json",
    JSON.stringify(
      {
        piper,
        supertonic,
        semanticWindows: updated.semantics.records.length,
        semanticChecks,
        entities: updated.entities,
        subjectiveQuality: "Not measured; Piper remains the Spanish default.",
      },
      null,
      2,
    ),
  );
});
