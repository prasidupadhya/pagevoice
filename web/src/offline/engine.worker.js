import { guardInferenceFetch } from "./assets";
import { speechParts, concatenate, audioStats } from "./audio";
import { voiceById } from "./engines";
import { isWasmAbort } from "./wasm";
// Only cached, hash-checked voice files can be read here; nothing is uploaded.
guardInferenceFetch();
// One adapter per engine, kept loaded: a book can cast a Kokoro voice next to
// a Piper voice, and reloading a model for each sentence would take seconds.
const adapters = new Map();
let pending = Promise.resolve();
self.onmessage = (event) => {
  pending = pending.then(() => synthesize(event.data));
};
function adapterFor(name) {
  if (!adapters.has(name))
    adapters.set(
      name,
      (name === "kokoro" ? import("./tts/kokoro") : import("./tts/piper"))
        .then((module) => module.createAdapter())
        .catch((error) => {
          adapters.delete(name);
          throw error;
        }),
    );
  return adapters.get(name);
}
async function synthesize({ id, options }) {
  try {
    const main = voiceById(options.voice);
    if (!main) throw Error("voiceUnknown");
    const started = performance.now(),
      parts = [];
    let rate;
    for (const part of speechParts(options.text, main.id, options.cast)) {
      if (part.pause !== undefined) {
        parts.push(part);
        continue;
      }
      // A [voice:…] mark may only switch to a voice of the same engine.
      const voice = voiceById(part.voice);
      if (!voice || voice.engine !== main.engine) throw Error("invalidVoice");
      const result = await (
        await adapterFor(main.engine)
      ).synthesize({ text: part.text.trim(), voice: voice.id });
      if (rate && rate !== result.sampleRate) throw Error("mixedSampleRates");
      rate = result.sampleRate;
      parts.push(result.samples);
    }
    rate ||= main.engine === "kokoro" ? 24000 : 22050;
    // A sentence with nothing to say ("* * *") becomes a short pause.
    if (!parts.some((p) => p.pause === undefined)) parts.push({ pause: 0.4 });
    const samples = concatenate(
      parts.map((p) =>
        p.pause !== undefined
          ? new Float32Array(Math.round(p.pause * rate))
          : p,
      ),
      rate,
    );
    const stats = audioStats(samples, rate),
      seconds = (performance.now() - started) / 1000;
    if (
      stats.duration === 0 ||
      (stats.rms < 0.00001 && parts.some((p) => p.pause === undefined))
    )
      throw Error("silentAudio");
    self.postMessage(
      {
        id,
        result: {
          samples,
          sampleRate: rate,
          duration: stats.duration,
          rtf: seconds / Math.max(stats.duration, 0.001),
        },
      },
      [samples.buffer],
    );
  } catch (error) {
    if (isWasmAbort(error)) {
      // The WebAssembly instance is dead. Discard it so the next sentence
      // starts a fresh engine instead of failing with the same abort.
      const name = voiceById(options.voice)?.engine,
        failed = adapters.get(name);
      adapters.delete(name);
      await failed?.then((adapter) => adapter.dispose?.()).catch(() => {});
      self.postMessage({ id, error: "engineFailed" });
      return;
    }
    if (KNOWN.has(error.message))
      self.postMessage({ id, error: error.message });
    else {
      console.warn("Narration failed:", error);
      self.postMessage({ id, error: "engineFailed" });
    }
  }
}
const KNOWN = new Set([
  "voiceUnknown",
  "invalidVoice",
  "invalidPause",
  "sentenceTooLong",
  "silentAudio",
  "phonemizerFailed",
  "mixedSampleRates",
  "modelNotCached",
  "invalidAudio",
]);
