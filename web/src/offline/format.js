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
export function progressOf(book) {
  const lengths = book.chapters.map((c) => c.sentences.length),
    total = lengths.reduce((a, b) => a + b, 0);
  return total
    ? Math.round(
        ((lengths.slice(0, book.position.chapter).reduce((a, b) => a + b, 0) +
          book.position.sentence) /
          total) *
          100,
      )
    : 0;
}
