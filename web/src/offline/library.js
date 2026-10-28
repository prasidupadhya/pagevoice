import { NARRATION, defaultVoice } from "./engines";
// JSZip is only needed for backups, so it stays out of the startup bundle.
const loadZip = async () => (await import("jszip")).default;

const request = (value) =>
  new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
const complete = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("storageError"));
  });
export const rowId = (chapter, sentence) => `${chapter}:${sentence}`;
// Narration settings. Each book starts with the first voice for its language.
export const defaultSettings = (language) => ({
  engine: NARRATION,
  voice: defaultVoice(language),
  cast: {},
  buffer: 5,
});
// Audio and voices from an earlier narration service cannot be reused.
const needsNarrationReset = (book) => book.settings?.engine !== NARRATION;
// A file that is already gone is the outcome we want, so it is not an error.
export async function removeIfPresent(dir, name) {
  if (!dir || !name) return;
  try {
    await dir.removeEntry(name);
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}
// Some browsers open an OPFS directory but refuse to write into it. Probe one
// small write so the app can fall back to IndexedDB instead of failing later.
export async function opfsWritable(dir) {
  const name = ".pagevoice-probe";
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array([1, 2, 3]));
    await writable.close();
    const size = (await (await dir.getFileHandle(name)).getFile()).size;
    await removeIfPresent(dir, name);
    return size === 3;
  } catch {
    await removeIfPresent(dir, name).catch(() => {});
    return false;
  }
}
// Some browsers cannot store Blob objects in IndexedDB. Bytes are stored as
// ArrayBuffers and rebuilt as Blobs when read, which every browser supports.
const blobBytes = (blob) =>
  typeof blob.arrayBuffer === "function"
    ? blob.arrayBuffer()
    : new Response(blob).arrayBuffer();
const packBlob = async (blob) =>
  blob instanceof Blob
    ? { bytes: await blobBytes(blob), type: blob.type }
    : blob;
const isArrayBuffer = (value) =>
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";
// A Blob already has a bytes() method in newer browsers, so only a stored
// { bytes: ArrayBuffer } record counts as packed.
const unpackBlob = (value) =>
  value instanceof Blob || !isArrayBuffer(value?.bytes)
    ? value
    : new Blob([value.bytes], { type: value.type });
// Only used when the browser cannot store Blobs (see canStoreBlobs).
const toStored = async (book) => ({
  ...book,
  sourceFile: await packBlob(book.sourceFile),
  coverBlob: await packBlob(book.coverBlob),
});
// Probe once: browsers that accept Blobs keep the original record format.
async function canStoreBlobs(db) {
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("prefs", "readwrite");
      tx.objectStore("prefs").put(new Blob(["probe"]), "__blob_probe");
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    await new Promise((resolve) => {
      const tx = db.transaction("prefs", "readwrite");
      tx.objectStore("prefs").delete("__blob_probe");
      tx.oncomplete = tx.onabort = resolve;
    });
    return true;
  } catch {
    return false;
  }
}
const fromStored = (book) => {
  if (!book) return book;
  const value = { ...book };
  for (const key of ["sourceFile", "coverBlob"])
    if (key in value) value[key] = unpackBlob(value[key]);
  return value;
};
// The large, rarely changed parts of a book are stored apart from the rest, so
// the shelf opens without reading them and small updates (reading position,
// prepared audio) do not rewrite them. The rest carries a short outline of the
// sections for the shelf.
const CONTENT = [
  "chapters",
  "analysis",
  "sourceFile",
  "characters",
  "warnings",
];
const pick = (value, keys) =>
  Object.fromEntries(keys.filter((k) => k in value).map((k) => [k, value[k]]));
const outlineOf = (chapters) =>
  chapters.map((c) => ({ title: c.title, length: c.sentences.length }));
function split(book) {
  const meta = { ...book };
  for (const key of CONTENT) delete meta[key];
  // The keyword index is rebuilt by the search worker; storing it tripled the
  // size of every book. Older records and backups may still carry one.
  delete meta.searchIndex;
  if (book.chapters) meta.outline = outlineOf(book.chapters);
  return { meta, content: { id: book.id, ...pick(book, CONTENT) } };
}
/** One sentence as a row, or undefined when it does not exist. Cheaper than
 * rowsOf when only a few sentences are needed. */
export function rowAt(book, chapter, sentence) {
  const c = book.chapters[chapter],
    text = c?.sentences[sentence];
  return text === undefined
    ? undefined
    : {
        id: rowId(chapter, sentence),
        chapter,
        sentence,
        text,
        title: c.title,
        source: c.source,
      };
}
export const rowById = (book, id) => {
  const [chapter, sentence] = id.split(":").map(Number);
  return rowAt(book, chapter, sentence);
};
/** The sentence `delta` sentences away, across section boundaries. */
export function rowAfter(book, chapter, sentence, delta) {
  let c = chapter,
    s = sentence + delta;
  while (c >= 0 && c < book.chapters.length) {
    const length = book.chapters[c].sentences.length;
    if (s < 0) {
      c--;
      if (c >= 0) s += book.chapters[c].sentences.length;
    } else if (s >= length) {
      s -= length;
      c++;
    } else return rowAt(book, c, s);
  }
}
export const sentenceCount = (book) =>
  book.chapters.reduce((n, c) => n + c.sentences.length, 0);
export const rowsOf = (book) =>
  book.chapters.flatMap((c, chapter) =>
    c.sentences.map((text, sentence) => ({
      id: rowId(chapter, sentence),
      chapter,
      sentence,
      text,
      title: c.title,
      source: c.source,
    })),
  );
export async function hashText(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Book records are atomic; audio uses OPFS when available, IndexedDB otherwise. */
export class LibraryStore {
  constructor({
    name = "pagevoice-offline-v1",
    opfs = true,
    onChange = () => {},
  } = {}) {
    this.name = name;
    this.useOPFS = opfs;
    this.books = new Map();
    this.audio = new Map();
    this.urls = new Map();
    this.writes = new Map();
    this.prefs = new Map();
    this.onChange = onChange;
    this.deletions = new Map();
  }
  async init() {
    if (!globalThis.indexedDB) {
      this.sessionOnly = true;
      return this;
    }
    const opened = indexedDB.open(this.name, 2);
    opened.onupgradeneeded = ({ oldVersion }) => {
      const db = opened.result;
      if (oldVersion < 1) {
        db.createObjectStore("books", { keyPath: "id" });
        db.createObjectStore("audio", { keyPath: "key" }).createIndex(
          "book",
          "bookId",
        );
        db.createObjectStore("prefs");
      }
      if (oldVersion < 2) {
        const content = db.createObjectStore("content", { keyPath: "id" });
        // Move the large parts of existing books into the new store.
        if (oldVersion >= 1)
          opened.transaction.objectStore("books").openCursor().onsuccess = ({
            target,
          }) => {
            const cursor = target.result;
            if (!cursor) return;
            const parts = split(cursor.value);
            content.put(parts.content);
            cursor.update(parts.meta);
            cursor.continue();
          };
      }
    };
    try {
      this.db = await request(opened);
    } catch {
      this.sessionOnly = true;
      return this;
    }
    this.db.onversionchange = () => this.db.close();
    this.packBlobs = !(await canStoreBlobs(this.db));
    if (this.useOPFS && navigator.storage?.getDirectory) {
      try {
        this.root = await navigator.storage.getDirectory();
        this.audioDir = await this.root.getDirectoryHandle("pagevoice-audio", {
          create: true,
        });
        if (!(await opfsWritable(this.audioDir))) this.audioDir = undefined;
      } catch {
        /* IDB fallback retains the same behavior. */
      }
    }
    const saved = await request(
      this.db.transaction("books").objectStore("books").getAll(),
    );
    for (const saved1 of saved) {
      const book = fromStored(saved1);
      this.books.set(book.id, book);
      if (book.deletedAt && Date.now() - book.deletedAt >= 8000)
        await this.purge(book.id);
      else if (book.deletedAt) this.schedulePurge(book);
    }
    for (const book of this.books.values())
      if (!book.deletedAt && needsNarrationReset(book)) {
        for (const a of Object.values(book.prepared || {}))
          await this.deleteAudio(a.key);
        await this.update(book.id, {
          settings: defaultSettings(book.language),
          prepared: {},
        });
      }
    if (globalThis.BroadcastChannel) {
      this.channel = new BroadcastChannel(this.name);
      this.channel.onmessage = async ({ data }) => {
        // Messages name the book and whether its text changed. Older tabs
        // send only the id.
        const { id, content: textChanged = true } =
          typeof data === "string" ? { id: data } : data || {};
        if (!this.db || typeof id !== "string") return;
        try {
          const memory = this.get(id),
            reread = textChanged && memory?.chapters,
            tx = this.db.transaction(["books", "content"]);
          const [current, content] = await Promise.all([
            request(tx.objectStore("books").get(id)),
            reread ? request(tx.objectStore("content").get(id)) : null,
          ]);
          const text = reread
            ? pick(content || {}, CONTENT)
            : memory?.chapters
              ? pick(memory, CONTENT)
              : {};
          if (current) this.books.set(id, fromStored({ ...current, ...text }));
          else {
            this.books.delete(id);
            this.revokeCover(id);
          }
          this.onChange(id, current);
        } catch {
          /* A closing tab has no live subscribers. */
        }
      };
    }
    // Orphan cleanup reads every audio record, so it runs after the shelf is
    // shown. It holds the audio lock, so it cannot race a new recording.
    this.recovered = this.lockAudio(() => this.recoverAudioFiles()).catch(
      () => {},
    );
    return this;
  }
  async recoverAudioFiles() {
    if (!this.audioDir) return;
    // A tab closing between the file write and its IDB record can leave an orphan.
    const records = await request(
      this.db.transaction("audio").objectStore("audio").getAll(),
    );
    const retained = new Set(records.map((r) => r.path).filter(Boolean));
    for await (const [name] of this.audioDir.entries())
      if (!retained.has(name)) await this.removeFile(name);
  }
  list() {
    return [...this.books.values()].filter((b) => !b.deletedAt);
  }
  get(id) {
    return this.books.get(id);
  }
  /** Reads a book's text and analysis, which the shelf does not need. */
  async load(id) {
    const book = this.get(id);
    if (!book || book.chapters) return book;
    this.loading ||= new Map();
    if (!this.loading.has(id))
      this.loading.set(
        id,
        request(this.db.transaction("content").objectStore("content").get(id))
          .then((content) => {
            if (!content) throw new Error("invalidBook");
            const current = this.get(id);
            if (current && !current.chapters)
              this.books.set(
                id,
                fromStored({ ...current, ...pick(content, CONTENT) }),
              );
            return this.get(id);
          })
          .finally(() => this.loading.delete(id)),
      );
    return this.loading.get(id);
  }
  async removeFile(name) {
    await removeIfPresent(this.audioDir, name);
  }
  lockAudio(task) {
    return navigator.locks?.request
      ? navigator.locks.request("pagevoice-audio-write", task)
      : task();
  }
  async write(store, value, key) {
    const tx = this.db.transaction(store, "readwrite");
    const done = complete(tx);
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    await done;
  }
  /** Stores a book's two parts together, or neither. */
  async writeBook({ meta, content }) {
    const tx = this.db.transaction(["books", "content"], "readwrite"),
      done = complete(tx);
    tx.objectStore("content").put(content);
    tx.objectStore("books").put(meta);
    await done;
  }
  async add(book, keep = true) {
    keep = keep && !this.sessionOnly;
    const value = {
      ...book,
      id: book.id || crypto.randomUUID(),
      keep,
      created: book.created || Date.now(),
      prepared: book.prepared || {},
      position: book.position || {
        chapter: book.startChapter || 0,
        sentence: 0,
      },
      settings: book.settings || defaultSettings(book.language),
      outline: outlineOf(book.chapters),
    };
    if (this.books.has(value.id)) throw new Error("duplicateBook");
    if (keep)
      try {
        await this.writeBook(
          split(this.packBlobs ? await toStored(value) : value),
        );
      } catch (error) {
        // Some browsers (e.g. WebKit private sessions) refuse to store files in
        // IndexedDB. Keep the book for this session instead of failing the import;
        // a full disk is still reported.
        if (error?.name === "QuotaExceededError") throw error;
        value.keep = false;
        value.storageFallback = true;
      }
    this.books.set(value.id, value);
    this.channel?.postMessage(value.id);
    return value;
  }
  async update(id, patch, allowDeleted = false) {
    const next = (this.writes.get(id) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const apply = (current) => {
          if (!current || (current.deletedAt && !allowDeleted)) return null;
          const changes = typeof patch === "function" ? patch(current) : patch;
          if (!changes) return null;
          const value = { ...current, ...changes };
          if (changes.chapters) value.outline = outlineOf(changes.chapters);
          return value;
        };
        let value,
          textChanged = true;
        if (this.get(id)?.keep && this.db) {
          // Read/modify/write in ONE IDB transaction. A stale tab cannot overwrite
          // a deletion or lose another tab's position/audio changes. Content is
          // only read and written when the change touches it.
          const memory = this.get(id),
            loaded = memory?.chapters ? pick(memory, CONTENT) : {};
          const tx = this.db.transaction(["books", "content"], "readwrite"),
            done = complete(tx),
            table = tx.objectStore("books");
          const get = table.get(id);
          get.onsuccess = () => {
            const stored = get.result;
            const current = stored && { ...fromStored(stored), ...loaded };
            const changes =
              current && !(current.deletedAt && !allowDeleted)
                ? typeof patch === "function"
                  ? patch(current)
                  : patch
                : null;
            if (!changes) {
              if (stored) this.books.set(id, current);
              else this.books.delete(id);
              return;
            }
            const metaChanges = { ...changes };
            for (const key of CONTENT) delete metaChanges[key];
            if (changes.chapters)
              metaChanges.outline = outlineOf(changes.chapters);
            table.put({ ...stored, ...metaChanges });
            const contentChanges = pick(changes, CONTENT);
            textChanged = Object.keys(contentChanges).length > 0;
            if (Object.keys(contentChanges).length) {
              const store = tx.objectStore("content"),
                read = store.get(id);
              read.onsuccess = () =>
                store.put({ ...read.result, ...contentChanges, id });
            }
            value = { ...current, ...changes, ...metaChanges };
          };
          await done;
        } else value = apply(this.get(id));
        if (value) {
          // The text may have been loaded while this update was running.
          const latest = this.get(id);
          value = fromStored(
            latest?.chapters && !value.chapters
              ? { ...pick(latest, CONTENT), ...value }
              : value,
          );
          this.books.set(id, value);
          this.channel?.postMessage({
            id,
            content: textChanged,
          });
        }
        return value || null;
      });
    this.writes.set(id, next);
    try {
      return await next;
    } finally {
      if (this.writes.get(id) === next) this.writes.delete(id);
    }
  }
  async preference(key, value) {
    if (!this.db) {
      if (value !== undefined) this.prefs.set(key, value);
      return this.prefs.get(key);
    }
    if (value !== undefined) {
      await this.write("prefs", value, key);
      return value;
    }
    return request(this.db.transaction("prefs").objectStore("prefs").get(key));
  }
  async putAudio(bookId, row, signature, blob, details = {}) {
    return this.lockAudio(() =>
      this.storeAudio(bookId, row, signature, blob, details),
    );
  }
  async storeAudio(bookId, row, signature, blob, details = {}) {
    const book = this.get(bookId);
    if (!book || book.deletedAt) return;
    const key = `${bookId}/${row}/${signature}`;
    const record = {
      duration: details.duration,
      rtf: details.rtf,
      key,
      bookId,
      row,
      signature,
      bytes: blob.size,
    };
    if (book.keep && this.audioDir) {
      record.path = (await hashText(key)) + ".wav";
      const file = await this.audioDir.getFileHandle(record.path, {
        create: true,
      });
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
    } else record.blob = blob;
    // Deletion wins over an in-flight render; no audio can resurrect a removed book.
    if (!this.get(bookId) || this.get(bookId).deletedAt) {
      if (record.path) await this.removeFile(record.path);
      return;
    }
    if (book.keep)
      await this.write("audio", {
        ...record,
        blob: this.packBlobs ? await packBlob(record.blob) : record.blob,
      });
    else this.audio.set(key, record);
    const previous = this.get(bookId).prepared[row];
    await this.update(bookId, (current) => ({
      prepared: {
        ...current.prepared,
        [row]: {
          key,
          signature,
          duration: details.duration,
          bytes: blob.size,
          rtf: details.rtf,
        },
      },
    }));
    if (this.get(bookId)?.deletedAt || !this.get(bookId)) {
      await this.deleteAudio(key);
      return;
    }
    if (previous && previous.key !== key) await this.deleteAudio(previous.key);
  }
  async getAudio(key) {
    const record =
      this.audio.get(key) ||
      (this.db &&
        (await request(
          this.db.transaction("audio").objectStore("audio").get(key),
        )));
    if (!record) return null;
    if (record.blob) return unpackBlob(record.blob);
    try {
      return await (await this.audioDir.getFileHandle(record.path)).getFile();
    } catch {
      return null;
    }
  }
  async deleteAudio(key) {
    const record =
      this.audio.get(key) ||
      (this.db &&
        (await request(
          this.db.transaction("audio").objectStore("audio").get(key),
        )));
    this.audio.delete(key);
    if (record?.path) {
      try {
        await this.audioDir.removeEntry(record.path);
      } catch {
        /* Already removed. */
      }
    }
    if (this.db) {
      const tx = this.db.transaction("audio", "readwrite");
      const done = complete(tx);
      tx.objectStore("audio").delete(key);
      await done;
    }
  }
  /** Removes many audio records and files with one transaction. */
  async deleteAudios(keys) {
    const wanted = new Set(keys);
    let records = [...this.audio.values()].filter((r) => wanted.has(r.key));
    if (this.db) {
      const tx = this.db.transaction("audio", "readwrite"),
        done = complete(tx),
        table = tx.objectStore("audio");
      // Requests run in order: each record is read before it is deleted.
      const reads = keys.map((key) => table.get(key));
      for (const key of keys) table.delete(key);
      await done;
      records = [...records, ...reads.map((r) => r.result).filter(Boolean)];
    }
    for (const key of keys) this.audio.delete(key);
    for (const record of records)
      if (record.path) await this.removeFile(record.path);
  }
  async softDelete(id) {
    const book = this.get(id);
    if (!book || book.deletedAt) return null;
    const deleted = await this.update(id, { deletedAt: Date.now() });
    this.revokeCover(id);
    if (deleted) this.schedulePurge(deleted);
    return deleted;
  }
  schedulePurge(book) {
    clearTimeout(this.deletions.get(book.id));
    const timer = setTimeout(
      () => {
        if (this.get(book.id)?.deletedAt === book.deletedAt)
          this.purge(book.id).catch((error) => {
            this.lastError = error.message;
            this.onChange(book.id, this.get(book.id));
          });
      },
      Math.max(0, 8000 - (Date.now() - book.deletedAt)),
    );
    timer.unref?.();
    this.deletions.set(book.id, timer);
  }
  async restore(id) {
    const book = this.get(id);
    if (!book?.deletedAt || Date.now() - book.deletedAt >= 8000) return null;
    const restored = await this.update(
      id,
      (current) =>
        current.deletedAt && Date.now() - current.deletedAt < 8000
          ? { deletedAt: null }
          : null,
      true,
    );
    if (restored) {
      clearTimeout(this.deletions.get(id));
      this.deletions.delete(id);
    }
    return restored;
  }
  async purge(id) {
    return this.lockAudio(() => this.purgeFiles(id));
  }
  async purgeFiles(id) {
    const book = this.get(id);
    if (!book) return;
    clearTimeout(this.deletions.get(id));
    this.deletions.delete(id);
    this.revokeCover(id);
    this.books.delete(id);
    const persisted = this.db
      ? await request(
          this.db
            .transaction("audio")
            .objectStore("audio")
            .index("book")
            .getAll(id),
        )
      : [];
    for (const r of [...persisted, ...this.audio.values()].filter(
      (r) => r.bookId === id,
    ))
      await this.deleteAudio(r.key);
    if (this.db) {
      const tx = this.db.transaction(["books", "content"], "readwrite");
      const done = complete(tx);
      tx.objectStore("books").delete(id);
      tx.objectStore("content").delete(id);
      await done;
    }
    this.channel?.postMessage(id);
    this.onChange(id, undefined);
  }
  async clear() {
    for (const id of [...this.books.keys()]) await this.purge(id);
  }
  coverURL(book) {
    if (!book.coverBlob) return "";
    if (!this.urls.has(book.id))
      this.urls.set(book.id, URL.createObjectURL(book.coverBlob));
    return this.urls.get(book.id);
  }
  revokeCover(id) {
    if (this.urls.has(id)) URL.revokeObjectURL(this.urls.get(id));
    this.urls.delete(id);
  }
  async estimate() {
    return navigator.storage?.estimate
      ? navigator.storage.estimate()
      : {
          usage: [...this.books.values()].reduce(
            (s, b) =>
              s +
              Object.values(b.prepared).reduce((sum, a) => sum + a.bytes, 0),
            0,
          ),
        };
  }
  dispose() {
    for (const id of this.urls.keys()) this.revokeCover(id);
    this.db?.close();
    this.channel?.close();
    for (const timer of this.deletions.values()) clearTimeout(timer);
  }
  async backup(onProgress = () => {}) {
    const JSZip = await loadZip();
    const zip = new JSZip();
    const books = [];
    for (const [index, listed] of this.list().entries()) {
      const book = await this.load(listed.id);
      const data = {
        ...book,
        coverBlob: undefined,
        sourceFile: undefined,
        outline: undefined,
      };
      if (book.coverBlob)
        zip.file(`covers/${book.id}`, await book.coverBlob.arrayBuffer());
      if (book.sourceFile)
        zip.file(`sources/${book.id}`, await book.sourceFile.arrayBuffer());
      for (const a of Object.values(book.prepared)) {
        const blob = await this.getAudio(a.key);
        if (blob) zip.file(`audio/${a.key}.wav`, await blob.arrayBuffer());
      }
      books.push(data);
      onProgress((index + 1) / this.list().length);
    }
    zip.file("library.json", JSON.stringify({ version: 1, books }));
    return zip.generateAsync({ type: "blob", compression: "STORE" });
  }
  async importBackup(file) {
    if (file.size > 512 * 1024 * 1024) throw new Error("backupLimit");
    const JSZip = await loadZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(zip.files);
    if (
      entries.length > 50000 ||
      entries.reduce((s, f) => s + (f._data?.uncompressedSize || 0), 0) >
        512 * 1024 * 1024
    )
      throw new Error("backupLimit");
    const manifest = zip.file("library.json");
    if (!manifest || manifest._data?.uncompressedSize > 30_000_000)
      throw new Error("invalidBackup");
    const data = JSON.parse(await manifest.async("string"));
    if (
      data.version !== 1 ||
      !Array.isArray(data.books) ||
      data.books.length > 1000
    )
      throw new Error("invalidBackup");
    // Validate everything before mutation; imports get new IDs and cannot replace existing books.
    for (const b of data.books)
      if (
        !/^[\w-]{1,80}$/u.test(b.id) ||
        !["en", "es"].includes(b.language) ||
        !Array.isArray(b.chapters) ||
        !b.chapters.every(
          (c) =>
            typeof c.title === "string" &&
            Array.isArray(c.sentences) &&
            c.sentences.every((s) => typeof s === "string"),
        )
      )
        throw new Error("invalidBackup");
    const added = [];
    try {
      for (const b of data.books) {
        const oldId = b.id;
        const id = crypto.randomUUID();
        // Audio from an earlier narration service is left out and regenerated.
        const compatible = !needsNarrationReset(b),
          prepared = compatible ? b.prepared || {} : {};
        const book = await this.add(
          {
            ...b,
            id,
            deletedAt: null,
            prepared: {},
            settings: compatible ? b.settings : defaultSettings(b.language),
            coverBlob: await zip.file(`covers/${oldId}`)?.async("blob"),
            sourceFile: await zip.file(`sources/${oldId}`)?.async("blob"),
          },
          true,
        );
        added.push(book.id);
        for (const [row, a] of Object.entries(prepared)) {
          if (
            !/^\d+:\d+$/u.test(row) ||
            !/^[a-f\d]{64}$/u.test(a.signature) ||
            a.key !== `${oldId}/${row}/${a.signature}`
          )
            throw new Error("invalidBackup");
          const blob = await zip.file(`audio/${a.key}.wav`)?.async("blob");
          if (blob)
            await this.putAudio(
              id,
              row,
              a.signature,
              blob.slice(0, blob.size, "audio/wav"),
              a,
            );
        }
      }
      return added;
    } catch (e) {
      for (const id of added) await this.purge(id);
      throw e;
    }
  }
}
