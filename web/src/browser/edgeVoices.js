export const EDGE_ONLINE_VOICES = Object.freeze([
  {
    id: "en-US-AriaNeural",
    name: "Aria",
    language: "en",
    region: "US",
    gender: "female",
  },
  {
    id: "en-US-JennyNeural",
    name: "Jenny",
    language: "en",
    region: "US",
    gender: "female",
  },
  {
    id: "en-US-GuyNeural",
    name: "Guy",
    language: "en",
    region: "US",
    gender: "male",
  },
  {
    id: "en-US-ChristopherNeural",
    name: "Christopher",
    language: "en",
    region: "US",
    gender: "male",
  },
  {
    id: "en-GB-SoniaNeural",
    name: "Sonia",
    language: "en",
    region: "GB",
    gender: "female",
  },
  {
    id: "en-GB-LibbyNeural",
    name: "Libby",
    language: "en",
    region: "GB",
    gender: "female",
  },
  {
    id: "en-GB-RyanNeural",
    name: "Ryan",
    language: "en",
    region: "GB",
    gender: "male",
  },
  {
    id: "en-GB-ThomasNeural",
    name: "Thomas",
    language: "en",
    region: "GB",
    gender: "male",
  },
  {
    id: "es-ES-ElviraNeural",
    name: "Elvira",
    language: "es",
    region: "ES",
    gender: "female",
  },
  {
    id: "es-ES-XimenaNeural",
    name: "Ximena",
    language: "es",
    region: "ES",
    gender: "female",
  },
  {
    id: "es-ES-AlvaroNeural",
    name: "Álvaro",
    language: "es",
    region: "ES",
    gender: "male",
  },
]);

export const DEFAULT_EDGE_VOICE = Object.freeze({
  en: "en-US-AriaNeural",
  es: "es-ES-ElviraNeural",
});

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export function matchingDeviceVoice(edgeVoice, availableVoices) {
  if (!edgeVoice) return null;
  const [language, region] = edgeVoice.id.split("-");
  const expectedLocale = `${language}-${region}`.toLowerCase();
  const normalizedName = normalized(edgeVoice.name);
  const namePattern = new RegExp(
    `(?:^|[^a-z0-9])${normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`,
  );
  const matches = availableVoices.filter((voice) => {
    const locale = normalized(voice.lang).replaceAll("_", "-");
    return (
      locale === expectedLocale && namePattern.test(normalized(voice.name))
    );
  });
  return matches.find((voice) => voice.default) || matches[0] || null;
}
