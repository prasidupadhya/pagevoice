import { describe, expect, it, vi } from "vitest";
import { SpeechController, splitLongSpeech } from "./SpeechController";

function harness(onState = () => {}) {
  const utterances = [];
  const synth = {
    speak: vi.fn((utterance) => utterances.push(utterance)),
    cancel: vi.fn(),
  };
  const controller = new SpeechController({
    synth,
    utteranceFactory: (text) => ({ text }),
    onState,
  });
  return { controller, synth, utterances };
}

describe("browser speech playback", () => {
  it("speaks one sentence at a time, advances in chapter order and supports pause/skip", () => {
    const states = [];
    const { controller, synth, utterances } = harness((state) =>
      states.push(state),
    );
    controller.play(
      {
        language: "es",
        chapters: [
          { title: "Inicio", sentences: ["Primera frase.", "Segunda frase."] },
          { title: "Capítulo 1", sentences: ["Tercera frase."] },
        ],
      },
      0,
      0,
      null,
      1.2,
    );
    expect(utterances[0]).toMatchObject({
      text: "Primera frase.",
      lang: "es-ES",
      rate: 1.2,
    });
    utterances[0].onstart();
    utterances[0].onend();
    expect(utterances[1].text).toBe("Segunda frase.");
    expect(states.at(-1)).toMatchObject({ chapter: 0, sentence: 1 });
    controller.pause();
    expect(controller.status).toBe("paused");
    expect(synth.cancel).toHaveBeenCalled();
    controller.resume();
    expect(utterances.at(-1).text).toBe("Segunda frase.");
    controller.next();
    expect(utterances.at(-1).text).toBe("Tercera frase.");
  });

  it("splits only oversized speech requests at readable clause boundaries", () => {
    const text =
      "A careful explanation, with several details; continues for the reader. ".repeat(
        5,
      );
    const chunks = splitLongSpeech(text, 95);
    expect(chunks.every((chunk) => chunk.length <= 96)).toBe(true);
    expect(chunks.join(" ")).toBe(text.trim());
  });

  it("reports a blocked autoplay state so a user gesture can resume it", () => {
    const { controller, utterances } = harness();
    controller.play({
      language: "en",
      chapters: [{ sentences: ["A sentence."] }],
    });
    utterances[0].onerror({ error: "not-allowed" });
    expect(controller.status).toBe("blocked");
    controller.resume();
    expect(utterances).toHaveLength(2);
  });
});
