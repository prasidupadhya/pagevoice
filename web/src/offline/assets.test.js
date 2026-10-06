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
it("pause retains a partial file and resumes by HTTP Range with hash verification", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const body = new TextEncoder().encode("abcdef"),
    cache = memoryCache(),
    files = new Map();
  const sha256 = Buffer.from(
    await webcrypto.subtle.digest("SHA-256", body),
  ).toString("hex");
  MODEL_GROUPS.test = {
    files: [{ url: "https://static.example/resumable", size: 6, sha256 }],
  };
  const dir = {
    getDirectoryHandle: async () => dir,
    removeEntry: async (name) => files.delete(name),
    getFileHandle: async (name) => {
      if (!files.has(name)) files.set(name, new Uint8Array());
      return {
        name,
        getFile: async () => new Blob([files.get(name)]),
        createWritable: async ({ keepExistingData }) => {
          if (!keepExistingData) files.set(name, new Uint8Array());
          let offset = 0;
          return {
            seek: async (p) => (offset = p),
            write: async (value) => {
              const previous = files.get(name),
                next = new Uint8Array(
                  Math.max(previous.length, offset + value.length),
                );
              next.set(previous);
              next.set(value, offset);
              offset += value.length;
              files.set(name, next);
            },
            close: async () => {},
          };
        },
      };
    },
  };
  const fetcher = vi.fn(async (_url, options) => {
    if (fetcher.mock.calls.length === 1)
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(body.slice(0, 3));
            c.enqueue(body.slice(3));
            c.close();
          },
        }),
      );
    expect(options.headers.Range).toBe("bytes=3-");
    return new Response(body.slice(3), { status: 206 });
  });
  try {
    const manager = new AssetManager({
        fetcher,
        cacheStorage: cache,
        storage: { getDirectory: async () => dir },
      }),
      changes = [];
    const unsubscribe = manager.subscribe((value) => changes.push(value.test));
    await expect(
      manager.install("test", (p) => {
        if (p.loaded === 3) manager.pause("test");
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect([...files.values()][0].length).toBe(3);
    expect((await manager.status("test")).ready).toBe(false);
    await manager.install("test");
    expect((await manager.status("test")).ready).toBe(true);
    expect(files.size).toBe(0);
    expect(changes.some((p) => p?.loaded === 3)).toBe(true);
    unsubscribe();
  } finally {
    delete MODEL_GROUPS.test;
  }
});
it("removing a CPU model preserves files needed by an installed GPU model", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const cache = memoryCache();
  const asset = async (name) => ({
    url: `https://static.example/${name}`,
    size: name.length,
    sha256: Buffer.from(
      await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(name)),
    ).toString("hex"),
  });
  const shared = await asset("shared"),
    cpu = await asset("cpu"),
    gpu = await asset("gpu");
  MODEL_GROUPS.cpu = { files: [shared, cpu] };
  MODEL_GROUPS.gpu = { files: [shared, gpu] };
  try {
    const manager = new AssetManager({
      fetcher: async (url) => new Response(url.split("/").at(-1)),
      cacheStorage: cache,
      storage: {},
    });
    await manager.install("cpu");
    await manager.install("gpu");
    await manager.remove("cpu");
    expect((await manager.status("gpu")).ready).toBe(true);
    expect((await manager.status("cpu")).ready).toBe(false);
    await manager.remove("gpu");
    expect(await cache.cache.match(shared.url)).toBeUndefined();
  } finally {
    delete MODEL_GROUPS.cpu;
    delete MODEL_GROUPS.gpu;
  }
});
