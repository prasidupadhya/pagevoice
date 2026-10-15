import { describe, expect, it } from "vitest";
import { voiceLabel, voicesFor } from "./voices";

const VOICES = [
  { id: "a1", name: "Adam", locale: "en-US", gender: "male" },
  { id: "b2", name: "Verity", locale: "en-GB", gender: "female" },
  { id: "c3", name: "Sofia", locale: "es-ES", gender: "female" },
  { id: "d4", name: "Antonio", locale: "es", gender: "male" },
  { id: "e5", name: "Unlabelled", locale: "", gender: "" },
];
const GENDER = { male: "Male", female: "Female" };

describe("voicesFor", () => {
  it("offers only English voices for an English book", () => {
    expect(voicesFor(VOICES, "en").map((v) => v.id)).toEqual(["a1", "b2"]);
  });

  it("offers only Spanish voices for a Spanish book", () => {
    expect(voicesFor(VOICES, "es").map((v) => v.id)).toEqual(["c3", "d4"]);
  });

  it("never offers a voice without a language", () => {
    expect(voicesFor(VOICES, "en").some((v) => v.id === "e5")).toBe(false);
    expect(voicesFor(VOICES, "es").some((v) => v.id === "e5")).toBe(false);
  });
});

describe("voiceLabel", () => {
  it("names the voice, its accent and its gender", () => {
    expect(voiceLabel(VOICES[1], "en", GENDER)).toBe("Verity · British English · Female");
    expect(voiceLabel(VOICES[0], "en", GENDER)).toBe("Adam · American English · Male");
  });

  it("follows the app language for the accent name", () => {
    expect(voiceLabel(VOICES[2], "es", { male: "Masculina", female: "Femenina" })).toBe(
      "Sofia · español de España · Femenina",
    );
  });

  it("omits the gender when it is unknown", () => {
    expect(voiceLabel({ id: "x", name: "Michael", locale: "en", gender: "" }, "en", GENDER)).toBe(
      "Michael · English",
    );
  });
});
