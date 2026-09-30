const FRONT = new Set([
  "preface",
  "foreword",
  "introduction",
  "prologue",
  "acknowledgments",
  "acknowledgements",
  "dedication",
  "copyright",
  "contents",
  "epigraph",
  "about the author",
  "author biography",
  "author's life",
  "life of the author",
  "biography of the author",
  "table of contents",
  "biography",
  "prefacio",
  "prólogo",
  "prologo",
  "introducción",
  "introduccion",
  "agradecimientos",
  "dedicatoria",
  "derechos de autor",
  "créditos",
  "creditos",
  "índice",
  "epígrafe",
  "epigrafe",
  "sobre el autor",
  "sobre la autora",
  "vida del autor",
  "vida de la autora",
  "biografía del autor",
  "biografía",
  "biografia",
]);
const BACK = new Set([
  "index",
  "references",
  "endnotes",
  "bibliography",
  "appendix",
  "appendices",
  "epilogue",
  "notes",
  "glossary",
  "bibliografía",
  "bibliografia",
  "apéndice",
  "apendice",
  "epílogo",
  "epilogo",
  "notas",
  "referencias",
  "glosario",
]);

function fold(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/ñ/g, "\uE000")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uE000/g, "ñ")
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;!?]+$/g, "");
}

function titleKind(title) {
  const value = fold(title);
  const startsWithKeyword = (keywords) =>
    [...keywords].some((entry) => {
      const keyword = fold(entry);
      return (
        value === keyword ||
        [" ", ":", "—", "–", "-"].some((separator) =>
          value.startsWith(keyword + separator),
        )
      );
    });
  if (startsWithKeyword(FRONT)) return "front_matter";
  if (startsWithKeyword(BACK)) return "back_matter";
  if (/^(?:chapter|cap[ií]tulo)\s+(?:\S+)|^(?:part|parte)\s+\S+/iu.test(value))
    return "chapter";
  return "";
}

/** Honest, source-labelled structure classification; weak sections stay unknown. */
export function analyzeSections(book) {
  const chapters = book.chapters || [];
  const normalizedTitles = chapters.map((chapter) => fold(chapter.title));
  const firstExplicitChapter = chapters.findIndex((chapter) =>
    /^(?:chapter|cap[ií]tulo)\s+(?:1|i|one|uno|primero)\b/iu.test(
      fold(chapter.title),
    ),
  );
  const sections = chapters.map((chapter, index) => {
    const title = String(chapter.title || "");
    const role = chapter.role || "";
    const evidence = chapter.evidence || "spine";
    const semanticKind = [
      "chapter",
      "front_matter",
      "back_matter",
      "unclassified",
    ].includes(role)
      ? role
      : "";
    const keywordKind = titleKind(title);
    let kind = "unclassified";
    let confidence = "low";
    let source = chapter.source || "document";
    let reason = "unknown_boundary";

    if (chapter.reviewedKind) {
      kind = chapter.reviewedKind;
      confidence = "high";
      source = "manual review";
      reason = "reviewed";
    } else if (semanticKind) {
      kind = semanticKind;
      confidence = "high";
      source = "document role";
      reason = "document_role";
    } else if (["navigation", "outline", "bookmark"].includes(evidence)) {
      kind = keywordKind || "chapter";
      confidence = "high";
      source = evidence;
      reason = keywordKind ? "navigation_with_title" : "navigation_boundary";
    } else if (keywordKind) {
      kind = keywordKind;
      confidence = "medium";
      source = "title keyword";
      reason = "title_keyword";
    } else if (
      evidence === "heading" &&
      /^(?:\d+[.)]\s+\S+|[ivxlcdm]+\.?$)/iu.test(fold(title))
    ) {
      kind = "chapter";
      confidence = "medium";
      source = "heading";
      reason = "explicit_heading";
    } else if (
      firstExplicitChapter > 0 &&
      index < firstExplicitChapter &&
      ["spine", "page-fallback"].includes(evidence)
    ) {
      // Position alone is a review hint, not enough to silently label front matter.
      reason = "before_first_chapter";
    }

    const sentences = chapter.sentences || [];
    const words = sentences.reduce(
      (count, sentence) =>
        count + String(sentence).trim().split(/\s+/u).filter(Boolean).length,
      0,
    );
    const flags = [];
    if (
      new Set(normalizedTitles).has(normalizedTitles[index]) &&
      normalizedTitles.filter((value) => value === normalizedTitles[index])
        .length > 1
    )
      flags.push("duplicate_title");
    if (words < 20) flags.push("tiny_section");
    if (words > 12000) flags.push("huge_section");
    return {
      index,
      title,
      kind,
      confidence,
      source,
      reason,
      excerpt: sentences.slice(0, 2).join(" ").slice(0, 600),
      sentenceCount: sentences.length,
      wordCount: words,
      flags,
      subkind:
        /^(?:part|parte)\s+\S+/iu.test(fold(title)) && kind === "chapter"
          ? "part_divider"
          : null,
      review:
        confidence === "low" || kind === "unclassified" || flags.length > 0,
      sourceAnchor: chapter.source || "",
    };
  });
  const chapterStart = sections.findIndex(
    (section) =>
      section.kind === "chapter" &&
      !(section.subkind === "part_divider" && section.wordCount < 20),
  );
  const unknownStart = sections.findIndex(
    (section) => section.kind === "unclassified",
  );
  const narrativeStart = sections.findIndex(
    (section) => !["front_matter", "back_matter"].includes(section.kind),
  );
  const startChapter =
    chapterStart >= 0
      ? chapterStart
      : unknownStart >= 0
        ? unknownStart
        : Math.max(0, narrativeStart);
  return {
    sections,
    startChapter,
    reviewCount: sections.filter((section) => section.review).length,
  };
}

export function applySectionReview(book, index, patch) {
  const chapters = book.chapters.map((chapter, chapterIndex) => {
    if (chapterIndex !== index) return chapter;
    return {
      ...chapter,
      title: patch.title?.trim() || chapter.title,
      reviewedKind: patch.kind || chapter.reviewedKind,
    };
  });
  return {
    ...book,
    chapters,
    startChapter: patch.startHere ? index : book.startChapter,
    analysis: analyzeSections({ ...book, chapters }),
  };
}
