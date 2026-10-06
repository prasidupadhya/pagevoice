import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import { Blob } from "node:buffer";
import JSZip from "jszip";
import { LibraryStore, hashText } from "./library";
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
