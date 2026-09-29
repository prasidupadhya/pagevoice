import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrowserApp from "./BrowserApp";
import { BrowserBackend } from "./backends/BrowserBackend";
import { messages } from "./i18n";

function fixtureBackend() {
  const backend = new BrowserBackend({
    workerFactory: () => {
      throw Error("No worker expected");
    },
  });
  backend.books.set("temporary-book", {
    id: "temporary-book",
    title: "The Lantern",
    author: "PageVoice Test",
    language: "en",
    format: "epub",
    sourceSize: 100,
    cover: "",
    chapters: [
      {
        title: "Chapter One",
        source: "OPS/chapter.xhtml#one",
        evidence: "navigation",
        role: "chapter",
        sentences: [
          "Mira carried a blue lantern through the harbour.",
          "The lighthouse stood above the sea.",
        ],
      },
    ],
    analysis: { startChapter: 0, sections: [] },
    searchIndex: [
      {
        chapter: 0,
        sentence: 0,
        tokens: ["mira", "carried", "blue", "lantern", "harbour"],
      },
      {
        chapter: 0,
        sentence: 1,
        tokens: ["lighthouse", "stood", "above", "sea"],
      },
    ],
    startChapter: 0,
    warnings: [],
  });
  return backend;
}

describe("temporary browser reader UI", () => {
  it("never calls /api, hides the API connection error, and provides local search", async () => {
    const fetch = vi.fn((url) => {
      if (String(url).includes("/api"))
        throw new Error("unexpected API request");
      return Promise.reject(new Error("unexpected network request"));
    });
    vi.stubGlobal("fetch", fetch);
    const user = userEvent.setup();
    render(<BrowserApp backend={fixtureBackend()} />);
    expect(screen.getByText(messages.en.browser.temporaryNotice)).toBeTruthy();
    expect(screen.queryByText(messages.en.backendNotConfigured)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /The Lantern PageVoice Test/ }),
    );
    await screen.findByRole("heading", { name: "The Lantern" });
    await user.type(
      screen.getByRole("searchbox", {
        name: messages.en.browser.searchPlaceholder,
      }),
      "lantern",
    );
    expect(
      (await screen.findAllByText(/Mira carried a blue lantern/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(messages.en.browser.localLexical)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes a book with Undo and a fresh reader starts with an empty session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("browser mode must not fetch");
      }),
    );
    const user = userEvent.setup();
    const first = render(<BrowserApp backend={fixtureBackend()} />);
    await user.click(
      screen.getByRole("button", { name: /The Lantern PageVoice Test/ }),
    );
    await user.click(
      screen.getAllByRole("button", { name: "Remove book: The Lantern" })[0],
    );
    await user.click(
      screen.getByRole("button", { name: messages.en.browser.deleteBook }),
    );
    const undo = await screen.findByRole("button", {
      name: messages.en.browser.undo,
    });
    await user.click(undo);
    expect(
      await screen.findByRole("button", { name: /The Lantern PageVoice Test/ }),
    ).toBeTruthy();
    first.unmount();
    render(<BrowserApp />);
    expect(
      await screen.findByRole("heading", { name: messages.en.browser.noBooks }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /The Lantern PageVoice Test/ }),
    ).toBeNull();
  });
});
