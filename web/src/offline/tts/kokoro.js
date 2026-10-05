import { boundedSynthesis } from "./bounded";
export async function createAdapter({ device = "wasm" }) {
  const { env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = "/runtime/transformers/";
  const { KokoroTTS } = await import("kokoro-js");
  let model;
  try {
    model = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      { device, dtype: device === "webgpu" ? "fp32" : "q8" },
    );
  } catch (error) {
    if (device === "webgpu") throw Error("gpuFailed", { cause: error });
    throw error;
  }
  // kokoro-js defaults to silent tokenizer truncation. Preserve its phonemizer
  // and normalization, but reject oversize token sequences before inference.
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
    async synthesize({ text, voice, pace }) {
      if (text.length > 8000) throw Error("sentenceTooLong");
      const samples = await boundedSynthesis(
        text,
        async (part) =>
          (await model.generate(part, { voice, speed: pace })).audio,
      );
      return { samples, sampleRate: 24000 };
    },
    async dispose() {
      await model.model.dispose();
    },
  };
}
