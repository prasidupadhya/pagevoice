import { describe, it, expect } from "vitest";
import cases from "../../../tests/language_cases.json";
import { detectLanguage } from "./languages";

describe("offline EN/ES detection", () => {
  it.each(cases)("detects $language from body text", (example) => {
    const result = detectLanguage([example.text], example.metadata);
    expect(result.language).toBe(example.language);
    expect(result.source).toBeTruthy();
    if (example.review) expect(result.review).toBe(true);
  });
  it("preserves an explicit override and rejects unsupported metadata", () => {
    expect(detectLanguage(["The book was open."], "en", "es").source).toBe(
      "manual",
    );
    expect(() => detectLanguage(["Bonjour."], "fr")).toThrow();
  });
});
