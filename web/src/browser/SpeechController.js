function splitLongSpeech(text, limit = 220) {
  const remaining = String(text || "").trim();
  if (remaining.length <= limit) return [remaining].filter(Boolean);
  const chunks = [];
  let source = remaining;
  while (source.length > limit) {
    const prefix = source.slice(0, limit + 1);
    const boundaries = [...prefix.matchAll(/[,:;—.!?]\s+|\s+/gu)];
    const cut = boundaries.filter((match) => match.index > limit * 0.45).at(-1);
    const index = cut ? cut.index + cut[0].length : prefix.lastIndexOf(" ");
    if (index < 1) break;
    chunks.push(source.slice(0, index).trim());
    source = source.slice(index).trim();
  }
  if (source) chunks.push(source);
  return chunks;
}

/** Sentence-ordered Web Speech playback with a restart-safe pause position. */
export class SpeechController {
  constructor({ synth, utteranceFactory, onState = () => {} } = {}) {
    this.synth = synth ?? globalThis.speechSynthesis;
    this.utteranceFactory =
      utteranceFactory || ((text) => new SpeechSynthesisUtterance(text));
    this.onState = onState;
    this.rows = [];
    this.cursor = 0;
    this.chunkIndex = 0;
    this.chunks = [];
    this.voice = null;
    this.language = "en-US";
    this.rate = 1;
    this.status = "idle";
    this.generation = 0;
    this.utterance = null;
  }

  emit(status = this.status) {
    this.status = status;
    const row = this.rows[this.cursor] || null;
    this.onState({
      status,
      row,
      chapter: row?.chapter ?? -1,
      sentence: row?.sentence ?? -1,
      cursor: this.cursor,
      total: this.rows.length,
      rate: this.rate,
    });
  }

  play(book, chapterIndex = 0, sentenceIndex = 0, voice = null, rate = 1) {
    const chapters = book?.chapters || [];
    this.rows = chapters.slice(chapterIndex).flatMap((chapter, offset) =>
      (chapter.sentences || []).map((text, sentence) => ({
        text,
        title: chapter.title,
        chapter: chapterIndex + offset,
        sentence,
      })),
    );
    const first = this.rows.findIndex(
      (row) => row.chapter === chapterIndex && row.sentence >= sentenceIndex,
    );
    this.cursor = Math.max(0, first);
    this.voice = voice;
    this.language = book?.language === "es" ? "es-ES" : "en-US";
    this.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
    this.chunkIndex = 0;
    this.chunks = [];
    this.#begin();
  }

  preview(text, voice, language = "en", rate = 1) {
    this.rows = [{ text, title: "", chapter: -1, sentence: -1 }];
    this.cursor = 0;
    this.voice = voice;
    this.language = language === "es" ? "es-ES" : "en-US";
    this.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
    this.chunkIndex = 0;
    this.chunks = [];
    this.#begin();
  }

  pause() {
    if (!this.synth || !["playing", "starting"].includes(this.status)) return;
    this.generation++;
    this.synth.cancel();
    // Some engines cannot resume a paused utterance reliably. Restart only this sentence.
    this.chunkIndex = 0;
    this.chunks = [];
    this.utterance = null;
    this.emit("paused");
  }

  resume() {
    if (
      !this.rows.length ||
      !["paused", "blocked", "error"].includes(this.status)
    )
      return;
    this.#begin();
  }

  stop() {
    this.generation++;
    this.synth?.cancel();
    this.rows = [];
    this.cursor = 0;
    this.chunkIndex = 0;
    this.chunks = [];
    this.utterance = null;
    this.emit("idle");
  }

  next() {
    if (!this.rows.length) return;
    if (this.cursor + 1 >= this.rows.length) {
      this.stop();
      return;
    }
    this.cursor++;
    this.chunkIndex = 0;
    this.chunks = [];
    this.#begin();
  }

  previous() {
    if (!this.rows.length) return;
    this.cursor = Math.max(0, this.cursor - 1);
    this.chunkIndex = 0;
    this.chunks = [];
    this.#begin();
  }

  setRate(rate) {
    this.rate = Math.min(2, Math.max(0.5, Number(rate) || 1));
    if (this.status === "playing" || this.status === "starting") {
      this.generation++;
      this.synth?.cancel();
      this.chunkIndex = 0;
      this.chunks = [];
      this.#begin();
    } else this.emit();
  }

  dispose() {
    this.generation++;
    this.synth?.cancel();
    this.rows = [];
    this.utterance = null;
  }

  #begin() {
    if (!this.synth || !this.rows[this.cursor]) {
      this.emit("error");
      return;
    }
    this.generation++;
    const generation = this.generation;
    this.synth.cancel();
    this.chunkIndex = 0;
    this.chunks = splitLongSpeech(this.rows[this.cursor].text);
    if (!this.chunks.length) {
      this.emit("ended");
      return;
    }
    this.emit("starting");
    this.#speakChunk(generation);
  }

  #speakChunk(generation) {
    if (generation !== this.generation) return;
    const text = this.chunks[this.chunkIndex];
    const utterance = this.utteranceFactory(text);
    this.utterance = utterance;
    utterance.lang = this.voice?.lang || this.language;
    utterance.rate = this.rate;
    if (this.voice) utterance.voice = this.voice;
    utterance.onstart = () => {
      if (generation === this.generation) this.emit("playing");
    };
    utterance.onend = () => {
      if (generation !== this.generation) return;
      if (this.chunkIndex + 1 < this.chunks.length) {
        this.chunkIndex++;
        this.#speakChunk(generation);
        return;
      }
      if (this.rows[this.cursor]?.chapter === -1) {
        this.emit("ended");
        return;
      }
      if (this.cursor + 1 < this.rows.length) {
        this.cursor++;
        this.chunkIndex = 0;
        this.chunks = splitLongSpeech(this.rows[this.cursor].text);
        this.emit("playing");
        this.#speakChunk(generation);
      } else {
        this.emit("ended");
      }
    };
    utterance.onerror = (event) => {
      if (generation !== this.generation) return;
      if (["canceled", "interrupted"].includes(event.error)) return;
      this.emit(event.error === "not-allowed" ? "blocked" : "error");
    };
    try {
      this.synth.speak(utterance);
    } catch {
      this.emit("blocked");
    }
  }
}

export { splitLongSpeech };
