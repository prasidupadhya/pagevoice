import { buildSearchIndex, searchBook } from "../browser/search";
// Holds the open book and its keyword index, built here once per book version
// so the page never stores or transfers it.
let book;
self.onmessage = ({ data }) => {
  if (data.book) {
    book = data.book;
    book.searchIndex = buildSearchIndex(book);
    return;
  }
  if (!book) return;
  self.postMessage({
    id: data.id,
    hits: searchBook(book, data.query, data.chapter),
  });
};
