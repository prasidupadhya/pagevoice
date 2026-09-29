import { applySectionReview } from "../browser/analysis";
import { searchBook } from "../browser/search";

/** Per-page memory-only project store; intentionally has no persistence API. */
export class BrowserBackend {
  constructor({
    workerFactory = () =>
      new Worker(new URL("../browser/reader.worker.js", import.meta.url), {
        type: "module",
      }),
    objectUrls = URL,
  } = {}) {
    this.mode = "browser";
    this.workerFactory = workerFactory;
    this.books = new Map();
    this.trash = new Map();
    this.workers = new Map();
    this.objectUrls = objectUrls;
    this.disposed = false;
  }

  list() {
    return [...this.books.values()];
  }

  get(id) {
    return this.books.get(id) || null;
  }

  get hasTemporaryData() {
    return this.books.size + this.trash.size > 0;
  }

  async importBook(file, language, { signal, onProgress = () => {} } = {}) {
    if (this.disposed) throw new Error("The temporary session has ended.");
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const worker = this.workerFactory();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        worker.terminate();
        this.workers.delete(worker);
      };
      const abort = () => {
        finish();
        reject(new DOMException("Cancelled", "AbortError"));
      };
      this.workers.set(worker, abort);
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.type === "progress") {
          onProgress(message.value);
          return;
        }
        if (message.type === "error") {
          finish();
          reject(new Error(message.code || "processingError"));
          return;
        }
        if (message.type !== "complete") return;
        finish();
        const parsed = message.book;
        const id =
          globalThis.crypto?.randomUUID?.() ||
          `book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const coverUrl = parsed.cover
          ? this.objectUrls.createObjectURL(parsed.cover)
          : "";
        const book = {
          ...parsed,
          cover: coverUrl,
          coverBlob: parsed.cover || null,
          id,
          filename: file.name,
          deleted: false,
        };
        this.books.set(id, book);
        resolve(book);
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error(event.message || "processingError"));
      };
      try {
        worker.postMessage({ type: "import", file, language });
      } catch (error) {
        finish();
        reject(error);
      }
    });
  }

  review(id, chapterIndex, patch) {
    const book = this.get(id);
    if (!book) return null;
    const reviewed = applySectionReview(book, chapterIndex, patch);
    this.books.set(id, reviewed);
    return reviewed;
  }

  search(id, query, chapterFilter = "") {
    const book = this.get(id);
    return book ? searchBook(book, query, chapterFilter) : [];
  }

  softDelete(id) {
    const book = this.books.get(id);
    if (!book) return null;
    this.books.delete(id);
    book.deleted = true;
    this.#revokeCover(book);
    this.trash.set(id, book);
    return book;
  }

  restore(id) {
    const book = this.trash.get(id);
    if (!book) return null;
    this.trash.delete(id);
    book.deleted = false;
    if (book.coverBlob)
      book.cover = this.objectUrls.createObjectURL(book.coverBlob);
    this.books.set(id, book);
    return book;
  }

  purge(id) {
    const book = this.trash.get(id);
    if (!book) return false;
    this.trash.delete(id);
    this.#release(book);
    return true;
  }

  clear() {
    for (const cancel of [...this.workers.values()]) cancel();
    for (const book of [...this.books.values(), ...this.trash.values()])
      this.#release(book);
    this.books.clear();
    this.trash.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
  }

  #release(book) {
    this.#revokeCover(book);
    book.coverBlob = null;
    book.searchIndex = [];
    book.chapters = [];
    book.analysis = { sections: [] };
  }

  #revokeCover(book) {
    if (book.cover?.startsWith("blob:"))
      this.objectUrls.revokeObjectURL(book.cover);
    book.cover = "";
  }
}
