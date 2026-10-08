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
const unpackBlob = (value) =>
  value?.bytes ? new Blob([value.bytes], { type: value.type }) : value;
const toStored = async (book) => ({
  ...book,
  sourceFile: await packBlob(book.sourceFile),
  coverBlob: await packBlob(book.coverBlob),
});
const fromStored = (book) =>
  book && {
    ...book,
    sourceFile: unpackBlob(book.sourceFile),
    coverBlob: unpackBlob(book.coverBlob),
  };
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
    const opened = indexedDB.open(this.name, 1);
    opened.onupgradeneeded = () => {
      opened.result.createObjectStore("books", { keyPath: "id" });
      opened.result
        .createObjectStore("audio", { keyPath: "key" })
        .createIndex("book", "bookId");
      opened.result.createObjectStore("prefs");
    };
    try {
      this.db = await request(opened);
    } catch {
      this.sessionOnly = true;
      return this;
    }
    this.db.onversionchange = () => this.db.close();
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
    await this.lockAudio(() => this.recoverAudioFiles());
    if (globalThis.BroadcastChannel) {
      this.channel = new BroadcastChannel(this.name);
      this.channel.onmessage = async ({ data: id }) => {
        if (!this.db || typeof id !== "string") return;
        try {
          const current = await request(
            this.db.transaction("books").objectStore("books").get(id),
          );
          if (current) this.books.set(id, fromStored(current));
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
      settings: book.settings || {
        engine: book.language === "es" ? "piper" : "kokoro",
        voice: book.language === "es" ? "davefx" : "af_heart",
        pace: 1,
        cast: {},
        buffer: 20,
      },
    };
    if (this.books.has(value.id)) throw new Error("duplicateBook");
    if (keep)
      try {
        await this.write("books", await toStored(value));
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
          return changes ? { ...current, ...changes } : null;
        };
        let value;
        if (this.get(id)?.keep && this.db) {
          // Read/modify/write in ONE IDB transaction. A stale tab cannot overwrite
          // a deletion or lose another tab's position/audio changes.
          const tx = this.db.transaction("books", "readwrite"),
            done = complete(tx),
            table = tx.objectStore("books");
          const get = table.get(id);
          get.onsuccess = () => {
            const current = get.result;
            value = apply(current);
            if (value) table.put(value);
            else if (current) this.books.set(id, fromStored(current));
            else this.books.delete(id);
          };
          await done;
        } else value = apply(this.get(id));
        if (value) {
          value = fromStored(value);
          this.books.set(id, value);
          this.channel?.postMessage(id);
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
        blob: await packBlob(record.blob),
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
      const tx = this.db.transaction("books", "readwrite");
      const done = complete(tx);
      tx.objectStore("books").delete(id);
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
    for (const [index, book] of this.list().entries()) {
      const data = { ...book, coverBlob: undefined, sourceFile: undefined };
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
        const prepared = b.prepared || {};
        const book = await this.add(
          {
            ...b,
            id,
            deletedAt: null,
            prepared: {},
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
          if (blob) await this.putAudio(id, row, a.signature, blob, a);
        }
      }
      return added;
    } catch (e) {
      for (const id of added) await this.purge(id);
      throw e;
    }
  }
}
