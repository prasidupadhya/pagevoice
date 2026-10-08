import { expect, it } from "vitest";
import { fold, findMatches, highlightParts } from "./find";

const folded = (chapters) => chapters.map((c) => c.map(fold));

it("finds matches across sections, ignoring case and accents", () => {
  const book = folded([
    ["Una canción triste.", "Nada aquí."],
    ["Otra CANCION.", "Fin."],
  ]);
  expect(findMatches(book, "cancion")).toEqual([
    { chapter: 0, sentence: 0 },
    { chapter: 1, sentence: 0 },
  ]);
});

it("ignores one-letter queries", () => {
  expect(findMatches(folded([["a b c"]]), "a")).toEqual([]);
});

it("maps highlight ranges back onto the original accented text", () => {
  expect(highlightParts("Una Canción triste", "cancion")).toEqual([
    { text: "Una ", match: false },
    { text: "Canción", match: true },
    { text: " triste", match: false },
  ]);
});

it("highlights every occurrence", () => {
  const parts = highlightParts("lamp, Lamp and lamp", "lamp");
  expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual([
    "lamp",
    "Lamp",
    "lamp",
  ]);
  expect(parts.map((p) => p.text).join("")).toBe("lamp, Lamp and lamp");
});
