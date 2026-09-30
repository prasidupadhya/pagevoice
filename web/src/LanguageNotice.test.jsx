import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { messages } from "./i18n";
import LanguageNotice from "./LanguageNotice";

it("shows detected language and honest weak evidence in either interface", () => {
  render(
    <LanguageNotice
      language="es"
      t={messages.en}
      detection={{
        source: "text",
        review: true,
        metadata_mismatch: true,
        scores: { en: 2, es: 20 },
      }}
    />,
  );
  expect(screen.getByText(/Detected language: Español/)).toBeTruthy();
  expect(screen.getByText(messages.en.languageMismatch)).toBeTruthy();
});

it("does not pretend legacy or manually overridden languages were detected", () => {
  const { container } = render(
    <LanguageNotice
      language="en"
      t={messages.es}
      detection={{ source: "manual" }}
    />,
  );
  expect(container.textContent).toBe("");
});
