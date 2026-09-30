import { expect, it } from "vitest";
import { browserPolicy } from "../vite.config";
import vercelConfig from "../../vercel.json";
import { existsSync } from "node:fs";

it("narrows the built page to the configured API and identity origins", () => {
  const policy = browserPolicy({
    VITE_API_BASE_URL: "https://books.example",
    VITE_POCKETBASE_URL: "https://identity.example",
  });
  expect(policy).toContain(
    "connect-src 'self' https://books.example https://identity.example",
  );
  expect(policy).toContain("media-src 'self' blob: https://books.example");
  expect(policy).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/u);
  expect(browserPolicy({})).toContain("connect-src 'self';");
  expect(() =>
    browserPolicy({ VITE_API_BASE_URL: "http://public.example" }),
  ).toThrow(/HTTPS origin/u);
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
