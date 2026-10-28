/** Dialogue attribution is deliberately conservative and reviewable. */
export function detectCharacters(book) {
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
  return {
    characters: [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 80),
    speakers: { ...speakers, ...book.manualSpeakers },
  };
}
