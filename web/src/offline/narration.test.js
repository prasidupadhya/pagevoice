import { afterEach, expect, it, vi } from "vitest";
import { listVoices, synthesize, durationOf } from "./engines";
import { signatureFor, effectiveVoice } from "./render";

afterEach(() => vi.unstubAllGlobals());

it("sends one sentence and the chosen voice to the narration route and returns MP3 bytes", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(new Uint8Array([9, 9]), {
        headers: { "content-type": "audio/mpeg" },
      }),
  );
  const blob = await synthesize("Hello there.", "voice123456", fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/tts",
    expect.objectContaining({ method: "POST" }),
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    text: "Hello there.",
    voice: "voice123456",
  });
  expect(blob.size).toBe(2);
});

it("turns a network failure into a plain message, not a stack trace", async () => {
  const fetcher = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  await expect(synthesize("Hi", "voice123456", fetcher)).rejects.toThrow(
    "ttsOffline",
  );
});

it("passes on the service's error code", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "ttsRateLimited" }), {
        status: 429,
      }),
  );
  await expect(synthesize("Hi", "voice123456", fetcher)).rejects.toThrow(
    "ttsRateLimited",
  );
});

it("lists voices from the service", async () => {
  const voices = [{ id: "voice123456", name: "Rachel", locale: "american" }];
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ voices })));
  await expect(listVoices(fetcher)).resolves.toEqual(voices);
  expect(fetcher).toHaveBeenCalledWith("/api/voices");
});

it("reports a missing narration configuration", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "ttsNotConfigured" }), {
        status: 503,
      }),
  );
  await expect(listVoices(fetcher)).rejects.toThrow("ttsNotConfigured");
});

it("reads the length of an MP3 from the browser's media decoder", async () => {
  class FakeAudio {
    constructor() {
      queueMicrotask(() => {
        this.duration = 2.5;
        this.onloadedmetadata?.();
      });
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    }),
  );
  await expect(durationOf(new Blob(["x"]))).resolves.toBe(2.5);
});

it("regenerates a sentence only when its text or voice changes", async () => {
  const row = { id: "0:0", text: "Hello.", chapter: 0, sentence: 0 };
  const book = {
    language: "en",
    settings: { engine: "elevenlabs", voice: "voice-a", cast: {} },
    characters: { speakers: {} },
  };
  const base = await signatureFor(book, row);
  expect(await signatureFor(book, row)).toBe(base);
  expect(
    await signatureFor(
      { ...book, settings: { ...book.settings, voice: "voice-b" } },
      row,
    ),
  ).not.toBe(base);
  expect(await signatureFor(book, { ...row, text: "Hello again." })).not.toBe(
    base,
  );
  expect(effectiveVoice(book, row)).toBe("voice-a");
});
