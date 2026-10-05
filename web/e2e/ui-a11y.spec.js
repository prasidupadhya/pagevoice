import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture, upload } from "./helpers";
test("shelf and reader work at three sizes and themes with keyboard dialogs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("../docs/screenshots/static", { recursive: true });
  await page.goto("/");
  await expect(page.locator(".empty-room")).toBeVisible();
  const audits = [];
  for (const theme of ["light", "sepia", "dark"]) {
    while (
      (await page.evaluate(() => document.documentElement.dataset.theme)) !==
      theme
    )
      await page.getByRole("button", { name: /Reading theme/ }).click();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `../docs/screenshots/static/empty-${theme}-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      audits.push({
        screen: "empty",
        theme,
        width,
        violations: report.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
    }
  }
  await upload(page, fixture("sample-epub3.epub"));
  await upload(page, fixture("native-text.pdf"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: "../docs/screenshots/static/shelf-dark-1440.png",
    fullPage: true,
  });
  await page
    .locator(".shelf-book")
    .first()
    .getByRole("button", { name: /Open book/ })
    .click();
  for (const theme of ["light", "sepia", "dark"]) {
    while (
      (await page.evaluate(() => document.documentElement.dataset.theme)) !==
      theme
    )
      await page.getByRole("button", { name: /Reading theme/ }).click();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `../docs/screenshots/static/reader-${theme}-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      audits.push({
        screen: "reader",
        theme,
        width,
        violations: report.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
    }
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "Contents", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Contents" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Contents" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: /Interface language/ }).click();
  await expect(
    page.getByRole("button", { name: "Volver a la estantería", exact: true }),
  ).toBeVisible();
  await mkdir("test-results/artifacts", { recursive: true });
  await writeFile(
    "test-results/artifacts/accessibility.json",
    JSON.stringify(audits, null, 2),
  );
  expect(audits.flatMap((a) => a.violations)).toEqual([]);
});
