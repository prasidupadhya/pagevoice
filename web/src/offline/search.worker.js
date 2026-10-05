import { searchBook } from "../browser/search";
import { mergeSemanticHits } from "./knowledge";
let book;
self.onmessage = ({ data }) => {
  if (data.book) {
    book = data.book;
    return;
  }
  if (!book) return;
  const hits = searchBook(book, data.query, data.chapter);
  self.postMessage({
    id: data.id,
    hits: data.vector
      ? mergeSemanticHits(book, data.query, hits, data.vector, data.chapter)
      : hits,
  });
};
