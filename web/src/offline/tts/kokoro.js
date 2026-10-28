import { boundedSynthesis } from "./bounded";
import { espeak } from "./espeak";
// Kokoro-82M (Apache-2.0), quantized to 8 bits, on the ONNX Runtime WebAssembly
// backend. kokoro-js supplies the English text normalization and phonemizer.
// Spanish voices (e…) read eSpeak NG's Spanish phonemes, as Kokoro itself
// does; kokoro-js's own phonemizer only carries English.

/** Spanish text as Kokoro phonemes, from eSpeak NG as Kokoro was trained. */
export async function spanishPhonemes(text) {
  const lines = (await espeak())(text, "es");
  return (
    lines
      .map((line) => (line.phonemes || []).join(""))
      .join(" ")
      // Kokoro's vocabulary writes these affricates as single symbols.
      .replace(/tʃ/gu, "ʧ")
      .replace(/dʒ/gu, "ʤ")
      .trim()
  );
}
export async function createAdapter() {
  const { env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = "/runtime/transformers/";
  const { KokoroTTS } = await import("kokoro-js");
  const model = await KokoroTTS.from_pretrained(
    "onnx-community/Kokoro-82M-v1.0-ONNX",
    { device: "wasm", dtype: "q8" },
  );
  // kokoro-js silently truncates long input. Keep its phonemizer, but reject an
  // oversize token sequence so the sentence is split instead of cut short.
  model.tokenizer = new Proxy(model.tokenizer, {
    apply(target, self, [phonemes, options]) {
      const result = Reflect.apply(target, self, [
        phonemes,
        { ...options, truncation: false },
      ]);
      if (result.input_ids.dims.at(-1) > 512) throw Error("tokenLimit");
      return result;
    },
  });
  return {
    sampleRate: 24000,
    async synthesize({ text, voice }) {
      const generate = voice.startsWith("e")
        ? async (part) => {
            const { input_ids } = model.tokenizer(await spanishPhonemes(part));
            return (await model.generate_from_ids(input_ids, { voice })).audio;
          }
        : async (part) => (await model.generate(part, { voice })).audio;
      const samples = await boundedSynthesis(text, generate);
      return { samples, sampleRate: 24000 };
    },
    async dispose() {
      await model.model.dispose();
    },
  };
}
