import { analyzeSections } from "./analysis";
import { buildSearchIndex } from "./search";
import { parseBookFile } from "./parsers";

self.addEventListener("message", async (event) => {
  const { file, language, options } = event.data || {};
  const progress = (value) => self.postMessage({ type: "progress", value });
  try {
    const book = await parseBookFile(file, language, progress, options);
    progress({ stage: "structuring", current: 1, total: 1 });
    book.analysis = analyzeSections(book);
    book.startChapter = book.analysis.startChapter;
    progress({ stage: "indexing", current: 0, total: book.chapters.length });
    book.searchIndex = buildSearchIndex(book);
    progress({
      stage: "indexing",
      current: book.chapters.length,
      total: book.chapters.length,
    });
    self.postMessage({ type: "complete", book });
  } catch (error) {
    self.postMessage({
      type: "error",
      code: error.code || "processingError",
      message: error.code ? "" : String(error.message || error),
    });
  }
});
