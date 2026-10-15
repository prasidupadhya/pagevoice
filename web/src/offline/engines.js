// Narration runs through this site's /api routes, which forward to ElevenLabs.
// The text of the sentence being narrated is sent to ElevenLabs. Nothing else
// from the book is sent.
export const NARRATION = "elevenlabs";

const failed = (error) =>
  error instanceof TypeError ? Error("ttsOffline") : error;

export async function listVoices(fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl("/api/voices");
  } catch (error) {
    throw failed(error);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "ttsUnavailable");
  return data.voices || [];
}

export async function synthesize(text, voice, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice }),
    });
  } catch (error) {
    throw failed(error);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(data.error || "ttsFailed");
  }
  return response.blob();
}

/** Length of an MP3 in seconds, read by the browser's media decoder. */
export function durationOf(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob),
      audio = new Audio(url);
    const done = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
  });
}
