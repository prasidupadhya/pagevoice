import { readyRun } from "./render";
import { rowsOf as listRows } from "./library";
// A media element per sentence keeps the source highlight aligned with the file
// that is actually playing. Preparation and playback have independent lifecycles.
export class AudioPlayer {
  constructor({
    store,
    onState = () => {},
    audioFactory = () => new Audio(),
  } = {}) {
    this.store = store;
    this.onState = onState;
    this.audio = audioFactory();
    this.generation = 0;
    this.rate = 1;
    this.audio.onended = () => this.next();
    this.audio.onerror = () => this.emit("error", "invalidAudio");
    this.audio.ontimeupdate = () =>
      this.onState({
        ...this.state,
        time: this.audio.currentTime,
        duration: this.audio.duration || 0,
      });
  }
  emit(status, error = null) {
    this.state = {
      ...this.state,
      status,
      error,
      bookId: this.bookId,
      row: this.row,
      target: this.target,
    };
    this.onState(this.state);
  }
  async start(id, chapter, sentence, { wait = true } = {}) {
    this.stop();
    this.bookId = id;
    this.target = { chapter, sentence };
    this.wait = wait;
    this.generation++;
    const book = this.store.get(id);
    if (!book || book.deletedAt) return;
    if (wait) {
      const run = readyRun(book, chapter, sentence);
      if (run.count < run.required) {
        this.emit("buffering");
        return;
      }
    }
    await this.playRow(chapter, sentence);
  }
  async notifyReady() {
    if (this.notifying) return;
    if (this.state?.status !== "buffering") return;
    const book = this.store.get(this.bookId);
    if (!book || book.deletedAt) {
      this.stop();
      return;
    }
    const run = readyRun(book, this.target.chapter, this.target.sentence);
    if (run.count >= run.required) {
      this.notifying = true;
      try {
        await this.playRow(this.target.chapter, this.target.sentence);
      } finally {
        this.notifying = false;
      }
    }
  }
  async playRow(chapter, sentence) {
    const generation = ++this.generation,
      book = this.store.get(this.bookId);
    if (!book || book.deletedAt) return;
    const row = listRows(book).find(
      (r) => r.chapter === chapter && r.sentence === sentence,
    );
    if (!row) {
      this.emit("finished");
      return;
    }
    const prepared = book.prepared[row.id];
    const blob = prepared && (await this.store.getAudio(prepared.key));
    if (generation !== this.generation) return;
    if (!blob) {
      this.target = { chapter, sentence };
      this.emit("buffering");
      return;
    }
    this.releaseURL();
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.audio.playbackRate = this.rate;
    this.row = row;
    await this.store.update(book.id, { position: { chapter, sentence } });
    if (generation !== this.generation) return;
    this.emit("starting");
    try {
      await this.audio.play();
      if (generation === this.generation) this.emit("playing");
    } catch {
      if (generation === this.generation) this.emit("gesture");
    }
    this.mediaSession(book);
  }
  async next(delta = 1) {
    const book = this.store.get(this.bookId);
    if (!book || book.deletedAt) return;
    const rows = listRows(book),
      index = rows.findIndex((r) => r.id === this.row?.id),
      row = rows[index + delta];
    if (!row) {
      this.emit("finished");
      return;
    }
    this.audio.pause();
    await this.playRow(row.chapter, row.sentence);
  }
  pause() {
    this.generation++;
    this.audio.pause();
    this.emit("paused");
  }
  async resume() {
    if (!this.url || !this.row) {
      const book = this.store.get(this.bookId);
      if (!book || book.deletedAt) return;
      const target = this.target || book.position;
      const run = readyRun(book, target.chapter, target.sentence);
      if (run.count < run.required) {
        this.emit("buffering");
        return;
      }
      return this.playRow(target.chapter, target.sentence);
    }
    const generation = this.generation;
    try {
      await this.audio.play();
      if (generation === this.generation) this.emit("playing");
    } catch {
      this.emit("gesture");
    }
  }
  setRate(rate) {
    this.rate = Math.min(2, Math.max(0.5, rate));
    this.audio.playbackRate = this.rate;
  }
  seek(seconds) {
    this.audio.currentTime = Math.max(
      0,
      Math.min(this.audio.duration || 0, this.audio.currentTime + seconds),
    );
  }
  sleep(minutes) {
    clearTimeout(this.sleepTimer);
    if (minutes)
      this.sleepTimer = setTimeout(() => this.pause(), minutes * 60000);
  }
  stop() {
    this.generation++;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.releaseURL();
    this.bookId = null;
    this.row = null;
    this.emit("idle");
    clearTimeout(this.sleepTimer);
  }
  releaseURL() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
  mediaSession(book) {
    if (!navigator.mediaSession) return;
    if (globalThis.MediaMetadata)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: book.title,
        artist: book.author,
        album: this.row?.title,
      });
    for (const [name, fn] of Object.entries({
      play: () => this.resume(),
      pause: () => this.pause(),
      previoustrack: () => this.next(-1),
      nexttrack: () => this.next(),
      seekbackward: () => this.seek(-10),
      seekforward: () => this.seek(10),
    }))
      try {
        navigator.mediaSession.setActionHandler(name, fn);
      } catch {
        /* Not every platform implements every action. */
      }
  }
  dispose() {
    this.stop();
    if (navigator.mediaSession) {
      navigator.mediaSession.metadata = null;
      for (const name of [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "seekbackward",
        "seekforward",
      ])
        try {
          navigator.mediaSession.setActionHandler(name, null);
        } catch {
          /* Unsupported media action. */
        }
    }
  }
}
