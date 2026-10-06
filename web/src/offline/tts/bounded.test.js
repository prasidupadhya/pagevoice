import { it, expect } from "vitest";
import { boundedSynthesis } from "./bounded";
it("keeps a supported sentence intact and rejects no words", async () => {
  const texts = [];
  await boundedSynthesis(
    "An ordinary sentence, read in one breath.",
    async (text) => {
      texts.push(text);
      return Float32Array.of(0.1);
    },
  );
  expect(texts).toEqual(["An ordinary sentence, read in one breath."]);
});
it("splits only rejected inputs at clauses or words and preserves the entire text", async () => {
  const texts = [];
  const text =
    "The first passage, followed by the second passage and the final words.";
  const pcm = await boundedSynthesis(text, async (part) => {
    if (part.length > 35) throw Error("tokenLimit");
    texts.push(part);
    return Float32Array.of(0.1);
  });
  expect(texts.join(" ")).toBe(text);
  expect(pcm.length).toBe(texts.length);
});
it("never splits an oversize single word or hides an inference failure", async () => {
  await expect(
    boundedSynthesis("a".repeat(100), async () => {
      throw Error("tokenLimit");
    }),
  ).rejects.toThrow("sentenceTooLong");
  await expect(
    boundedSynthesis("A sentence.", async () => {
      throw Error("outOfMemory");
    }),
  ).rejects.toThrow("outOfMemory");
});
