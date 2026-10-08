import { expect, it } from "vitest";
import { progressOf, relativeTime } from "./format";

const book = (position, startChapter = 0) => ({
  startChapter,
  position,
  chapters: [
    { sentences: ["a", "b"] },
    { sentences: ["c", "d", "e", "f"] },
    { sentences: ["g", "h", "i", "j"] },
  ],
});

it("treats a new book positioned at its detected start as unread", () => {
  expect(progressOf(book({ chapter: 1, sentence: 0 }, 1))).toBe(0);
});

it("measures progress from the content start", () => {
  expect(progressOf(book({ chapter: 2, sentence: 0 }, 1))).toBe(50);
  expect(progressOf(book({ chapter: 2, sentence: 4 }, 1))).toBe(100);
});

it("counts front matter when the reader goes back to it", () => {
  expect(progressOf(book({ chapter: 0, sentence: 1 }, 1))).toBe(10);
});

it("handles empty books", () => {
  expect(
    progressOf({ position: { chapter: 0, sentence: 0 }, chapters: [] }),
  ).toBe(0);
});

it("formats relative times", () => {
  const now = Date.UTC(2026, 0, 10);
  expect(relativeTime(now - 2 * 86400000, "en", now)).toBe("2 days ago");
  expect(relativeTime(now - 10000, "en", now)).toBe("this minute");
  expect(relativeTime(now - 3 * 3600000, "es", now)).toBe("hace 3 horas");
});
