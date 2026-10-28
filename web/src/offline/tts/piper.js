import models from "../model-assets.json";
import { boundedSynthesis } from "./bounded";
import { modelFor } from "../engines";
import { espeak } from "./espeak";
// Piper (VITS) Spanish voices on ONNX Runtime WebAssembly. Text becomes phoneme
// ids with the eSpeak NG phonemizer that Piper itself uses, built for the web.
export async function createAdapter() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = "/runtime/ort/";
  const phonemize = await espeak();
  const loaded = new Map();
  async function load(name) {
    if (loaded.has(name)) return loaded.get(name);
    const assets = models[name].assets,
      file = (suffix) => assets.find((a) => a.path.endsWith(suffix)).url;
    const config = await (await fetch(file(".onnx.json"))).json();
    const session = await ort.InferenceSession.create(
      new Uint8Array(await (await fetch(file(".onnx"))).arrayBuffer()),
      { executionProviders: ["wasm"] },
    );
    loaded.set(name, { config, session });
    return loaded.get(name);
  }
  return {
    sampleRate: 22050,
    async synthesize({ text, voice }) {
      const speaker = voice.split(":")[1] || "0",
        { config, session } = await load(modelFor(voice));
      const samples = await boundedSynthesis(text, async (part) => {
        const ids = phonemize(part, config.espeak.voice).flatMap(
          (line) => line.phoneme_ids || [],
        );
        if (!ids.length) throw Error("phonemizerFailed");
        // Long inputs make VITS memory grow quickly; split them like Kokoro.
        if (ids.length > 1000) throw Error("tokenLimit");
        const feeds = {
          input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [
            1,
            ids.length,
          ]),
          input_lengths: new ort.Tensor(
            "int64",
            BigInt64Array.of(BigInt(ids.length)),
            [1],
          ),
          scales: new ort.Tensor(
            "float32",
            Float32Array.of(
              config.inference.noise_scale,
              config.inference.length_scale,
              config.inference.noise_w,
            ),
            [3],
          ),
        };
        if (config.num_speakers > 1)
          feeds.sid = new ort.Tensor(
            "int64",
            BigInt64Array.of(BigInt(speaker)),
            [1],
          );
        const result = await session.run(feeds);
        return Float32Array.from(result.output.data);
      });
      return { samples, sampleRate: config.audio.sample_rate };
    },
    async dispose() {
      for (const { session } of loaded.values()) await session.release();
      loaded.clear();
    },
  };
}
