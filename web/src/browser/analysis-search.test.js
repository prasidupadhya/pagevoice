import { describe, expect, it } from "vitest";
import { analyzeSections, applySectionReview } from "./analysis";
import structureCases from "../../../rag/eval/structure_challenge.json";
import { buildSearchIndex, searchBook } from "./search";

describe("honest local structure analysis", () => {
  it.each(structureCases)(
    "handles the shared structural edge case: $title",
    (example) => {
      const result = analyzeSections({
        chapters: [{ ...example, sentences: ["A source passage for review."] }],
      });
      expect(result.sections[0].kind).toBe(example.expected);
    },
  );
  it("lets a document role override navigation and title heuristics", () => {
    const analysis = analyzeSections({
      chapters: [
        {
          title: "Chapter I",
          role: "front_matter",
          evidence: "navigation",
          sentences: ["Author biography."],
        },
      ],
    });
    expect(analysis.sections[0]).toMatchObject({
      kind: "front_matter",
      confidence: "high",
      source: "document role",
    });
  });

  it.each([
    ["en", "Foreword", "front_matter"],
    ["es", "Prólogo", "front_matter"],
    ["en", "Author's life", "front_matter"],
    ["es", "Vida del autor", "front_matter"],
    ["en", "Table of Contents", "front_matter"],
    ["en", "Chapter One", "chapter"],
    ["es", "Capítulo 1", "chapter"],
    ["en", "Bibliography", "back_matter"],
    ["es", "Apéndice", "back_matter"],
    ["es", "Referencias", "back_matter"],
  ])("classifies %s title %s", (language, title, kind) => {
    expect(
      analyzeSections({ language, chapters: [{ title, sentences: [] }] })
        .sections[0].kind,
    ).toBe(kind);
  });

  it("leaves weak sections unclassified and suggests the first narrative section", () => {
    const analysis = analyzeSections({
      chapters: [
        {
          title: "About the Author",
          sentences: ["A short author note."],
          evidence: "spine",
        },
        {
          title: "Chapter I",
          sentences: ["The story begins."],
          evidence: "heading",
        },
        { title: "Untitled section", sentences: ["Unknown content."] },
      ],
    });
    expect(analysis.sections.map((section) => section.kind)).toEqual([
      "front_matter",
      "chapter",
      "unclassified",
    ]);
    expect(analysis.startChapter).toBe(1);
    expect(analysis.sections[2].reason).toBe("unknown_boundary");
    expect(analysis.sections[2].excerpt).toBe("Unknown content.");
  });

  it("allows a temporary title, kind and start correction", () => {
    const original = {
      startChapter: 0,
      chapters: [{ title: "Section 1", sentences: ["The story begins."] }],
    };
    const reviewed = applySectionReview(original, 0, {
      title: "Chapter One",
      kind: "chapter",
      startHere: true,
    });
    expect(reviewed.chapters[0].title).toBe("Chapter One");
    expect(reviewed.chapters[0].reviewedKind).toBe("chapter");
    expect(reviewed.startChapter).toBe(0);
    expect(original.chapters[0].title).toBe("Section 1");
  });
});

describe("temporary lexical search", () => {
  const book = {
    language: "es",
    chapters: [
      {
        title: "El río",
        sentences: [
          "Mira llevaba una linterna azul.",
          "Los pájaros cantaban junto al río.",
          "La luz estaba junto al faro.",
        ],
      },
      { title: "Notas", sentences: ["Bibliografía y notas."] },
    ],
  };

  it("ranks complete lexical matches above labelled partial matches", () => {
    const indexed = { ...book, searchIndex: buildSearchIndex(book) };
    const hits = searchBook(indexed, "pajaros rio");
    expect(hits[0]).toMatchObject({
      chapter: 0,
      sentence: 1,
      match: "exact",
      citation: "0001-00002",
    });
    expect(searchBook(indexed, "linterna faro")[0].match).toBe("partial");
  });

  it("folds accents, removes stopwords, filters chapters and abstains", () => {
    const indexed = { ...book, searchIndex: buildSearchIndex(book) };
    expect(searchBook(indexed, "pajaros rio")[0].text).toContain("pájaros");
    expect(searchBook(indexed, "el la de y")).toEqual([]);
    expect(searchBook(indexed, "bibliografia", 1)[0].title).toBe("Notas");
    expect(searchBook(indexed, "unicornio")).toEqual([]);
  });

  it("returns neighbouring sentence context and exact citations", () => {
    const hit = searchBook(book, "pajaros")[0];
    expect(hit.context).toBe(
      "Mira llevaba una linterna azul. … La luz estaba junto al faro.",
    );
    expect(hit.citation).toBe("0001-00002");
  });
});
