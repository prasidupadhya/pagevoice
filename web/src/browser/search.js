const STOPWORDS = {
  en: new Set(
    "a an and are as at be been but by for from had has have he her hers him his i if in into is it its me my of on or our she so than that the their them then there they this to was we were what when where which who will with you your".split(
      " ",
    ),
  ),
  es: new Set(
    "a al algo como con contra cual cuando de del desde donde el ella ellas ellos en entre era es esa ese eso esta este esto fue ha hasta la las le les lo los más me mi mis ni no o para pero por que se sin su sus te tu tus un una uno unas unos y ya".split(
      " ",
    ),
  ),
};

export function foldSearchText(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/ñ/g, "\uE000")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uE000/g, "ñ");
}

export function queryTerms(value, language) {
  return (
    foldSearchText(value)
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => word.length > 1 && !STOPWORDS[language].has(word)) ||
    []
  );
}

/** Build once in the parsing worker; this compact record list stays in memory. */
export function buildSearchIndex(book) {
  const language = book.language === "es" ? "es" : "en";
  return (book.chapters || []).flatMap((chapter, chapterIndex) =>
    (chapter.sentences || []).map((text, sentenceIndex) => ({
      chapter: chapterIndex,
      sentence: sentenceIndex,
      tokens: queryTerms(text, language),
    })),
  );
}

export function searchBook(book, query, chapterFilter = "") {
  const language = book.language === "es" ? "es" : "en";
  const terms = [...new Set(queryTerms(String(query).slice(0, 500), language))];
  if (!terms.length) return [];
  const index = book.searchIndex || buildSearchIndex(book);
  return index
    .filter(
      (record) =>
        (chapterFilter === "" || record.chapter === Number(chapterFilter)) &&
        record.tokens.length,
    )
    .map((record) => {
      const tokenSet = new Set(record.tokens);
      const matched = terms.filter((term) => tokenSet.has(term));
      if (!matched.length) return null;
      const chapter = book.chapters[record.chapter];
      const match = matched.length === terms.length ? "exact" : "partial";
      const sentences = chapter.sentences || [];
      return {
        chapter: record.chapter,
        sentence: record.sentence,
        title: chapter.title,
        text: sentences[record.sentence],
        context: [
          sentences[record.sentence - 1],
          sentences[record.sentence + 1],
        ]
          .filter(Boolean)
          .join(" … "),
        citation: `${String(record.chapter + 1).padStart(4, "0")}-${String(record.sentence + 1).padStart(5, "0")}`,
        match,
        matchedTerms: matched,
        score:
          match === "exact"
            ? 100 + matched.length
            : 20 + matched.length / terms.length,
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score || a.chapter - b.chapter || a.sentence - b.sentence,
    )
    .slice(0, 100);
}
