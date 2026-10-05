import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import {
  AssetManager,
  MODEL_GROUPS,
  canonicalAsset,
  guardInferenceFetch,
  ASSET_CACHE,
} from "./assets";
import models from "./model-assets.json";
beforeEach(() => vi.stubGlobal("Blob", Blob));
afterEach(() => vi.unstubAllGlobals());
function memoryCache() {
  const entries = new Map();
  const cache = {
    match: async (k) => entries.get(k)?.clone(),
    put: async (k, v) => entries.set(k, v.clone()),
    delete: async (k) => entries.delete(k),
  };
  return { entries, cache, open: async () => cache };
}
it("maps mutable Kokoro library requests to pinned static artifacts", () => {
  const p = models.kokoro;
  expect(
    canonicalAsset(
      `https://huggingface.co/${p.id}/resolve/main/voices/af_heart.bin`,
    ),
  ).toBe(
    `https://huggingface.co/${p.id}/resolve/${p.revision}/voices/af_heart.bin`,
  );
});
it("downloads only fixed GET files, validates size/hash, then uses cache without another download", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const cache = memoryCache(),
    body = new TextEncoder().encode("model");
  const hash = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", body),
  ).toString("hex");
  MODEL_GROUPS.test = {
    files: [{ url: "https://static.example/model", size: 5, sha256: hash }],
  };
  const fetcher = vi.fn(async () => new Response(body));
  try {
    const manager = new AssetManager({
      fetcher,
      cacheStorage: cache,
      storage: {},
    });
    await manager.install("test");
    expect((await manager.status("test")).ready).toBe(true);
    await manager.install("test");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  } finally {
    delete MODEL_GROUPS.test;
    vi.unstubAllGlobals();
  }
});
it("rejects corrupt assets and never marks them cached", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const cache = memoryCache();
  MODEL_GROUPS.test = {
    files: [
      { url: "https://static.example/model", size: 5, sha256: "0".repeat(64) },
    ],
  };
  try {
    const manager = new AssetManager({
      fetcher: async () => new Response("wrong"),
      cacheStorage: cache,
      storage: {},
    });
    await expect(manager.install("test")).rejects.toThrow("assetIntegrity");
    expect((await manager.status("test")).ready).toBe(false);
  } finally {
    delete MODEL_GROUPS.test;
    vi.unstubAllGlobals();
  }
});
it("inference never fetches uncached remote data or POSTs book text", async () => {
  const fetcher = vi.fn(),
    cache = memoryCache();
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal("caches", cache);
  try {
    guardInferenceFetch();
    await expect(
      fetch("https://somewhere.example", { method: "POST", body: "book text" }),
    ).rejects.toThrow("blockedRequest");
    const r = await fetch(models.kokoro.assets[0].url);
    expect(r.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await cache.open(ASSET_CACHE)).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});
