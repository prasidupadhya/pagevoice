import models from "../model-assets.json";
// Original batch-one adapter for the public Supertonic 2 ONNX tensor contract.
// It is experimental, archived upstream, and never selected over Piper by default.
export async function createAdapter() {
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = "/runtime/ort/";
  const assets = models.supertonic.assets;
  const json = async (path) =>
    (await fetch(assets.find((a) => a.path === path).url)).json();
  const cfg = await json("onnx/tts.json"),
    unicode = await json("onnx/unicode_indexer.json");
  const sessions = {};
  for (const name of [
    "duration_predictor",
    "text_encoder",
    "vector_estimator",
    "vocoder",
  ]) {
    const b = await (
      await fetch(assets.find((a) => a.path === `onnx/${name}.onnx`).url)
    ).arrayBuffer();
    sessions[name] = await ort.InferenceSession.create(b, {
      executionProviders: ["wasm"],
    });
  }
  const tensor = (data, dims, type = "float32") =>
    new ort.Tensor(
      type,
      type === "int64"
        ? BigInt64Array.from(data, BigInt)
        : Float32Array.from(data),
      dims,
    );
  const styles = new Map();
  async function style(voice) {
    if (!styles.has(voice)) {
      const data = await json(`voice_styles/${voice}.json`);
      styles.set(
        voice,
        Object.fromEntries(
          ["style_ttl", "style_dp"].map((k) => [
            k,
            tensor(data[k].data.flat(Infinity), data[k].dims),
          ]),
        ),
      );
    }
    return styles.get(voice);
  }
  const rate = cfg.ae.sample_rate;
  return {
    sampleRate: rate,
    async synthesize({ text, voice, language, pace }) {
      if (text.length > 2000) throw Error("sentenceTooLong");
      const normalized = text
        .normalize("NFKD")
        .replace(/[–—‑]/gu, "-")
        .replace(/[“”]/gu, '"')
        .replace(/[‘’]/gu, "'")
        .replace(/\[|\]|\||#|\\/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
      const tagged = `<${language}>${normalized}${/[.!?…:;"')»]$/u.test(normalized) ? "" : "."}</${language}>`;
      const ids = [...tagged].map((c) => unicode[c.codePointAt(0)] ?? -1),
        n = ids.length;
      const text_ids = tensor(ids, [1, n], "int64"),
        text_mask = tensor(new Float32Array(n).fill(1), [1, 1, n]);
      const s = await style(voice);
      const d = await sessions.duration_predictor.run({
        text_ids,
        text_mask,
        style_dp: s.style_dp,
      });
      const duration = Number(d.duration.data[0]) / pace;
      if (!Number.isFinite(duration) || duration <= 0 || duration > 120)
        throw Error("invalidDuration");
      const { text_emb } = await sessions.text_encoder.run({
        text_ids,
        text_mask,
        style_ttl: s.style_ttl,
      });
      const length = Math.ceil(
        (duration * rate) /
          (cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor),
      );
      const channels = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
      let data = new Float32Array(channels * length);
      for (let i = 0; i < data.length; i++)
        data[i] =
          Math.sqrt(-2 * Math.log(Math.max(0.0001, Math.random()))) *
          Math.cos(2 * Math.PI * Math.random());
      const latent_mask = tensor(new Float32Array(length).fill(1), [
          1,
          1,
          length,
        ]),
        total_step = tensor([8], [1]);
      for (let step = 0; step < 8; step++) {
        const output = await sessions.vector_estimator.run({
          noisy_latent: tensor(data, [1, channels, length]),
          text_emb,
          style_ttl: s.style_ttl,
          latent_mask,
          text_mask,
          current_step: tensor([step], [1]),
          total_step,
        });
        data = output.denoised_latent.data;
      }
      const output = await sessions.vocoder.run({
        latent: tensor(data, [1, channels, length]),
      });
      return {
        samples: Float32Array.from(output.wav_tts.data).slice(
          0,
          Math.floor(duration * rate),
        ),
        sampleRate: rate,
      };
    },
    async dispose() {
      for (const session of Object.values(sessions)) await session.release();
    },
  };
}
