/** Bounded two-language heuristic, not a universal detector or model confidence. */
const MARKERS = {
  en: new Set(
    "the and of to in was were with she he they his her their had have has from this that which who would could should been when then there them we you your our into through said but an for on not it is are as at its".split(
      " ",
    ),
  ),
  es: new Set(
    "el la los las de del al que por para con una unos unas su sus se le les ella ellos ellas él en y es son era eran fue fueron había habían como cuando donde desde hacia entre estaba estaban este esta estos estas dijo pero sin un lo allí también muy más".split(
      " ",
    ),
  ),
};

function unsupportedLanguage() {
  const error = new Error("unsupportedLanguage");
  error.code = "unsupportedLanguage";
  throw error;
}

export function detectLanguage(texts, metadata = "", override = "") {
  const declared = String(metadata || "")
    .trim()
    .toLowerCase()
    .replace(/_/gu, "-")
    .split("-")[0];
  if (override && override !== "auto") {
    if (!["en", "es"].includes(override)) unsupportedLanguage();
    return {
      language: override,
      source: "manual",
      confidence: "high",
      review: false,
      scores: { en: 0, es: 0 },
      metadata: declared,
      metadata_mismatch: false,
    };
  }
  const parts =
    texts.length > 24
      ? Array.from(
          { length: 24 },
          (_, i) => texts[Math.round((i * (texts.length - 1)) / 23)],
        )
      : texts;
  const scores = { en: 0, es: 0 };
  for (const value of parts) {
    const text = String(value);
    const middle = Math.floor(text.length / 2);
    const sample =
      text.length <= 6000
        ? text
        : `${text.slice(0, 2000)} ${text.slice(middle - 1000, middle + 1000)} ${text.slice(-2000)}`;
    const counts = new Map();
    for (const word of sample
      .normalize("NFC")
      .toLowerCase()
      .match(/\p{L}+/gu) || [])
      counts.set(word, (counts.get(word) || 0) + 1);
    for (const code of ["en", "es"])
      for (const word of MARKERS[code])
        scores[code] += Math.min(20, counts.get(word) || 0);
  }
  const winner = scores.es > scores.en ? "es" : "en";
  const total = scores.en + scores.es;
  const share = total ? scores[winner] / total : 0;
  const strong =
    scores[winner] >= 3 && share >= 0.7 && Math.abs(scores.en - scores.es) >= 2;
  if (declared && !["en", "es"].includes(declared)) unsupportedLanguage();
  const chosen = strong
    ? winner
    : ["en", "es"].includes(declared)
      ? declared
      : "en";
  const mismatch = Boolean(strong && declared && chosen !== declared);
  return {
    language: chosen,
    source: strong ? "text" : declared ? "metadata" : "fallback",
    confidence:
      strong && scores[winner] >= 8 && share >= 0.8
        ? "high"
        : strong
          ? "medium"
          : "low",
    review: !strong || mismatch,
    scores,
    metadata: declared,
    metadata_mismatch: mismatch,
  };
}
