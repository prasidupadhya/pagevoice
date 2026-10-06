import { rowsOf, hashText } from "./library";
import { encodeWav } from "./audio";
import { modelFor } from "./engines";
import { speechParts } from "./audio";
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
export function signatureFor(book, row) {
  return hashText(
    JSON.stringify({
      text: row.text,
      language: book.language,
      engine: book.settings.engine,
      voice: effectiveVoice(book, row),
      parts: speechParts(
        row.text,
        effectiveVoice(book, row),
        book.settings.cast,
      ),
      pace: book.settings.pace,
      device: book.settings.device || "wasm",
      version: 1,
    }),
  );
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
    required: Math.min(book.settings.buffer || 20, all.length - start),
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
    if (book.settings.engine === "device")
      throw Error("deviceHasNoPreparation");
    const voices = new Set([
      book.settings.voice,
      ...Object.values(book.settings.cast || {}),
    ]);
    for (const row of rowsOf(book))
      if (row.text.includes("[voice:"))
        for (const part of speechParts(
          row.text,
          effectiveVoice(book, row),
          book.settings.cast,
        ))
          if (part.voice) voices.add(part.voice);
    for (const voice of voices)
      if (
        !(
          await this.assets.status(
            modelFor(book.settings.engine, voice, book.settings.device),
          )
        ).ready
      )
        throw Error("modelNotCached");
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
  async loop(id) {
    this.emit({ status: "preparing", bookId: id, error: null, current: null });
    try {
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
        const result = await this.engine.synthesize({
          engine: book.settings.engine,
          language: book.language,
          voice: effectiveVoice(book, row),
          cast: book.settings.cast,
          pace: book.settings.pace,
          device: book.settings.device || "wasm",
          text: row.text,
        });
        const latest = this.store.get(id);
        if (!latest || latest.deletedAt) break;
        // Edits/casting/speed changes invalidate just their affected signature.
        const latestRow = rowsOf(latest).find((r) => r.id === row.id);
        if (
          !latestRow ||
          (await signatureFor(latest, latestRow)) !== signature
        ) {
          if (latestRow) this.order.unshift(latestRow);
          continue;
        }
        const blob = encodeWav(result.samples, result.sampleRate);
        await this.store.putAudio(id, row.id, signature, blob, {
          duration: result.duration,
          rtf: result.rtf,
        });
        const updated = this.store.get(id);
        if (!updated || updated.deletedAt) break;
        const prepared = Object.values(updated.prepared),
          rtf =
            prepared.slice(-10).reduce((s, a) => s + (a.rtf || 0), 0) /
            Math.max(1, Math.min(10, prepared.length));
        const missing = rowsOf(updated).filter((r) => !updated.prepared[r.id]);
        const audioEstimate = missing.reduce(
          (n, r) => n + r.text.split(/\s+/u).length / 2.5,
          0,
        );
        this.emit({
          prepared: prepared.length,
          total: rowsOf(updated).length,
          rtf,
          eta: audioEstimate * rtf,
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
      });
      throw error;
    }
  }
  pause() {
    this.paused = true;
  }
  stop(id) {
    if (this.bookId !== id) return;
    this.paused = true;
    this.order = [];
    this.engine.dispose();
  }
  dispose() {
    this.paused = true;
    this.order = [];
    this.engine.dispose();
  }
}
