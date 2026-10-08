import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture, upload } from "./helpers";
const THEME_NAMES = { light: "Light", sepia: "Paper", dark: "Night" };
async function setTheme(page, theme) {
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByRole("radio", { name: THEME_NAMES[theme] }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  // Let the engine restyle before measuring contrast.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
test("shelf and reader work at four sizes and three themes with keyboard dialogs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("../docs/screenshots/static", { recursive: true });
  await page.goto("/app/");
  await expect(page.locator(".empty-room")).toBeVisible();
  const audits = [];
  for (const theme of ["light", "sepia", "dark"]) {
    await setTheme(page, theme);
    for (const width of [360, 375, 768, 1440]) {
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
  // A hosted lazy chunk can arrive after the click; audit actual reading text.
  await expect(page.locator(".sentence").first()).toBeVisible();
  for (const theme of ["light", "sepia", "dark"]) {
    await setTheme(page, theme);
    for (const width of [360, 375, 768, 1440]) {
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
  await page.setViewportSize({ width: 1440, height: 900 });
  // Open from the keyboard: focus must return to the trigger on Escape.
  // (Safari does not focus buttons on mouse click, so a click has no trigger.)
  await page
    .getByRole("button", { name: "Keyboard shortcuts", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Keyboard shortcuts", exact: true }),
  ).toBeFocused();
  // Find in book from the keyboard, then return to reading.
  await page.locator(".sentence-text").first().click();
  await page.keyboard.press("/");
  await expect(
    page.getByRole("searchbox", { name: "Find in book" }),
  ).toBeFocused();
  await page.keyboard.type("lantern");
  await expect(page.locator(".find-count")).toHaveText(/^1 of \d+$/);
  await expect(page.locator(".sentence mark").first()).toHaveText(/lantern/i);
  await page.keyboard.press("Escape");
  await expect(page.locator(".find-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "Display", exact: true }).click();
  await page.getByLabel("Interface language").selectOption("es");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Volver a la biblioteca", exact: true }),
  ).toBeVisible();
  await mkdir("test-results/artifacts", { recursive: true });
  await writeFile(
    "test-results/artifacts/accessibility.json",
    JSON.stringify(audits, null, 2),
  );
  expect(audits.flatMap((a) => a.violations)).toEqual([]);
});
