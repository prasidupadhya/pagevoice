import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AudioPlayer } from "./player";
import { Blob } from "node:buffer";
beforeEach(() => {
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:audio"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function setup() {
  const book = {
    id: "b",
    title: "A book",
    author: "A writer",
    settings: { buffer: 20 },
    chapters: [
      {
        title: "Chapter 1",
        sentences: Array.from({ length: 30 }, (_, i) => `Sentence ${i}.`),
      },
    ],
    position: { chapter: 0, sentence: 0 },
    prepared: {},
  };
  const audio = {
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    currentTime: 0,
    duration: 2,
  };
  const store = {
    get: () => book,
    getAudio: async () => new Blob(["audio"]),
    update: async (_id, patch) => Object.assign(book, patch),
  };
  const player = new AudioPlayer({ store, audioFactory: () => audio });
  return { book, audio, store, player };
}
it("waits for 20 consecutive ready sentences and plays only once when notifications overlap", async () => {
  const { book, audio, player } = setup();
  await player.start("b", 0, 0);
  expect(player.state.status).toBe("buffering");
  for (let i = 0; i < 19; i++) book.prepared[`0:${i}`] = { key: "audio" };
  await player.notifyReady();
  expect(audio.play).not.toHaveBeenCalled();
  book.prepared["0:19"] = { key: "audio" };
  await Promise.all([player.notifyReady(), player.notifyReady()]);
  expect(audio.play).toHaveBeenCalledOnce();
  expect(player.state.status).toBe("playing");
  player.dispose();
});
it("pause prevents an in-flight audio load from starting and resume waits for the buffer", async () => {
  const { book, audio, store, player } = setup();
  for (let i = 0; i < 20; i++) book.prepared[`0:${i}`] = { key: "a" };
  let resolve;
  store.getAudio = () => new Promise((r) => (resolve = r));
  const playing = player.start("b", 0, 0);
  await Promise.resolve();
  player.pause();
  resolve(new Blob(["audio"]));
  await playing;
  expect(audio.play).not.toHaveBeenCalled();
  expect(player.state.status).toBe("paused");
  store.getAudio = async () => new Blob(["audio"]);
  await player.resume();
  expect(player.state.status).toBe("playing");
  player.dispose();
});
it("stop revokes the current object URL and clears media state", async () => {
  const { book, player, audio } = setup();
  book.prepared["0:29"] = { key: "audio" };
  await player.start("b", 0, 29);
  expect(player.state.status).toBe("playing");
  player.stop();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  expect(audio.removeAttribute).toHaveBeenCalledWith("src");
  expect(player.bookId).toBeNull();
  expect(player.state.status).toBe("idle");
});
