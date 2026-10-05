// Maintenance only. The deployed app only GETs the fixed files in the output.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const previous = JSON.parse(await readFile(new URL('../src/offline/model-assets.json',import.meta.url)));
const metadata = {};
for(const m of Object.values(previous)) {
  if(!m.id || metadata[m.id]) continue;
  const response=await fetch(`https://huggingface.co/api/models/${m.id}/revision/${m.revision}?blobs=true`);
  if(!response.ok) throw Error(`Cannot read pinned metadata: ${m.id} (${response.status})`);
  metadata[m.id]=await response.json();
}
const manifest = {};
const definitions = {
  kokoro: [
    "onnx-community/Kokoro-82M-v1.0-ONNX",
    [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "onnx/model_quantized.onnx",
      ...[
        "af_heart",
        "af_bella",
        "am_michael",
        "am_adam",
        "bf_emma",
        "bf_isabella",
        "bm_george",
        "bm_daniel",
      ].map((v) => `voices/${v}.bin`),
    ],
  ],
  "kokoro-gpu": ["onnx-community/Kokoro-82M-v1.0-ONNX", ["onnx/model.onnx"]],
  piper: [
    "rhasspy/piper-voices",
    [
      "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx",
      "es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json",
    ],
  ],
  sharvard: [
    "rhasspy/piper-voices",
    [
      "es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx",
      "es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx.json",
    ],
  ],
  embeddings: [
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
    [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
  ],
  ner: [
    "Xenova/bert-base-multilingual-cased-ner-hrl",
    [
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx",
    ],
  ],
  supertonic: [
    "supertone-oss-archive/supertonic-2",
    [
      "onnx/tts.json",
      "onnx/unicode_indexer.json",
      "onnx/duration_predictor.onnx",
      "onnx/text_encoder.onnx",
      "onnx/vector_estimator.onnx",
      "onnx/vocoder.onnx",
      "voice_styles/F1.json",
      "voice_styles/M1.json",
    ],
  ],
};
for (const [name, [id, paths]] of Object.entries(definitions)) {
  const info = metadata[id];
  manifest[name] = { id, revision: info.sha, assets: [] };
  for (const path of paths) {
    const f = info.siblings.find((x) => x.rfilename === path);
    if (!f) throw Error(path);
    const url = `https://huggingface.co/${id}/resolve/${info.sha}/${path}`;
    let sha256 = f.lfs?.sha256;
    if (!sha256) {
      const r = await fetch(url);
      if (!r.ok) throw Error(`${r.status} ${url}`);
      sha256 = createHash("sha256")
        .update(Buffer.from(await r.arrayBuffer()))
        .digest("hex");
    }
    manifest[name].assets.push({ url, path, size: f.size, sha256 });
  }
}
// Pinned language data packages, Apache-2.0, tessdata_fast (integer LSTM).
manifest.ocr = { assets: [] };
for (const lang of ["eng", "spa"]) {
  const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${lang}.traineddata.gz`;
  const r = await fetch(url);
  if (!r.ok) throw Error(`${r.status} ${url}`);
  const b = Buffer.from(await r.arrayBuffer());
  manifest.ocr.assets.push({
    url,
    path: `${lang}.traineddata.gz`,
    alias: `/language-data/${lang}.traineddata.gz`,
    size: b.length,
    sha256: createHash("sha256").update(b).digest("hex"),
  });
}
await writeFile(
  new URL("../src/offline/model-assets.json", import.meta.url),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("Pinned static model URLs, lengths and SHA-256 hashes.");
