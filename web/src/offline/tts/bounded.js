/** Keep ordinary sentences intact. Split only after the tokenizer rejects the
 * full input, at a clause or whole-word boundary. Never silently truncate text. */
export async function boundedSynthesis(text, generate, depth = 0) {
  if (text.length > 8000 || depth > 8) throw Error("sentenceTooLong");
  try {
    return await generate(text);
  } catch (error) {
    if (error.message !== "tokenLimit") throw error;
  }
  const middle = text.length / 2;
  let boundaries = [...text.matchAll(/[,:;—–]\s+/gu)]
    .map((m) => m.index + m[0].length)
    .filter((p) => p > text.length / 4 && p < (text.length * 3) / 4);
  if (!boundaries.length)
    boundaries = [...text.matchAll(/\s+/gu)].map((m) => m.index);
  const at = boundaries.sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle),
  )[0];
  if (!at) throw Error("sentenceTooLong");
  const left = await boundedSynthesis(
    text.slice(0, at).trim(),
    generate,
    depth + 1,
  );
  const right = await boundedSynthesis(
    text.slice(at).trim(),
    generate,
    depth + 1,
  );
  const samples = new Float32Array(left.length + right.length);
  samples.set(left);
  samples.set(right, left.length);
  return samples;
}
