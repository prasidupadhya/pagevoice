import { it, expect } from "vitest";
import { detectCharacters } from "./knowledge";
const book = {
  language: "es",
  chapters: [
    {
      title: "Capítulo 1",
      source: "chapter.xhtml#uno",
      sentences: [
        "María escuchó las olas del mar.",
        "El sol iluminaba las calles.",
        "«Hola», dijo María.",
      ],
    },
  ],
};
it("dialogue attribution is reviewable and rejects anonymous pronouns", () => {
  expect(detectCharacters(book).speakers["0:2"]).toBe("María");
  expect(
    detectCharacters({
      ...book,
      chapters: [{ sentences: ["“Hello,” said He."] }],
    }).characters,
  ).toEqual([]);
});
it("manual character names and speaker corrections survive reanalysis", () => {
  const reviewed = {
    ...book,
    characters: {
      characters: [{ name: "Rosa", source: "manual review", count: 0 }],
    },
    manualSpeakers: { "0:1": "Rosa" },
  };
  const result = detectCharacters(reviewed);
  expect(
    result.characters.some(
      (c) => c.name === "Rosa" && c.source === "manual review",
    ),
  ).toBe(true);
  expect(result.speakers["0:1"]).toBe("Rosa");
});
