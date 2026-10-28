import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { Blob } from "node:buffer";
import {
  VOICES,
  LocalEngine,
  defaultVoice,
  modelFor,
  voiceById,
} from "./engines";
import { encodeWav, speechParts } from "./audio";
import { RenderQueue, signatureFor, modelsFor, readyRun } from "./render";
import { MODEL_GROUPS } from "./assets";
import { voicesFor } from "./voices";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("Blob", Blob);
});
afterEach(() => vi.unstubAllGlobals());

const book = (patch = {}) => ({
  id: "b",
  language: "en",
  settings: { engine: "local", voice: "af_heart", cast: {}, buffer: 5 },
  characters: { speakers: {}, characters: [] },
  chapters: [{ title: "One", sentences: ["Hello there.", "A second line."] }],
  prepared: {},
  ...patch,
});

it("offers on-device voices for both book languages, each with pinned files", () => {
  expect(voicesFor(VOICES, "en").length).toBe(8);
  expect(voicesFor(VOICES, "es").map((v) => v.id)).toEqual([
    "davefx",
    "ef_dora",
    "em_alex",
    "sharvard:1",
    "sharvard:0",
  ]);
  // Spanish has female voices as well as male ones.
  expect(
    voicesFor(VOICES, "es").filter((v) => v.gender === "female").length,
  ).toBe(2);
  expect(defaultVoice("en")).toBe("af_heart");
  expect(defaultVoice("es")).toBe("davefx");
  expect(defaultVoice("fr")).toBe("");
  for (const v of VOICES) expect(MODEL_GROUPS[modelFor(v.id)].voice).toBe(true);
  // Every Kokoro voice style is served by this site, aliased from the URL
  // kokoro-js asks for.
  for (const v of VOICES.filter((v) => v.engine === "kokoro"))
    expect(
      MODEL_GROUPS.kokoro.files.some(
        (f) =>
          f.url === `/runtime/kokoro/${v.id}.bin` &&
          f.alias.endsWith(`/resolve/main/voices/${v.id}.bin`),
      ),
    ).toBe(true);
  expect(Object.keys(MODEL_GROUPS)).toEqual([
    "kokoro",
    "kokoro-es",
    "piper",
    "sharvard",
    "ocr",
  ]);
});

it("encodes 16-bit mono WAV that browsers can play", async () => {
  const blob = encodeWav(Float32Array.of(0, 1, -1, 2), 24000);
  const view = new DataView(await blob.arrayBuffer());
  expect(blob.type).toBe("audio/wav");
  expect(view.byteLength).toBe(44 + 8);
  expect(view.getUint32(24, true)).toBe(24000);
  expect(view.getInt16(46, true)).toBe(32767);
  expect(view.getInt16(48, true)).toBe(-32768);
  // Out-of-range samples are clipped, not wrapped.
  expect(view.getInt16(50, true)).toBe(32767);
  expect(() => encodeWav(new Float32Array(10), 100)).toThrow("invalidAudio");
});

it("reads pause and voice marks, and skips parts with nothing to say", () => {
  expect(
    speechParts("Hi [pause:1] there [voice:Ann]friend[/voice]!", "af_heart", {
      Ann: "bf_emma",
    }),
  ).toEqual([
    { text: "Hi ", voice: "af_heart" },
    { pause: 1 },
    { text: " there ", voice: "af_heart" },
    { text: "friend", voice: "bf_emma" },
  ]);
  expect(speechParts("* * *", "af_heart")).toEqual([]);
  expect(() => speechParts("[pause:99]", "af_heart")).toThrow("invalidPause");
});

it("changes a sentence's signature only when what is spoken changes", async () => {
  const a = book(),
    row = { id: "0:0", text: "Hello there." };
  const base = await signatureFor(a, row);
  expect(await signatureFor(book(), row)).toBe(base);
  expect(
    await signatureFor(
      book({ settings: { ...a.settings, voice: "am_adam" } }),
      row,
    ),
  ).not.toBe(base);
  expect(
    await signatureFor(book({ settings: { ...a.settings, buffer: 40 } }), row),
  ).toBe(base);
});

it("knows which voice files a book needs, including cast voices", () => {
  expect(modelsFor(book())).toEqual(["kokoro"]);
  expect(
    modelsFor(
      book({
        language: "es",
        settings: {
          voice: "davefx",
          cast: { Ana: "sharvard:1" },
          buffer: 5,
        },
      }),
    ),
  ).toEqual(["piper", "sharvard"]);
});

it("waits for a short buffer before playback, never longer than the book", () => {
  const b = book();
  expect(readyRun(b, 0, 0)).toEqual({ count: 0, required: 2 });
  b.prepared["0:0"] = {};
  expect(readyRun(b, 0, 0).count).toBe(1);
});

it("the engine client sends text only to its own worker and reports failures plainly", async () => {
  const posted = [];
  const worker = {
    postMessage: (m) => {
      posted.push(m);
      queueMicrotask(() =>
        worker.onmessage({
          data:
            m.options.text === "bad"
              ? { id: m.id, error: "silentAudio" }
              : {
                  id: m.id,
                  result: { samples: new Float32Array(4), sampleRate: 24000 },
                },
        }),
      );
    },
    terminate: vi.fn(),
  };
  const engine = new LocalEngine({ workerFactory: () => worker });
  const result = await engine.synthesize({ text: "Hi.", voice: "af_heart" });
  expect(result.sampleRate).toBe(24000);
  expect(posted[0].options).toEqual({
    text: "Hi.",
    voice: "af_heart",
    cast: {},
  });
  await expect(
    engine.synthesize({ text: "bad", voice: "af_heart" }),
  ).rejects.toThrow("silentAudio");
  await expect(engine.synthesize({ text: "x", voice: "nope" })).rejects.toThrow(
    "voiceUnknown",
  );
  expect(voiceById("nope")).toBeUndefined();
});

it("fetches the voice once, then prepares every sentence as WAV", async () => {
  const b = book(),
    stored = {};
  const store = {
    get: () => b,
    getAudio: async (key) => stored[key],
    putAudio: async (id, row, signature, blob, details) => {
      const key = `${id}/${row}/${signature}`;
      stored[key] = blob;
      b.prepared = { ...b.prepared, [row]: { key, signature, ...details } };
    },
  };
  let ready = false;
  const assets = {
    status: async () => ({ ready }),
    ensure: vi.fn(async (id, progress) => {
      progress({ loaded: 50, total: 100 });
      ready = true;
    }),
  };
  const engine = {
    synthesize: vi.fn(async () => ({
      samples: new Float32Array(2400),
      sampleRate: 24000,
      duration: 0.1,
      rtf: 0.5,
    })),
    dispose: vi.fn(),
  };
  const states = [];
  const queue = new RenderQueue({
    store,
    engine,
    assets,
    onChange: (s) => states.push({ ...s }),
  });
  await queue.prepare("b");
  expect(assets.ensure).toHaveBeenCalledTimes(1);
  expect(
    states.some((s) => s.status === "loading" && s.voice?.loaded === 50),
  ).toBe(true);
  expect(Object.keys(b.prepared).sort()).toEqual(["0:0", "0:1"]);
  expect(Object.values(stored).every((blob) => blob.type === "audio/wav")).toBe(
    true,
  );
  expect(states.at(-1).status).toBe("complete");
  // A second run reuses the cached voice and the stored audio.
  await queue.prepare("b");
  expect(assets.ensure).toHaveBeenCalledTimes(1);
  expect(engine.synthesize).toHaveBeenCalledTimes(2);
});

it("a voice that cannot be fetched becomes a message the reader can act on", async () => {
  const b = book();
  const queue = new RenderQueue({
    store: { get: () => b },
    engine: { dispose: vi.fn() },
    assets: {
      status: async () => ({ ready: false }),
      ensure: async () => {
        throw new TypeError("Failed to fetch");
      },
    },
  });
  await expect(queue.prepare("b")).rejects.toThrow("voiceLoadFailed");
  expect(queue.state.status).toBe("error");
});

it("a sentence the voice cannot read becomes a short pause instead of stopping the book", async () => {
  const b = book(),
    stored = {};
  const store = {
    get: () => b,
    getAudio: async (key) => stored[key],
    putAudio: async (id, row, signature, blob, details) => {
      stored[row] = blob;
      b.prepared = {
        ...b.prepared,
        [row]: { key: row, signature, ...details },
      };
    },
  };
  const engine = {
    synthesize: vi.fn(async ({ text }) => {
      if (text === "Hello there.") throw Error("silentAudio");
      return { samples: new Float32Array(10), sampleRate: 24000, duration: 1 };
    }),
    dispose: vi.fn(),
  };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const queue = new RenderQueue({
    store,
    engine,
    assets: { status: async () => ({ ready: true }) },
  });
  await queue.prepare("b");
  expect(Object.keys(b.prepared).sort()).toEqual(["0:0", "0:1"]);
  expect(b.prepared["0:0"].duration).toBe(0.5);
  expect(queue.state.status).toBe("complete");
  warn.mockRestore();
});

it("steps between sentences across sections, skipping empty ones", async () => {
  const { rowAfter, rowAt } = await import("./library");
  const b = book({
    chapters: [
      { title: "A", sentences: ["a1", "a2"] },
      { title: "Empty", sentences: [] },
      { title: "C", sentences: ["c1"] },
    ],
  });
  expect(rowAfter(b, 0, 1, 1).id).toBe("2:0");
  expect(rowAfter(b, 2, 0, -1).id).toBe("0:1");
  expect(rowAfter(b, 2, 0, 1)).toBeUndefined();
  expect(rowAfter(b, 0, 0, -1)).toBeUndefined();
  expect(rowAt(b, 1, 0)).toBeUndefined();
  // The buffer looks ahead across the empty section and stops at its size.
  b.prepared = { "0:1": {}, "2:0": {} };
  expect(readyRun(b, 0, 1)).toEqual({ count: 2, required: 2 });
  expect(readyRun(b, 1, 0)).toEqual({ count: 0, required: 0 });
});
