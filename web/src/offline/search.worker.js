import { searchBook } from "../browser/search";
let book;
self.onmessage = ({ data }) => {
  if (data.book) {
    book = data.book;
    return;
  }
  if (!book) return;
  self.postMessage({
    id: data.id,
    hits: searchBook(book, data.query, data.chapter),
  });
};
