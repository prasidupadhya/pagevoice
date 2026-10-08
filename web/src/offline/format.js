export const bytes = (n) => {
  if (!n) return "0 B";
  const unit = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** unit).toFixed(unit ? 1 : 0)} ${["B", "KB", "MB", "GB"][unit]}`;
};
export const duration = (n) => {
  const v = Math.max(0, Math.round(n || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Progress is measured from the detected start of the content, so skipped front
// matter (title pages, contents) does not make a new book look partly read.
export function progressOf(book) {
  const lengths = book.chapters.map((c) => c.sentences.length),
    before = (n) => lengths.slice(0, n).reduce((a, b) => a + b, 0),
    start = before(Math.min(book.startChapter || 0, book.position.chapter)),
    total = before(lengths.length) - start;
  if (total <= 0) return 0;
  const read = before(book.position.chapter) + book.position.sentence - start;
  return Math.min(100, Math.max(0, Math.round((read / total) * 100)));
}
export function relativeTime(timestamp, locale, now = Date.now()) {
  const seconds = Math.round((timestamp - now) / 1000),
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ])
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  return format.format(0, "minute");
}
