import { describe, expect, it, vi } from "vitest";
import { BrowserBackend } from "./BrowserBackend";

describe("temporary browser storage", () => {
  it("revokes cover URLs on removal, restores a fresh URL on Undo, then frees memory", async () => {
    let url = 0;
    const objectUrls = {
      createObjectURL: vi.fn(() => "blob:pagevoice-" + ++url),
      revokeObjectURL: vi.fn(),
    };
    let worker;
    const backend = new BrowserBackend({
      objectUrls,
      workerFactory: () => {
        worker = {
          onmessage: null,
          onerror: null,
          postMessage() {
            queueMicrotask(() =>
              worker.onmessage({
                data: {
                  type: "complete",
                  book: {
                    title: "A Short Reader",
                    cover: new Blob(["cover"]),
                    chapters: [
                      {
                        title: "Chapter One",
                        sentences: ["Mira opened the door."],
                      },
                    ],
                    analysis: { sections: [] },
                    searchIndex: [],
                  },
                },
              }),
            );
          },
          terminate: vi.fn(),
        };
        return worker;
      },
    });
    const book = await backend.importBook({ name: "reader.epub" }, "en");
    expect(book.cover).toBe("blob:pagevoice-1");
    backend.softDelete(book.id);
    expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith("blob:pagevoice-1");
    expect(backend.hasTemporaryData).toBe(true);
    const restored = backend.restore(book.id);
    expect(restored.cover).toBe("blob:pagevoice-2");
    backend.softDelete(book.id);
    backend.purge(book.id);
    expect(restored.chapters).toEqual([]);
    expect(restored.searchIndex).toEqual([]);
    expect(restored.coverBlob).toBeNull();
    expect(backend.hasTemporaryData).toBe(false);
  });

  it("settles and terminates a pending worker when the session is cleared", async () => {
    let worker;
    const backend = new BrowserBackend({
      workerFactory: () => {
        worker = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          onmessage: null,
          onerror: null,
        };
        return worker;
      },
    });
    const pending = backend.importBook({ name: "reader.pdf" }, "en");
    backend.clear();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(backend.workers.size).toBe(0);
  });
});
