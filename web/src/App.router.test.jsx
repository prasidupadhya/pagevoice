import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { messages } from "./i18n";

it("selects temporary browser mode without probing the API when no API base is configured", async () => {
  const fetch = vi.fn(() => {
    throw new Error("browser mode must not make network requests");
  });
  vi.stubGlobal("fetch", fetch);
  render(<App />);
  expect(
    await screen.findByText(messages.en.browser.temporaryNotice),
  ).toBeTruthy();
  expect(screen.queryByText(messages.en.backendNotConfigured)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
