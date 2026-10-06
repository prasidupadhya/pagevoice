import manifest from "../src/offline/model-assets.json" with { type: "json" };
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
await mkdir("/tmp/pagevoice-model-files", { recursive: true });
for (const name of process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["kokoro", "piper", "supertonic", "embeddings", "ner", "ocr"])
  for (const a of manifest[name].assets) {
    const path = `/tmp/pagevoice-model-files/${a.sha256}`;
    let data;
    try {
      data = await readFile(path);
    } catch {
      const r = await fetch(a.url);
      if (!r.ok) throw Error(`${r.status} ${a.url}`);
      data = Buffer.from(await r.arrayBuffer());
    }
    if (
      data.length !== a.size ||
      createHash("sha256").update(data).digest("hex") !== a.sha256
    )
      throw Error(`Integrity: ${a.path}`);
    await writeFile(path, data);
    console.log(a.path, data.length);
  }
