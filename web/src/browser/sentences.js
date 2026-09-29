const HONORIFICS = {
  en: new Set([
    "mr",
    "mrs",
    "ms",
    "dr",
    "prof",
    "rev",
    "st",
    "jr",
    "sr",
    "vs",
    "no",
    "fig",
    "pp",
    "vol",
  ]),
  es: new Set([
    "sr",
    "sra",
    "srta",
    "dr",
    "dra",
    "prof",
    "profa",
    "d",
    "dña",
    "ud",
    "uds",
    "núm",
    "num",
    "pág",
    "págs",
    "pag",
    "pags",
    "art",
    "arts",
    "vol",
    "fig",
    "aprox",
  ]),
};

const ABBREVIATIONS =
  /\b(?:e\.g\.|i\.e\.|p\.\s?ej\.|a\.m\.|p\.m\.|EE\.\s?UU\.)/gi;
const NETWORK =
  /(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[\w-]+\.(?:com|org|net|edu|gov|es|io)(?:\/[^\s<>]*)?/gi;

/** English/Spanish sentence splitting ported from pagevoice/text.py. */
export function splitSentences(input, language = "en") {
  const lang = language === "es" ? "es" : "en";
  const text = String(input || "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return [];
  const protectedPositions = new Set();
  for (const pattern of [ABBREVIATIONS, NETWORK]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      let end = match.index + match[0].length;
      if (pattern === NETWORK) {
        while (end > match.index && ".!?;,:”»\"'’".includes(text[end - 1]))
          end--;
      }
      for (let i = match.index; i < end; i++) protectedPositions.add(i);
    }
  }

  const result = [];
  let start = 0;
  const boundaries = /[.!?]+[”»"'’)]*/gu;
  for (const match of text.matchAll(boundaries)) {
    const punctuation = match[0];
    const position = match.index;
    const end = position + punctuation.length;
    if (protectedPositions.has(position)) continue;
    if (punctuation.startsWith(".")) {
      if (
        position > 0 &&
        position + 1 < text.length &&
        /\d/u.test(text[position - 1]) &&
        /\d/u.test(text[position + 1])
      )
        continue;
      const before = text.slice(0, position).match(/([\p{L}\p{N}]+)$/u);
      const word = before?.[1] || "";
      const following = text.slice(end).trimStart();
      if (
        following &&
        /^(?:\d+|[IVXLCDM]+)\.$/iu.test(text.slice(start, end).trim())
      )
        continue;
      if (following && HONORIFICS[lang].has(word.toLocaleLowerCase())) continue;
      if (following && /(?:\b[A-Z]\.)+[A-Z]$/u.test(text.slice(0, position)))
        continue;
      if (
        following &&
        /^\d/u.test(following) &&
        new Set([
          "jan",
          "feb",
          "mar",
          "apr",
          "jun",
          "jul",
          "aug",
          "sep",
          "sept",
          "oct",
          "nov",
          "dec",
          "ene",
          "abr",
          "ago",
          "dic",
        ]).has(word.toLocaleLowerCase())
      )
        continue;
      if (word.length === 1 && word === word.toUpperCase() && following) {
        const first = [...following][0];
        if (first && first === first.toLocaleUpperCase()) continue;
      }
      if (
        ["etc", "cf", "incl"].includes(word.toLocaleLowerCase()) &&
        following &&
        (/^\p{Ll}/u.test(following) || /^[,;:]/u.test(following))
      )
        continue;
      if (punctuation.startsWith("...") && /^\p{Ll}/u.test(following)) continue;
    }
    if (/^[,;:]/u.test(text.slice(end).trimStart())) continue;
    const value = text.slice(start, end).trim();
    if (value) result.push(value);
    start = end;
  }
  if (text.slice(start).trim()) result.push(text.slice(start).trim());

  const joined = [];
  for (const part of result) {
    if (joined.length && !/[\p{L}\p{N}]/u.test(part))
      joined[joined.length - 1] += part;
    else joined.push(part);
  }
  return joined;
}
