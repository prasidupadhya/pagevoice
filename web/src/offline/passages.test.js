import { it, expect } from "vitest";
import { passageRows } from "./passages";
import { mergeSemanticHits, detectCharacters } from "./knowledge";
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
  semantics: { records: [{ chapter: 0, sentence: 0, vector: [1, 0] }] },
};
it("embeds sentences separately with stable chapter/sentence references", () => {
  expect(passageRows(book).map((r) => r.sentence)).toEqual([0, 1, 2]);
  expect(passageRows(book)[0].text).toBe(book.chapters[0].sentences[0]);
});
it("long passages use overlapping complete words, without dropping the tail", () => {
  const text = Array.from({ length: 900 }, (_, i) => `palabra${i}`).join(" ");
  const rows = passageRows({ ...book, chapters: [{ sentences: [text] }] });
  expect(rows.at(-1).text.endsWith("palabra899")).toBe(true);
  expect(rows.every((r) => r.text.length <= 1000 && r.sentence === 0)).toBe(
    true,
  );
});
it("meaning hits remain cited, deduplicate windows and reject stopword/no-evidence queries", () => {
  const duplicates = {
    ...book,
    semantics: {
      records: [...book.semantics.records, ...book.semantics.records],
    },
  };
  expect(mergeSemanticHits(duplicates, "océano", [], [1, 0])).toHaveLength(1);
  expect(mergeSemanticHits(book, "el y la", [], [1, 0])).toEqual([]);
  expect(mergeSemanticHits(book, "galaxia", [], [0, 1])).toEqual([]);
  expect(mergeSemanticHits(book, "océano", [], [1, 0])[0]).toMatchObject({
    match: "semantic",
    citation: "0001-00001",
    chapter: 0,
    sentence: 0,
  });
});
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
