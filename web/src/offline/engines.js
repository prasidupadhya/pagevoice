export const VOICES = {
  kokoro: [
    ["af_heart", "Heart", "en-US"],
    ["af_bella", "Bella", "en-US"],
    ["am_michael", "Michael", "en-US"],
    ["am_adam", "Adam", "en-US"],
    ["bf_emma", "Emma", "en-GB"],
    ["bf_isabella", "Isabella", "en-GB"],
    ["bm_george", "George", "en-GB"],
    ["bm_daniel", "Daniel", "en-GB"],
  ].map(([id, name, locale]) => ({ id, name, locale })),
  piper: [
    { id: "davefx", name: "DaveFX", locale: "es-ES" },
    { id: "sharvard:0", name: "Sharvard 1", locale: "es-ES" },
    { id: "sharvard:1", name: "Sharvard 2", locale: "es-ES" },
  ],
  supertonic: [
    { id: "F1", name: "F1", locale: "en / es" },
    { id: "M1", name: "M1", locale: "en / es" },
  ],
};
export const voicesFor = (engine, language, deviceVoices = []) =>
  engine === "device"
    ? deviceVoices
        .filter((v) => v.lang.split(/[-_]/u)[0] === language)
        .map((v) => ({ id: v.voiceURI, name: v.name, locale: v.lang }))
    : VOICES[engine] || [];
export function assertEngine(engine, language) {
  if (
    !["en", "es"].includes(language) ||
    !["kokoro", "piper", "supertonic", "device"].includes(engine) ||
    (engine === "kokoro" && language !== "en") ||
    (engine === "piper" && language !== "es")
  )
    throw Error("unsupportedEngine");
}
export const modelFor = (engine, voice, device = "wasm") =>
  engine === "kokoro"
    ? device === "webgpu"
      ? "kokoro-gpu"
      : "kokoro"
    : engine === "piper"
      ? voice?.startsWith("sharvard")
        ? "sharvard"
        : "piper"
      : engine;

/** Adapter interface: synthesize({engine,language,voice,text,pace,device}) ->
 * {samples:Float32Array,sampleRate,seconds,rtf}. One worker, one request at a time. */
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
    this.worker.onerror = () => this.dispose("engineFailed");
  }
  synthesize(options) {
    assertEngine(options.engine, options.language);
    if (options.engine === "device")
      return Promise.reject(Error("deviceHasNoExport"));
    this.start();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, options });
    });
  }
  dispose(reason = "cancelled") {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(Error(reason));
    this.pending.clear();
  }
}
