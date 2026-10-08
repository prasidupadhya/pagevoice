// Find-in-book matching. Case and accent insensitive, so "cancion" finds
// "Canción". Highlight ranges are mapped back onto the original text.
export const fold = (s) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

export function foldWithMap(text) {
  let out = "";
  const map = [];
  for (let i = 0; i < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(i)),
      folded = fold(char);
    for (let k = 0; k < folded.length; k++) map.push(i);
    out += folded;
    i += char.length;
  }
  map.push(text.length);
  return { out, map };
}

export const MIN_QUERY = 2;
export const MAX_MATCHES = 5000;

/** Returns [{ chapter, sentence }] for every sentence containing the query. */
export function findMatches(folded, query) {
  const q = fold(query.trim());
  if (q.length < MIN_QUERY) return [];
  const matches = [];
  for (let chapter = 0; chapter < folded.length; chapter++)
    for (let sentence = 0; sentence < folded[chapter].length; sentence++)
      if (folded[chapter][sentence].includes(q)) {
        matches.push({ chapter, sentence });
        if (matches.length >= MAX_MATCHES) return matches;
      }
  return matches;
}

/** Splits text into [{ text, match }] parts for rendering highlights. */
export function highlightParts(text, query) {
  const q = fold(query.trim());
  if (q.length < MIN_QUERY) return [{ text, match: false }];
  const { out, map } = foldWithMap(text),
    parts = [];
  let cursor = 0;
  for (let at = out.indexOf(q); at !== -1; at = out.indexOf(q, at + q.length)) {
    const start = map[at],
      end = map[at + q.length];
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
