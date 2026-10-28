/** 16-bit mono PCM WAV. Every browser plays it, and sentences stay small. */
export function encodeWav(samples, rate) {
  if (
    !Number.isInteger(rate) ||
    rate < 8000 ||
    rate > 96000 ||
    samples.length > rate * 900
  )
    throw Error("invalidAudio");
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const text = (offset, value) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Number.isFinite(samples[i])
      ? Math.max(-1, Math.min(1, samples[i]))
      : 0;
    view.setInt16(44 + i * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
export function audioStats(samples, rate) {
  let sum = 0,
    peak = 0;
  for (const x of samples) {
    sum += x * x;
    peak = Math.max(peak, Math.abs(x));
  }
  return {
    duration: samples.length / rate,
    rms: Math.sqrt(sum / Math.max(1, samples.length)),
    peak,
  };
}
export function concatenate(parts, rate) {
  const output = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const part of parts) {
    output.set(part, p);
    p += part.length;
  }
  if (output.length > rate * 900) throw Error("sentenceTooLong");
  return output;
}
/** Splits a sentence at the editor's [pause:seconds] and [voice:id] … [/voice]
 * marks. Voice names may be cast character names. */
export function speechParts(text, defaultVoice, cast = {}) {
  let voice = defaultVoice;
  const parts = [];
  let position = 0;
  for (const m of text.matchAll(/\[(?:(pause|voice):([^\]]+)|(\/voice))\]/gu)) {
    if (m.index > position)
      parts.push({ text: text.slice(position, m.index), voice });
    if (m[3]) voice = defaultVoice;
    else if (m[1] === "voice") voice = cast[m[2].trim()] || m[2].trim();
    else {
      const seconds = Number(m[2]);
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 30)
        throw Error("invalidPause");
      parts.push({ pause: seconds });
    }
    position = m.index + m[0].length;
  }
  if (position < text.length) parts.push({ text: text.slice(position), voice });
  return parts.filter(
    (p) => p.pause !== undefined || /[\p{L}\p{N}]/u.test(p.text),
  );
}
