import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDGE_VOICE,
  EDGE_ONLINE_VOICES,
  matchingDeviceVoice,
} from "./edgeVoices";

describe("curated Edge Online voice catalogue", () => {
  it("matches the verified eleven names, grouped by language, region and gender", () => {
    expect(EDGE_ONLINE_VOICES).toHaveLength(11);
    expect(
      EDGE_ONLINE_VOICES.filter((voice) => voice.language === "en"),
    ).toHaveLength(8);
    expect(
      EDGE_ONLINE_VOICES.filter((voice) => voice.language === "es"),
    ).toHaveLength(3);
    for (const region of ["US", "GB"]) {
      for (const gender of ["female", "male"]) {
        expect(
          EDGE_ONLINE_VOICES.filter(
            (voice) => voice.region === region && voice.gender === gender,
          ),
        ).toHaveLength(2);
      }
    }
    expect(
      EDGE_ONLINE_VOICES.filter(
        (voice) => voice.region === "ES" && voice.gender === "male",
      ).map((voice) => voice.name),
    ).toEqual(["Álvaro"]);
    expect(EDGE_ONLINE_VOICES.map((voice) => voice.name)).not.toContain(
      "Jorge",
    );
    expect(DEFAULT_EDGE_VOICE).toEqual({
      en: "en-US-AriaNeural",
      es: "es-ES-ElviraNeural",
    });
  });

  it("matches a device voice only by the verified name and regional locale", () => {
    const aria = EDGE_ONLINE_VOICES.find((voice) => voice.name === "Aria");
    const spanish = EDGE_ONLINE_VOICES.find((voice) => voice.name === "Álvaro");
    const devices = [
      { name: "Microsoft Aria Online (Natural)", lang: "en-US" },
      { name: "Google US English", lang: "en-US" },
      { name: "Aria", lang: "en-GB" },
      { name: "Microsoft Alvaro Online", lang: "es-ES", default: true },
      { name: "Microsoft Álvaro Online", lang: "es-MX" },
    ];
    expect(matchingDeviceVoice(aria, devices)).toBe(devices[0]);
    expect(matchingDeviceVoice(spanish, devices)).toBe(devices[3]);
    expect(matchingDeviceVoice(EDGE_ONLINE_VOICES[1], devices)).toBeNull();
  });
});
