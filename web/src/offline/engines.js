// Narration runs on this device. Kokoro reads English and Piper reads Spanish,
// both in a Web Worker. No text leaves the browser; the only network requests
// are the fixed voice files, fetched once and checked against pinned hashes.
export const NARRATION = "local";

const voice = (id, name, locale, gender, engine, model) => ({
  id,
  name,
  locale,
  gender,
  engine,
  model,
});
export const VOICES = [
  voice("af_heart", "Heart", "en-US", "female", "kokoro", "kokoro"),
  voice("af_bella", "Bella", "en-US", "female", "kokoro", "kokoro"),
  voice("am_michael", "Michael", "en-US", "male", "kokoro", "kokoro"),
  voice("am_adam", "Adam", "en-US", "male", "kokoro", "kokoro"),
  voice("bf_emma", "Emma", "en-GB", "female", "kokoro", "kokoro"),
  voice("bf_isabella", "Isabella", "en-GB", "female", "kokoro", "kokoro"),
  voice("bm_george", "George", "en-GB", "male", "kokoro", "kokoro"),
  voice("bm_daniel", "Daniel", "en-GB", "male", "kokoro", "kokoro"),
  voice("davefx", "Dave", "es-ES", "male", "piper", "piper"),
  voice("sharvard:0", "Sharvard 1", "es-ES", undefined, "piper", "sharvard"),
  voice("sharvard:1", "Sharvard 2", "es-ES", undefined, "piper", "sharvard"),
];
export const voiceById = (id) => VOICES.find((v) => v.id === id);
/** The voice file group (see MODEL_GROUPS) a voice needs. */
export const modelFor = (id) => voiceById(id)?.model;
export const defaultVoice = (language) =>
  VOICES.find((v) => v.locale.split("-")[0] === language)?.id || "";

/** Client for the voice worker. One request at a time, in order:
 * synthesize({text, voice, cast}) -> {samples, sampleRate, duration, rtf}. */
export class LocalEngine {
  constructor({
    workerFactory = () =>
      new Worker(new URL("./engine.worker.js", import.meta.url), {
        type: "module",
      }),
  } = {}) {
    this.factory = workerFactory;
    this.pending = new Map();
    this.sequence = 0;
  }
  start() {
    if (this.worker) return;
    this.worker = this.factory();
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(Error(data.error));
      else p.resolve(data.result);
    };
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      this.dispose("engineFailed");
    };
  }
  synthesize({ text, voice, cast = {} }) {
    if (!voiceById(voice)) return Promise.reject(Error("voiceUnknown"));
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, options: { text, voice, cast } });
    });
  }
  /** Stops the worker. Requests in flight fail with `reason`. */
  dispose(reason = "cancelled") {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(Error(reason));
    this.pending.clear();
  }
}
