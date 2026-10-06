import {
  mkdir,
  copyFile,
  readFile,
  writeFile,
  readdir,
  cp,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const groups = {
  ort: [
    "node_modules/onnxruntime-web/dist",
    /^ort-wasm-simd-threaded\.(?:wasm|mjs)$/,
  ],
  transformers: [
    "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist",
    /^ort-wasm-simd-threaded(?:\.jsep)?\.(?:wasm|mjs)$/,
  ],
  piper: [
    "node_modules/@diffusionstudio/piper-wasm/build",
    /^piper_phonemize\.(?:wasm|data|js)$/,
  ],
  ocr: [
    "node_modules/tesseract.js-core",
    /^tesseract-core-(?:(?:relaxed)?simd-)?lstm\.wasm(?:\.js)?$/,
  ],
  ffmpeg: ["node_modules/@ffmpeg/core/dist/esm", /^ffmpeg-core\.(?:wasm|js)$/],
};
const manifest = {};
for (const [name, [path, pattern]] of Object.entries(groups)) {
  const destination = resolve(root, "public/runtime", name);
  await mkdir(destination, { recursive: true });
  manifest[name] = [];
  for (const file of await readdir(resolve(root, path))) {
    if (!pattern.test(file)) continue;
    const source = resolve(root, path, file);
    let buffer = await readFile(source);
    if (name === "piper" && file.endsWith(".js"))
      buffer = Buffer.concat([
        buffer,
        Buffer.from("\nexport default createPiperPhonemize;\n"),
      ]);
    await writeFile(resolve(destination, file), buffer);
    manifest[name].push({
      url: `/runtime/${name}/${file}`,
      size: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
  }
}
await copyFile(
  resolve(root, "node_modules/tesseract.js/dist/worker.min.js"),
  resolve(root, "public/runtime/ocr/worker.min.js"),
);
const worker = await readFile(
  resolve(root, "public/runtime/ocr/worker.min.js"),
);
manifest.ocr.push({
  url: "/runtime/ocr/worker.min.js",
  size: worker.length,
  sha256: createHash("sha256").update(worker).digest("hex"),
});
await mkdir(resolve(root, "src/offline"), { recursive: true });
await writeFile(
  resolve(root, "src/offline/runtime-assets.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  "Prepared self-hosted, version-pinned inference/OCR/export runtimes.",
);
await cp(resolve(root,'LICENSES'),resolve(root,'public/licenses/notices'),{recursive:true});
