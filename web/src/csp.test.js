import { expect, it } from "vitest";
import { browserPolicy } from "../vite.config";
import vercelConfig from "../../vercel.json";
import { existsSync } from "node:fs";

it("permits only static artifacts, local workers and local audio", () => {
  const policy = browserPolicy();
  expect(policy).toContain("'wasm-unsafe-eval'");
  expect(policy).toContain("https://huggingface.co");
  expect(policy).toContain("media-src 'self' blob:;");
  expect(policy).not.toMatch(/https:(?:\s|;|$)/u);
  expect(policy).not.toMatch(
    /pocketbase|127\.0\.0\.1|microsoft|books\.example/u,
  );
  expect(
    vercelConfig.headers[0].headers.find(
      (h) => h.key === "Content-Security-Policy",
    ).value,
  ).toBe(policy + "; frame-ancestors 'none'");
});

it("ships only static Vercel configuration with string header values", () => {
  expect(existsSync(new URL("../../vercel.mjs", import.meta.url))).toBe(false);
  expect(vercelConfig.framework).toBe("vite");
  expect(vercelConfig.outputDirectory).toBe("web/dist");
  for (const rule of vercelConfig.headers) {
    for (const header of rule.headers) {
      expect(header.key).toBeTypeOf("string");
      expect(header.value).toBeTypeOf("string");
      expect(header.value.length).toBeGreaterThan(0);
    }
  }
});
