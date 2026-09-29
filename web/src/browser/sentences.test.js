import { describe, expect, it } from "vitest";
import { splitSentences } from "./sentences";

describe("English and Spanish sentence boundaries", () => {
  it.each([
    [
      "es",
      "El Sr. García llegó a las 3.14. Después salió.",
      ["El Sr. García llegó a las 3.14.", "Después salió."],
    ],
    [
      "es",
      "«Primera frase. Segunda frase». Ella sonrió.",
      ["«Primera frase.", "Segunda frase».", "Ella sonrió."],
    ],
    [
      "en",
      "“First sentence. Second sentence.” She smiled.",
      ["“First sentence.", "Second sentence.”", "She smiled."],
    ],
    [
      "en",
      "Dr. Reed paid $3.50. He left.",
      ["Dr. Reed paid $3.50.", "He left."],
    ],
    [
      "es",
      "La Dra. Ruiz llegó.otra frase empieza.",
      ["La Dra. Ruiz llegó.", "otra frase empieza."],
    ],
    [
      "en",
      "Visit https://example.com/help. Then email a@b.com.",
      ["Visit https://example.com/help.", "Then email a@b.com."],
    ],
    [
      "es",
      "Vio árboles, flores, etc. Después salió.",
      ["Vio árboles, flores, etc.", "Después salió."],
    ],
    [
      "en",
      "1. The first choice. 2. The second choice.",
      ["1. The first choice.", "2. The second choice."],
    ],
    [
      "en",
      "The U.S. economy grew. Dr. Reed agreed.",
      ["The U.S. economy grew.", "Dr. Reed agreed."],
    ],
    ["en", "'Hello.' She smiled.", ["'Hello.'", "She smiled."]],
  ])(
    "splits %s text without damaging punctuation",
    (language, text, expected) => {
      expect(splitSentences(text, language)).toEqual(expected);
    },
  );

  it("normalizes whitespace and returns no empty sentence", () => {
    expect(splitSentences("  First.\n\nSecond!  ", "en")).toEqual([
      "First.",
      "Second!",
    ]);
    expect(splitSentences("  \n ", "es")).toEqual([]);
  });
});
