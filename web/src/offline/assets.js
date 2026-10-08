import models from "./model-assets.json";
import runtimes from "./runtime-assets.json";
import { hashText, opfsWritable, removeIfPresent } from "./library";

export const ASSET_CACHE = "pagevoice-models-v1";
export const MODEL_GROUPS = {
  kokoro: {
    language: "en",
    license: "Apache-2.0",
    files: [
      ...models.kokoro.assets,
      ...runtimes.transformers.filter((a) => a.url.includes(".jsep.")),
    ],
  },
  "kokoro-gpu": {
    language: "en",
    license: "Apache-2.0",
    files: [
      ...models.kokoro.assets.filter(
        (a) => !a.path?.includes("model_quantized"),
      ),
      ...models["kokoro-gpu"].assets,
      ...runtimes.transformers,
    ],
  },
  piper: {
    language: "es",
    license: "CC0 dataset / MIT weights; GPL phonemizer",
    files: [...models.piper.assets, ...runtimes.piper, ...runtimes.ort],
  },
  sharvard: {
    language: "es",
    license: "CC-BY-3.0 dataset / MIT weights; GPL phonemizer",
    files: [...models.sharvard.assets, ...runtimes.piper, ...runtimes.ort],
  },
  supertonic: {
    language: "en/es",
    license: "OpenRAIL-M",
    files: [...models.supertonic.assets, ...runtimes.ort],
  },
  embeddings: {
    license: "Apache-2.0",
    files: [
      ...models.embeddings.assets,
      ...runtimes.transformers.filter((a) => a.url.includes(".jsep.")),
    ],
  },
  ner: {
    license: "AFL-3.0",
    files: [
      ...models.ner.assets,
      ...runtimes.transformers.filter((a) => a.url.includes(".jsep.")),
    ],
  },
  ocr: {
    license: "Apache-2.0",
    files: [...models.ocr.assets, ...runtimes.ocr],
  },
  ffmpeg: { license: "GPL / LGPL components", files: runtimes.ffmpeg },
};
export const groupBytes = (id) =>
  MODEL_GROUPS[id].files.reduce((n, a) => n + a.size, 0);
const absolute = (value) =>
  new URL(value, globalThis.location?.origin || "http://localhost").href;
const all = Object.values(MODEL_GROUPS).flatMap((g) => g.files);

export function canonicalAsset(value) {
  const url = absolute(value);
  const direct = all.find(
    (a) => absolute(a.url) === url || (a.alias && absolute(a.alias) === url),
  );
  if (direct) return absolute(direct.url);
  // kokoro-js hardcodes main for voice files. Redirect to the same pinned snapshot
  // locally, before fetching. No mutable model revision is used for inference.
  for (const m of Object.values(models)) {
    if (!m.id) continue;
    const prefix = `https://huggingface.co/${m.id}/resolve/main/`;
    if (url.startsWith(prefix))
      return `https://huggingface.co/${m.id}/resolve/${m.revision}/${url.slice(prefix.length)}`;
  }
  return url;
}

export async function cachedResponse(url) {
  const canonical = canonicalAsset(url),
    asset = all.find((a) => absolute(a.url) === canonical);
  const response = await (await caches.open(ASSET_CACHE)).match(canonical);
  return response &&
    (!asset || response.headers.get("X-PageVoice-SHA256") === asset.sha256)
    ? response
    : undefined;
}

/** Inference workers only read explicit cached artifacts. They never download a
 * model in response to book text, including optional tokenizer-file probes. */
export function guardInferenceFetch() {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, options = {}) => {
    const url = canonicalAsset(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    if ((options.method || input.method || "GET") !== "GET")
      throw Error("blockedRequest");
    if (url.startsWith("https://huggingface.co/")) {
      const response = await cachedResponse(url);
      return (
        response || new Response("Model file is not cached", { status: 404 })
      );
    }
    if (all.some((a) => absolute(a.url) === url)) {
      const response = await cachedResponse(url);
      if (response) return response;
      throw Error("modelNotCached");
    }
    const origin = globalThis.location.origin;
    if (new URL(url).origin !== origin && !url.startsWith("blob:"))
      throw Error("blockedRequest");
    return original(input, options);
  };
}

export class AssetManager {
  constructor({
    fetcher = globalThis.fetch.bind(globalThis),
    cacheStorage = globalThis.caches,
    storage = globalThis.navigator?.storage,
  } = {}) {
    this.fetcher = fetcher;
    this.caches = cacheStorage;
    this.storage = storage;
    this.running = new Map();
    this.progress = {};
    this.listeners = new Set();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(id, value) {
    this.progress = { ...this.progress, [id]: value };
    for (const listener of this.listeners) listener(this.progress);
  }
  async status(id) {
    const cache = await this.caches.open(ASSET_CACHE);
    let bytes = 0;
    for (const a of MODEL_GROUPS[id].files)
      if (
        (await cache.match(absolute(a.url)))?.headers.get(
          "X-PageVoice-SHA256",
        ) === a.sha256
      )
        bytes += a.size;
    return { ready: bytes === groupBytes(id), bytes, total: groupBytes(id) };
  }
  pause(id) {
    this.running.get(id)?.abort();
  }
  async install(id, onProgress = () => {}) {
    if (this.running.has(id)) throw Error("downloadBusy");
    const group = MODEL_GROUPS[id];
    if (!group) throw Error("unknownModel");
    const controller = new AbortController();
    this.running.set(id, controller);
    const report = (value) => {
      this.publish(id, value);
      onProgress(value);
    };
    report({ loaded: 0, total: groupBytes(id) });
    let dir;
    try {
      // OPFS can be blocked (SecurityError) in some private or embedded contexts.
      // Downloads then fall back to the in-memory path below.
      try {
        if (this.storage?.getDirectory)
          dir = await (
            await this.storage.getDirectory()
          ).getDirectoryHandle("pagevoice-downloads", { create: true });
        if (dir && !(await opfsWritable(dir))) dir = undefined;
      } catch {
        dir = undefined;
      }
      const cache = await this.caches.open(ASSET_CACHE);
      let completed = 0;
      const total = groupBytes(id);
      for (const asset of group.files) {
        if (controller.signal.aborted)
          throw new DOMException("Paused", "AbortError");
        const url = absolute(asset.url);
        if (
          (await cache.match(url))?.headers.get("X-PageVoice-SHA256") ===
          asset.sha256
        ) {
          completed += asset.size;
          report({
            loaded: completed,
            total,
            file: asset.path || asset.url,
          });
          continue;
        }
        let handle,
          offset = 0,
          writer;
        const chunks = [];
        if (dir) {
          handle = await dir.getFileHandle((await hashText(url)) + ".part", {
            create: true,
          });
          offset = (await handle.getFile()).size;
          if (offset > asset.size) offset = 0;
        }
        let response;
        if (offset === asset.size) response = null;
        else {
          response = await this.fetcher(url, {
            method: "GET",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
            headers: offset ? { Range: `bytes=${offset}-` } : undefined,
          });
          if (!response.ok || response.type === "opaque")
            throw Error("downloadFailed");
          if (offset && response.status !== 206) offset = 0; // This CDN cannot resume this file; restart it safely.
        }
        if (handle) {
          writer = await handle.createWritable({
            keepExistingData: offset > 0,
          });
          await writer.seek(offset);
        }
        let loaded = offset;
        try {
          if (response?.body) {
            const reader = response.body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (controller.signal.aborted) {
                await reader.cancel();
                throw new DOMException("Paused", "AbortError");
              }
              loaded += value.byteLength;
              if (loaded > asset.size) {
                await reader.cancel();
                throw Error("assetIntegrity");
              }
              if (writer) await writer.write(value);
              else chunks.push(value);
              report({
                loaded: completed + loaded,
                total,
                file: asset.path || asset.url,
              });
            }
          } else if (response) {
            const buffer = await response.arrayBuffer();
            loaded += buffer.byteLength;
            if (writer) await writer.write(buffer);
            else chunks.push(buffer);
          }
        } finally {
          await writer?.close();
        }
        const blob = handle ? await handle.getFile() : new Blob(chunks);
        const digest = await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );
        const hash = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (blob.size !== asset.size || hash !== asset.sha256) {
          await removeIfPresent(dir, handle?.name);
          throw Error("assetIntegrity");
        }
        const headers = {
          "X-PageVoice-SHA256": asset.sha256,
          "Content-Type": asset.url.endsWith(".wasm")
            ? "application/wasm"
            : /\.(?:js|mjs)$/u.test(asset.url)
              ? "text/javascript"
              : asset.url.endsWith(".json")
                ? "application/json"
                : "application/octet-stream",
        };
        await cache.put(url, new Response(blob, { headers }));
        if (asset.alias)
          await cache.put(
            absolute(asset.alias),
            new Response(blob, { headers }),
          );
        await removeIfPresent(dir, handle?.name);
        completed += asset.size;
        report({ loaded: completed, total, file: asset.path || asset.url });
      }
      return true;
    } catch (error) {
      // WebKit refuses single cache responses above roughly 128 MB. Say so
      // plainly rather than surfacing the browser's internal message.
      if (/too much data buffered/iu.test(error?.message || ""))
        throw Error("cacheTooLarge", { cause: error });
      throw error;
    } finally {
      this.running.delete(id);
      this.publish(id, null);
    }
  }
  async remove(id) {
    this.pause(id);
    const cache = await this.caches.open(ASSET_CACHE);
    const retained = new Set();
    for (const [other, group] of Object.entries(MODEL_GROUPS))
      if (other !== id && (await this.status(other)).ready)
        for (const asset of group.files) retained.add(asset.url);
    // Shared runtimes remain cached so removing one voice cannot break another.
    for (const a of MODEL_GROUPS[id].files.filter(
      (a) => !a.url.startsWith("/runtime/"),
    )) {
      if (retained.has(a.url)) continue;
      await cache.delete(absolute(a.url));
      if (a.alias) await cache.delete(absolute(a.alias));
    }
  }
}
