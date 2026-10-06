import { searchBook, queryTerms } from "../browser/search";
/** Dialogue attribution is deliberately conservative and reviewable. */
export function detectCharacters(book, entities = []) {
  const counts = new Map(),
    speakers = {};
  for (const character of book.characters?.characters || [])
    if (character.source === "manual review")
      counts.set(character.name, { ...character, count: 0 });
  const add = (name, row, source) => {
    const cleaned = name.replace(/^[\s—–"“«]+|[\s”».,:;!?]+$/gu, "").trim();
    if (
      !cleaned ||
      cleaned.length > 50 ||
      /^(The|This|That|He|She|They|El|Ella|Él|Los|La|It|I|We|You)$/u.test(
        cleaned,
      )
    )
      return;
    const previous = counts.get(cleaned) || {
      name: cleaned,
      count: 0,
      source,
      first: row,
    };
    previous.count++;
    counts.set(cleaned, previous);
    return cleaned;
  };
  for (const [chapter, c] of book.chapters.entries())
    for (const [sentence, text] of c.sentences.entries()) {
      if (!/["“«»”]|^\s*[—–]/u.test(text)) continue;
      const after = text.match(
        /(?:said|asked|replied|whispered|dijo|preguntó|respondió|susurró)\s+([\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)?)/u,
      );
      const before = text.match(
        /([\p{Lu}][\p{L}'’-]+)\s+(?:said|asked|replied|dijo|preguntó|respondió)/u,
      );
      const name = add(
        after?.[1] || before?.[1] || "",
        { chapter, sentence },
        "inferred: dialogue heuristic",
      );
      if (name) speakers[`${chapter}:${sentence}`] = name;
    }
  for (const e of entities)
    if (e.label === "PER" || e.label === "PERSON")
      add(
        e.name,
        { chapter: e.chapter, sentence: e.sentence },
        "inferred: local NER",
      );
  return {
    characters: [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 80),
    speakers: { ...speakers, ...book.manualSpeakers },
  };
}
export function mergeSemanticHits(book, query, lexical, vector, chapter = "") {
  if (
    !queryTerms(query, book.language).length ||
    !book.semantics?.records?.length
  )
    return lexical;
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const candidates = book.semantics.records
    .filter((r) => chapter === "" || r.chapter === Number(chapter))
    .map((r) => ({ ...r, similarity: dot(r.vector, vector) }))
    .filter((r) => r.similarity >= 0.45)
    .sort((a, b) => b.similarity - a.similarity);
  const semantic = [
    ...new Map(
      candidates.map((r) => [`${r.chapter}:${r.sentence}`, r]).reverse(),
    ).values(),
  ]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 20);
  const ranked = new Map(
    lexical.map((h, i) => [
      `${h.chapter}:${h.sentence}`,
      { ...h, score: 1 / (60 + i + 1), lexicalScore: h.score },
    ]),
  );
  for (const [i, r] of semantic.entries()) {
    const key = `${r.chapter}:${r.sentence}`,
      previous = ranked.get(key);
    if (previous) {
      previous.score += 1 / (60 + i + 1);
      previous.similarity = r.similarity;
      continue;
    }
    const c = book.chapters[r.chapter];
    ranked.set(key, {
      chapter: r.chapter,
      sentence: r.sentence,
      title: c.title,
      text: c.sentences[r.sentence],
      context: c.sentences.slice(r.sentence + 1, r.sentence + 3).join(" "),
      citation: `${String(r.chapter + 1).padStart(4, "0")}-${String(r.sentence + 1).padStart(5, "0")}`,
      match: "semantic",
      matchedTerms: [],
      score: 1 / (60 + i + 1),
      similarity: r.similarity,
    });
  }
  return [...ranked.values()]
    .sort(
      (a, b) =>
        b.score - a.score || a.chapter - b.chapter || a.sentence - b.sentence,
    )
    .slice(0, 40);
}
export function lexicalSearch(book, query, chapter = "") {
  return searchBook(book, query, chapter);
}
