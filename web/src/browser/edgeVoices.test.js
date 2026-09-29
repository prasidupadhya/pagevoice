import { describe, expect, it } from "vitest";
import { EDGE_ONLINE_VOICES } from "./edgeVoices";

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
  });
});
