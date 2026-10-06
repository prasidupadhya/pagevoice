/** Short passages keep sentence citations stable and avoid diluting embeddings
 * with unrelated neighbours. Long sentences use overlapping whole-word windows. */
export function passageRows(book) {
  const rows = [];
  for (const [chapter, c] of book.chapters.entries())
    for (const [sentence, text] of c.sentences.entries()) {
      const words = text.split(/\s+/u);
      let start = 0;
      while (start < words.length) {
        let end = start,
          length = 0;
        while (end < words.length && length + words[end].length <= 1000) {
          length += words[end].length + 1;
          end++;
        }
        if (end === start) {
          start++;
          continue;
        } // Oversized tokens are never fed to a model.
        rows.push({
          chapter,
          sentence,
          text: words.slice(start, end).join(" "),
          offset: start,
        });
        if (end === words.length) break;
        start = Math.max(start + 1, end - 12);
      }
    }
  return rows;
}
