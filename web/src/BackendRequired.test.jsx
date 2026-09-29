import React from "react";
import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BackendRequired from "./BackendRequired";
import { messages } from "./i18n";

it("does not silently open temporary mode on an unconfigured public build", () => {
  const fetch = vi.fn(() => {
    throw new Error("an unconfigured public page must not make API calls");
  });
  vi.stubGlobal("fetch", fetch);
  render(<BackendRequired />);
  expect(screen.getByText(messages.en.deploymentTitle)).toBeTruthy();
  expect(screen.getByText(messages.en.apiVariable)).toBeTruthy();
  expect(screen.getByText(messages.en.pocketbaseVariable)).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
