import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { Blob } from "node:buffer";
import JSZip from "jszip";
import { LibraryStore, hashText, opfsWritable } from "./library";
const book = () => ({
  title: "A book",
  author: "Someone",
  language: "en",
  format: "epub",
  chapters: [
    {
      title: "Chapter 1",
      source: "book.xhtml#ch1",
      sentences: ["The first sentence.", "The next sentence."],
    },
  ],
  sourceSize: 120,
});
let stores = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:${Math.random()}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  for (const s of stores) s.dispose();
  stores = [];
  vi.unstubAllGlobals();
});
async function store(name = "test") {
  const s = await new LibraryStore({ name, opfs: false }).init();
  stores.push(s);
  return s;
}
it("persists books, positions and actual audio across a fresh store", async () => {
  const a = await store(),
    b = await a.add(book());
  const signature = await hashText("voice+text");
  await a.putAudio(b.id, "0:0", signature, new Blob(["sound"]), {
    duration: 2,
    rtf: 0.5,
  });
  await a.update(b.id, { position: { chapter: 0, sentence: 1 } });
  a.dispose();
  const restored = await store();
  expect(restored.list()[0].position.sentence).toBe(1);
  expect(
    await (
      await restored.getAudio(restored.get(b.id).prepared["0:0"].key)
    ).text(),
  ).toBe("sound");
});
it("keeps session-only sources and audio entirely out of persistent records", async () => {
  const a = await store(),
    b = await a.add(book(), false);
  await a.putAudio(b.id, "0:0", await hashText("text"), new Blob(["audio"]));
  const second = await store();
  expect(second.list()).toEqual([]);
  expect(await second.getAudio(a.get(b.id).prepared["0:0"].key)).toBeNull();
});
it("undo restores audio, purge removes it, and double deletion is harmless", async () => {
  const a = await store(),
    b = await a.add(book());
  await a.putAudio(b.id, "0:0", await hashText("text"), new Blob(["sound"]));
  const key = a.get(b.id).prepared["0:0"].key;
  expect(await a.softDelete(b.id)).toBeTruthy();
  expect(a.list()).toEqual([]);
  expect(await a.softDelete(b.id)).toBeNull();
  await a.restore(b.id);
  expect(await a.getAudio(key)).toBeTruthy();
  await a.purge(b.id);
  expect(a.get(b.id)).toBeUndefined();
  expect(await a.getAudio(key)).toBeNull();
  await a.purge(b.id);
});
it("recovers expired soft deletion on startup and does not resurrect a removed book", async () => {
  const a = await store(),
    b = await a.add(book());
  await a.softDelete(b.id);
  const record = a.get(b.id);
  record.deletedAt = Date.now() - 9000;
  await a.write("books", record);
  a.dispose();
  expect((await store()).list()).toEqual([]);
  expect(
    await a.putAudio(b.id, "0:1", await hashText("x"), new Blob(["x"])),
  ).toBeUndefined();
});
it("serializes independent concurrent position and audio writes", async () => {
  const a = await store(),
    b = await a.add(book());
  await Promise.all([
    a.update(b.id, { position: { chapter: 0, sentence: 1 } }),
    a.putAudio(b.id, "0:0", await hashText("sound"), new Blob(["sound"])),
  ]);
  expect(a.get(b.id).position.sentence).toBe(1);
  expect(a.get(b.id).prepared["0:0"]).toBeTruthy();
  expect((await store()).get(b.id).prepared["0:0"]).toBeTruthy();
});
it("backup imports with new ownership, restores audio, and deleting a sibling cannot remove it", async () => {
  const a = await store(),
    b = await a.add(book());
  await a.putAudio(b.id, "0:0", await hashText("sound"), new Blob(["sound"]), {
    duration: 2,
  });
  const archive = await a.backup();
  const [id] = await a.importBackup(archive);
  expect(id).not.toBe(b.id);
  const key = a.get(id).prepared["0:0"].key;
  expect(key.startsWith(id + "/")).toBe(true);
  await a.purge(b.id);
  expect(await (await a.getAudio(key)).text()).toBe("sound");
});
it("rejects malformed and traversal backup IDs before any mutation", async () => {
  const a = await store();
  const z = new JSZip();
  z.file(
    "library.json",
    JSON.stringify({
      version: 1,
      books: [{ ...book(), id: "../../somewhere" }],
    }),
  );
  await expect(
    a.importBackup(new Blob([await z.generateAsync({ type: "uint8array" })])),
  ).rejects.toThrow("invalidBackup");
  expect(a.list()).toEqual([]);
});
it("revokes cover URLs when removing and disposing books", async () => {
  const a = await store(),
    b = await a.add({ ...book(), coverBlob: new Blob(["cover"]) }, false);
  const url = a.coverURL(b);
  expect(a.coverURL(b)).toBe(url);
  await a.softDelete(b.id);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  await a.restore(b.id);
  a.coverURL(a.get(b.id));
  a.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it("falls back to session storage when IndexedDB is unavailable", async () => {
  vi.stubGlobal("indexedDB", undefined);
  const a = await store(),
    b = await a.add(book());
  expect(b.keep).toBe(false);
  await a.putAudio(b.id, "0:0", await hashText("x"), new Blob(["x"]));
  await a.clear();
  expect(a.list()).toEqual([]);
});
it("a stale tab cannot resurrect a deleted book or lose a concurrent write", async () => {
  const a = await store(),
    bookRecord = await a.add(book()),
    b = await store();
  await a.update(bookRecord.id, { position: { chapter: 0, sentence: 1 } });
  await b.update(bookRecord.id, { title: "Changed in another tab" });
  expect(b.get(bookRecord.id).position.sentence).toBe(1);
  await a.softDelete(bookRecord.id);
  expect(await b.update(bookRecord.id, { title: "Do not restore" })).toBeNull();
  expect(b.list()).toHaveLength(0);
  await a.purge(bookRecord.id);
  expect(await b.update(bookRecord.id, { title: "Still removed" })).toBeNull();
  expect((await store()).list()).toHaveLength(0);
});
it("purging a book wins over an in-flight render result", async () => {
  const a = await store(),
    b = await a.add(book());
  await a.softDelete(b.id);
  await a.putAudio(b.id, "0:0", await hashText("speech"), new Blob(["speech"]));
  expect(Object.keys(a.get(b.id).prepared)).toHaveLength(0);
  await a.purge(b.id);
  expect((await store()).list()).toHaveLength(0);
});

it("keeps a book for the session when the browser cannot store its files", async () => {
  const a = await store();
  vi.spyOn(a, "writeBook").mockRejectedValueOnce(new Error("storageError"));
  const b = await a.add({ ...book(), sourceFile: new Blob(["x"]) });
  expect(b.keep).toBe(false);
  expect(b.storageFallback).toBe(true);
  expect(a.list()).toHaveLength(1);
  const fresh = await store();
  expect(fresh.list()).toEqual([]);
});

it("still reports a full disk instead of silently keeping the book", async () => {
  const a = await store();
  const full = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  vi.spyOn(a, "writeBook").mockRejectedValueOnce(full);
  await expect(a.add(book())).rejects.toThrow("full");
  expect(a.list()).toEqual([]);
});

it("stores book files as bytes so browsers that reject Blobs in IndexedDB keep the book", async () => {
  const a = await store("bytes");
  // Simulate a browser whose IndexedDB refuses Blobs (probed at startup).
  a.packBlobs = true;
  const realWrite = a.writeBook.bind(a);
  vi.spyOn(a, "writeBook").mockImplementation((parts) => {
    for (const value of [parts.meta, parts.content])
      if (Object.values(value).some((v) => v instanceof Blob))
        throw new Error("DataCloneError: Blob");
    return realWrite(parts);
  });
  const source = new Blob(["epub bytes"], { type: "application/epub+zip" });
  const added = await a.add({ ...book(), sourceFile: source });
  expect(added.keep).toBe(true);
  expect(added.storageFallback).toBeUndefined();
  const reopened = await store("bytes");
  const restored = await reopened.load(added.id);
  expect(restored.sourceFile).toBeInstanceOf(Blob);
  expect(await restored.sourceFile.text()).toBe("epub bytes");
  expect(restored.sourceFile.type).toBe("application/epub+zip");
});

it("treats a file that is already gone as removed instead of failing", async () => {
  const a = await store("gone");
  const missing = Object.assign(new Error("missing"), {
    name: "NotFoundError",
  });
  a.audioDir = {
    removeEntry: vi.fn(async () => {
      throw missing;
    }),
  };
  await expect(a.removeFile("0123.wav")).resolves.toBeUndefined();
  a.audioDir = {
    removeEntry: vi.fn(async () => {
      throw new Error("denied");
    }),
  };
  await expect(a.removeFile("0123.wav")).rejects.toThrow("denied");
});

it("detects an OPFS directory that opens but refuses writes, so storage can fall back", async () => {
  const refusing = {
    getFileHandle: async () => ({
      createWritable: async () => {
        throw Object.assign(new Error("unknown transient reason"), {
          name: "UnknownError",
        });
      },
    }),
    removeEntry: async () => {},
  };
  expect(await opfsWritable(refusing)).toBe(false);
});

it("keeps a cover image intact across a reload when browsers expose Blob.bytes()", async () => {
  const a = await store("cover");
  const cover = new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  });
  const added = await a.add({ ...book(), coverBlob: cover });
  const reopened = await store("cover");
  const restored = reopened.get(added.id).coverBlob;
  expect(restored).toBeInstanceOf(Blob);
  expect(restored.type).toBe("image/png");
  expect(Array.from(new Uint8Array(await restored.arrayBuffer()))).toEqual([
    137, 80, 78, 71,
  ]);
});
it("gives new books an on-device voice for their language", async () => {
  const s = await store("voices");
  expect((await s.add(book())).settings).toMatchObject({
    engine: "local",
    voice: "af_heart",
  });
  expect((await s.add({ ...book(), language: "es" })).settings.voice).toBe(
    "davefx",
  );
});
it("resets books narrated by an earlier service so they use local voices", async () => {
  const s = await store("migrate");
  const added = await s.add({
    ...book(),
    settings: { engine: "elevenlabs", voice: "voice123", cast: {}, buffer: 20 },
  });
  await s.putAudio(added.id, "0:0", "a".repeat(64), new Blob(["mp3"]), {
    duration: 1,
  });
  s.dispose();
  stores = stores.filter((x) => x !== s);
  const reopened = await store("migrate");
  const b = reopened.get(added.id);
  expect(b.settings).toEqual({
    engine: "local",
    voice: "af_heart",
    cast: {},
    buffer: 5,
  });
  expect(b.prepared).toEqual({});
});
it("opens the shelf without reading book text, and loads it when a book is opened", async () => {
  const a = await store("split");
  const added = await a.add({
    ...book(),
    searchIndex: [{ tokens: ["first"] }],
  });
  const reopened = await store("split");
  const listed = reopened.get(added.id);
  expect(listed.chapters).toBeUndefined();
  expect(listed.outline).toEqual([{ title: "Chapter 1", length: 2 }]);
  const loaded = await reopened.load(added.id);
  expect(loaded.chapters[0].sentences).toEqual(book().chapters[0].sentences);
  // The keyword index is rebuilt by the search worker, never stored.
  expect(loaded.searchIndex).toBeUndefined();
});
it("small updates leave the text alone; edits update the text and the outline", async () => {
  const a = await store("updates");
  const added = await a.add(book());
  await a.update(added.id, { position: { chapter: 0, sentence: 1 } });
  const chapters = [{ title: "Renamed", source: "x", sentences: ["One."] }];
  await a.update(added.id, { chapters });
  const reopened = await store("updates");
  expect(reopened.get(added.id).position.sentence).toBe(1);
  expect(reopened.get(added.id).outline).toEqual([
    { title: "Renamed", length: 1 },
  ]);
  expect((await reopened.load(added.id)).chapters).toEqual(chapters);
});
it("moves the text of books saved by the previous version into its own store", async () => {
  const name = "upgrade";
  const legacy = indexedDB.open(name, 1);
  legacy.onupgradeneeded = () => {
    legacy.result.createObjectStore("books", { keyPath: "id" });
    legacy.result
      .createObjectStore("audio", { keyPath: "key" })
      .createIndex("book", "bookId");
    legacy.result.createObjectStore("prefs");
  };
  const db = await new Promise(
    (r) => (legacy.onsuccess = () => r(legacy.result)),
  );
  await new Promise((r) => {
    const tx = db.transaction("books", "readwrite");
    tx.objectStore("books").put({
      ...book(),
      id: "old",
      keep: true,
      created: 1,
      prepared: {},
      position: { chapter: 0, sentence: 0 },
      settings: { engine: "local", voice: "af_heart", cast: {}, buffer: 5 },
    });
    tx.oncomplete = r;
  });
  db.close();
  const s = await store(name);
  expect(s.get("old").chapters).toBeUndefined();
  expect(s.get("old").outline).toEqual([{ title: "Chapter 1", length: 2 }]);
  expect((await s.load("old")).chapters[0].sentences).toHaveLength(2);
});
it("removes many audio sentences at once", async () => {
  const s = await store("many");
  const added = await s.add(book());
  for (const row of ["0:0", "0:1"])
    await s.putAudio(added.id, row, "b".repeat(64), new Blob([row]), {
      duration: 1,
    });
  const keys = Object.values(s.get(added.id).prepared).map((a) => a.key);
  await s.deleteAudios(keys);
  for (const key of keys) expect(await s.getAudio(key)).toBeFalsy();
});
it("an update that finishes after the text loads keeps the text in memory", async () => {
  const a = await store("race");
  const added = await a.add(book());
  const s = await store("race");
  const updating = s.update(added.id, { lastOpened: 5 });
  await s.load(added.id);
  await updating;
  expect(s.get(added.id).lastOpened).toBe(5);
  expect(s.get(added.id).chapters).toHaveLength(1);
});
it("other tabs keep the open text on small changes and see edited text", async () => {
  const a = await store("tabs"),
    added = await a.add(book()),
    b = await store("tabs");
  await b.load(added.id);
  const settle = () => new Promise((r) => setTimeout(r, 50));
  await a.update(added.id, { position: { chapter: 0, sentence: 1 } });
  await settle();
  expect(b.get(added.id).position.sentence).toBe(1);
  expect(b.get(added.id).chapters).toHaveLength(1);
  const chapters = [{ title: "Edited", source: "x", sentences: ["New."] }];
  await a.update(added.id, { chapters });
  await settle();
  expect(b.get(added.id).chapters).toEqual(chapters);
});
