import { guardInferenceFetch } from "./assets";
import { speechParts, concatenate, audioStats } from "./audio";
import { assertEngine, VOICES } from "./engines";
guardInferenceFetch();
let adapter,
  key,
  pending = Promise.resolve();
self.onmessage = (event) => {
  pending = pending.then(() => synthesize(event.data));
};
async function synthesize({ id, options }) {
  try {
    assertEngine(options.engine, options.language);
    if (
      !Number.isFinite(options.pace) ||
      options.pace < 0.5 ||
      options.pace > 2
    )
      throw Error("invalidPace");
    const next = `${options.engine}:${options.device || "wasm"}`;
    const started = performance.now();
    if (next !== key) {
      await adapter?.dispose?.();
      const module =
        options.engine === "kokoro"
          ? await import("./tts/kokoro")
          : options.engine === "piper"
            ? await import("./tts/piper")
            : await import("./tts/supertonic");
      adapter = await module.createAdapter(options);
      key = next;
    }
    const parts = [];
    let rate;
    for (const part of speechParts(options.text, options.voice, options.cast)) {
      if (part.pause !== undefined) {
        parts.push({ pause: part.pause });
        continue;
      }
      if (!VOICES[options.engine].some((v) => v.id === part.voice))
        throw Error("invalidVoice");
      const result = await adapter.synthesize({
        ...options,
        text: part.text.trim(),
        voice: part.voice,
      });
      if (rate && rate !== result.sampleRate) throw Error("mixedSampleRates");
      rate = result.sampleRate;
      parts.push(result.samples);
    }
    rate ||= adapter.sampleRate || 24000;
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
      (stats.rms < 0.00001 &&
        options.text.replace(/\[pause:[^\]]+\]/gu, "").trim())
    )
      throw Error("silentAudio");
    self.postMessage(
      {
        id,
        result: {
          samples,
          sampleRate: rate,
          seconds,
          rtf: seconds / Math.max(stats.duration, 0.001),
          ...stats,
        },
      },
      [samples.buffer],
    );
  } catch (error) {
    self.postMessage({ id, error: error.message || "engineFailed" });
  }
}
