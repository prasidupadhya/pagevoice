import models from "../model-assets.json";
export async function createAdapter() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = "/runtime/ort/";
  // The Emscripten phonemizer is supplied by a pinned npm package and self-hosted.
  const url = new URL("/runtime/piper/piper_phonemize.js", self.location.origin)
    .href;
  const { default: createPhonemizer } = await import(/* @vite-ignore */ url);
  let phonemes = [];
  const phonemizer = await createPhonemizer({
    noInitialRun: true,
    locateFile: (f) =>
      new URL(`/runtime/piper/${f}`, self.location.origin).href,
    print: (value) => {
      const parsed = JSON.parse(value);
      if (parsed.phoneme_ids) phonemes.push(...parsed.phoneme_ids);
    },
    printErr: () => {},
  });
  const loaded = new Map();
  async function load(voice) {
    const name = voice.startsWith("sharvard") ? "sharvard" : "piper";
    if (loaded.has(name)) return loaded.get(name);
    const assets = models[name].assets;
    const config = await (
      await fetch(assets.find((a) => a.path.endsWith(".json")).url)
    ).json();
    const data = await (
      await fetch(assets.find((a) => a.path.endsWith(".onnx")).url)
    ).arrayBuffer();
    const session = await ort.InferenceSession.create(data, {
      executionProviders: ["wasm"],
    });
    const result = { config, session };
    loaded.set(name, result);
    return result;
  }
  return {
    sampleRate: 22050,
    async synthesize({ text, voice, pace }) {
      if (text.length > 8000) throw Error("sentenceTooLong");
      const { config, session } = await load(voice);
      phonemes = [];
      phonemizer.callMain([
        "-l",
        config.espeak.voice,
        "--input",
        JSON.stringify([{ text }]),
        "--espeak_data",
        "/espeak-ng-data",
      ]);
      if (!phonemes.length) throw Error("phonemizerFailed");
      const feeds = {
        input: new ort.Tensor("int64", BigInt64Array.from(phonemes, BigInt), [
          1,
          phonemes.length,
        ]),
        input_lengths: new ort.Tensor(
          "int64",
          BigInt64Array.from([phonemes.length], BigInt),
          [1],
        ),
        scales: new ort.Tensor(
          "float32",
          Float32Array.of(
            config.inference.noise_scale,
            config.inference.length_scale / pace,
            config.inference.noise_w,
          ),
          [3],
        ),
      };
      if (config.num_speakers > 1)
        feeds.sid = new ort.Tensor(
          "int64",
          BigInt64Array.of(BigInt(voice.split(":")[1] || 0)),
          [1],
        );
      const result = await session.run(feeds);
      return {
        samples: Float32Array.from(result.output.data),
        sampleRate: config.audio.sample_rate,
      };
    },
    async dispose() {
      for (const { session } of loaded.values()) await session.release();
    },
  };
}
