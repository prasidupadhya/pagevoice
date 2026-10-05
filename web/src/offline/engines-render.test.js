import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { Blob } from "node:buffer";
import { assertEngine, modelFor, voicesFor, LocalEngine } from "./engines";
import { preparationOrder, readyRun, RenderQueue } from "./render";
import { speechParts, encodeWav, decodeWav, audioStats } from "./audio";
beforeEach(() => vi.stubGlobal("Blob", Blob));
afterEach(() => vi.unstubAllGlobals());
const book = {
  language: "en",
  chapters: [0, 1, 2].map((i) => ({
    title: `Chapter ${i + 1}`,
    sentences: ["One.", "Two.", "Three."],
  })),
  prepared: {},
  settings: { buffer: 5, engine: "kokoro", voice: "af_heart" },
};
it("validates languages and never exposes an English-only phonemizer for Spanish", () => {
  expect(() => assertEngine("kokoro", "es")).toThrow("unsupportedEngine");
  expect(() => assertEngine("piper", "en")).toThrow();
  expect(() => assertEngine("edge", "en")).toThrow();
  expect(() => assertEngine("piper", "es")).not.toThrow();
  expect(voicesFor("kokoro", "en")).toHaveLength(8);
  expect(modelFor("piper", "sharvard:1")).toBe("sharvard");
});
it("prioritizes the chosen sentence, later chapters, then earlier chapters for completion", () => {
  expect(preparationOrder(book, 1, 1).map((r) => r.id)).toEqual([
    "1:1",
    "1:2",
    "2:0",
    "2:1",
    "2:2",
    "0:0",
    "0:1",
    "0:2",
    "1:0",
  ]);
});
it("counts only contiguous prepared sentences and starts short endings early", () => {
  expect(
    readyRun({ ...book, prepared: { "1:1": {}, "1:2": {}, "2:1": {} } }, 1, 1),
  ).toEqual({ count: 2, required: 5 });
  expect(readyRun({ ...book, prepared: { "2:2": {} } }, 2, 2)).toEqual({
    count: 1,
    required: 1,
  });
});
it("worker interface forwards engine changes and terminates pending work on cancel", async () => {
  const worker = { postMessage: vi.fn(), terminate: vi.fn() },
    engine = new LocalEngine({ workerFactory: () => worker });
  const p = engine.synthesize({
    engine: "piper",
    language: "es",
    text: "Hola.",
    voice: "davefx",
  });
  worker.onmessage({ data: { id: 1, result: { duration: 2 } } });
  expect(await p).toEqual({ duration: 2 });
  const second = engine.synthesize({
    engine: "kokoro",
    language: "en",
    text: "Hello.",
    voice: "af_heart",
  });
  engine.dispose();
  await expect(second).rejects.toThrow("cancelled");
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("handles pauses and voice switches without speaking markup", () => {
  expect(
    speechParts("Hola. [pause:1.5] [voice:sharvard:1] Buenos días.", "davefx"),
  ).toEqual([
    { text: "Hola. ", voice: "davefx" },
    { pause: 1.5 },
    { text: " Buenos días.", voice: "sharvard:1" },
  ]);
  expect(() => speechParts("[pause:31]", "v")).toThrow("invalidPause");
  expect(
    speechParts("[voice:María] Hola. [/voice] Adiós.", "davefx", {
      María: "sharvard:1",
    }),
  ).toEqual([
    { text: " Hola. ", voice: "sharvard:1" },
    { text: " Adiós.", voice: "davefx" },
  ]);
});
it("encodes real bounded PCM, reports silence and decodes RIFF accurately", async () => {
  const samples = Float32Array.of(-2, -0.5, 0, 0.5, 2);
  const wav = encodeWav(samples, 24000);
  expect(wav.type).toBe("audio/wav");
  const decoded = await decodeWav(wav);
  expect([...decoded.pcm]).toEqual([-32768, -16384, 0, 16384, 32767]);
  expect(audioStats(new Float32Array(100), 24000).rms).toBe(0);
});
it("rejects a missing model before inference or queueing any book text", async () => {
  const engine = { synthesize: vi.fn() },
    queue = new RenderQueue({
      store: { get: () => book },
      engine,
      assets: { status: async () => ({ ready: false }) },
    });
  await expect(queue.prepare("book")).rejects.toThrow("modelNotCached");
  expect(engine.synthesize).not.toHaveBeenCalled();
});
