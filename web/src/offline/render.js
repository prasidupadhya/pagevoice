import { rowsOf, hashText } from "./library";
import { NARRATION, modelFor } from "./engines";
import { encodeWav, speechParts } from "./audio";
export function preparationOrder(book, chapter = 0, sentence = 0) {
  const all = rowsOf(book),
    position = all.findIndex(
      (r) => r.chapter === chapter && r.sentence === sentence,
    );
  const start = Math.max(0, position);
  return [...all.slice(start), ...all.slice(0, start)];
}
export function effectiveVoice(book, row) {
  return (
    book.settings.cast?.[book.characters?.speakers?.[row.id]] ||
    book.settings.voice
  );
}
// [voice:Name] marks in edited sentences resolve through the cast.
const castFor = (book, row) =>
  row.text.includes("[voice:") ? book.settings.cast || {} : undefined;
export function signatureFor(book, row) {
  return hashText(
    JSON.stringify({
      text: row.text,
      language: book.language,
      engine: NARRATION,
      voice: effectiveVoice(book, row),
      cast: castFor(book, row),
      version: 3,
    }),
  );
}
/** Voice file groups needed to narrate every sentence of a book. */
export function modelsFor(book) {
  const voices = new Set([
    book.settings.voice,
    ...Object.values(book.settings.cast || {}),
  ]);
  for (const row of rowsOf(book))
    if (row.text.includes("[voice:"))
      try {
        for (const part of speechParts(
          row.text,
          effectiveVoice(book, row),
          book.settings.cast,
        ))
          if (part.voice) voices.add(part.voice);
      } catch {
        // An invalid mark fails when that sentence is narrated.
      }
  return [...new Set([...voices].map(modelFor).filter(Boolean))];
}
/** Fetches voice file groups that are not cached yet. Failures become
 * messages the reader can act on. */
export async function loadVoiceFiles(assets, models, onProgress) {
  for (const id of models)
    try {
      await assets.ensure(id, onProgress);
    } catch (error) {
      if (error.name === "QuotaExceededError")
        throw Error("quotaExceeded", { cause: error });
      if (["cacheTooLarge", "assetIntegrity"].includes(error.message))
        throw error;
      throw Error("voiceLoadFailed", { cause: error });
    }
}
export function readyRun(book, chapter, sentence) {
  const all = rowsOf(book),
    start = all.findIndex(
      (r) => r.chapter === chapter && r.sentence === sentence,
    );
  let count = 0;
  if (start < 0) return { count: 0, required: 0 };
  for (const row of all.slice(start)) {
    if (!book.prepared[row.id]) break;
    count++;
  }
  return {
    count,
    required: Math.min(book.settings.buffer || 5, all.length - start),
  };
}
const UNREADABLE = new Set([
  "silentAudio",
  "sentenceTooLong",
  "phonemizerFailed",
  "invalidVoice",
  "invalidPause",
  "mixedSampleRates",
]);
/** Narrates one sentence and returns it as a WAV blob. */
export async function renderRow(engine, book, row) {
  const result = await engine.synthesize({
    text: row.text,
    voice: effectiveVoice(book, row),
    cast: book.settings.cast,
  });
  return {
    blob: encodeWav(result.samples, result.sampleRate),
    duration: result.duration,
    rtf: result.rtf,
  };
}
export class RenderQueue {
  constructor({ store, engine, assets, onChange = () => {} }) {
    this.store = store;
    this.engine = engine;
    this.assets = assets;
    this.onChange = onChange;
    this.state = { status: "idle" };
  }
  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
  async prepare(bookId, chapter = 0, sentence = 0) {
    const book = this.store.get(bookId);
    if (!book || book.deletedAt) throw Error("bookRemoved");
    if (!book.settings.voice) throw Error("voiceUnknown");
    if (this.running && this.bookId === bookId) {
      this.order = preparationOrder(book, chapter, sentence);
      this.paused = false;
      return this.running;
    }
    if (this.running) {
      this.pause();
      await this.running;
    }
    this.bookId = bookId;
    this.order = preparationOrder(book, chapter, sentence);
    this.paused = false;
    this.running = this.loop(bookId).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  /** Fetches the voice files a book needs, once. Later runs read the cache. */
  async loadVoices(book) {
    const missing = [];
    for (const id of modelsFor(book))
      if (!(await this.assets.status(id)).ready) missing.push(id);
    if (!missing.length) return;
    this.emit({ status: "loading", voice: { loaded: 0, total: 1 } });
    await loadVoiceFiles(this.assets, missing, ({ loaded, total }) =>
      this.emit({ status: "loading", voice: { loaded, total } }),
    );
  }
  async loop(id) {
    this.emit({
      status: "preparing",
      bookId: id,
      error: null,
      current: null,
      voice: null,
    });
    try {
      const first = this.store.get(id);
      if (first && !first.deletedAt) await this.loadVoices(first);
      this.emit({ status: "preparing", voice: null });
      while (this.order.length && !this.paused) {
        const row = this.order.shift(),
          book = this.store.get(id);
        if (!book || book.deletedAt) break;
        const signature = await signatureFor(book, row);
        if (
          book.prepared[row.id]?.signature === signature &&
          (await this.store.getAudio(book.prepared[row.id].key))
        )
          continue;
        this.emit({
          status: "preparing",
          current: row,
          prepared: Object.keys(book.prepared).length,
          total: rowsOf(book).length,
        });
        const { blob, duration, rtf } = await renderRow(
          this.engine,
          book,
          row,
        ).catch((error) => {
          // One sentence the voice cannot read must not stop the book; it
          // becomes a short pause and can be edited and regenerated later.
          if (!UNREADABLE.has(error.message)) throw error;
          console.warn(`Sentence ${row.id} skipped:`, error.message);
          return {
            blob: encodeWav(new Float32Array(12000), 24000),
            duration: 0.5,
            rtf: 0,
          };
        });
        const latest = this.store.get(id);
        if (!latest || latest.deletedAt) break;
        // Edits and casting changes invalidate just their affected signature.
        const latestRow = rowsOf(latest).find((r) => r.id === row.id);
        if (
          !latestRow ||
          (await signatureFor(latest, latestRow)) !== signature
        ) {
          if (latestRow) this.order.unshift(latestRow);
          continue;
        }
        await this.store.putAudio(id, row.id, signature, blob, {
          duration,
          rtf,
        });
        const updated = this.store.get(id);
        if (!updated || updated.deletedAt) break;
        const prepared = Object.values(updated.prepared),
          recent = prepared.slice(-10),
          speed =
            recent.reduce((s, a) => s + (a.rtf || 0), 0) /
            Math.max(1, recent.length);
        const missing = rowsOf(updated).filter((r) => !updated.prepared[r.id]);
        const audioEstimate = missing.reduce(
          (n, r) => n + r.text.split(/\s+/u).length / 2.5,
          0,
        );
        this.emit({
          prepared: prepared.length,
          total: rowsOf(updated).length,
          rtf: speed,
          eta: audioEstimate * speed,
          updatedBook: updated,
        });
      }
      this.emit({
        status: this.paused ? "paused" : "complete",
        current: null,
        updatedBook: this.store.get(id),
      });
    } catch (error) {
      this.emit({
        status: error.message === "cancelled" ? "paused" : "error",
        error: error.message,
        current: null,
        voice: null,
      });
      if (error.message !== "cancelled") throw error;
    }
  }
  pause() {
    this.paused = true;
  }
  stop(id) {
    if (this.bookId !== id) return;
    this.paused = true;
    this.order = [];
    // Interrupt the sentence being narrated; the next run starts a new worker.
    if (this.running) this.engine.dispose();
  }
  dispose() {
    this.paused = true;
    this.order = [];
    this.engine.dispose();
  }
}
