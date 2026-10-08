import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";
import App from "./App";
const sample = {
  title: "A quiet book",
  author: "A reader",
  language: "en",
  format: "epub",
  chapters: [
    {
      title: "Chapter 1",
      source: "ch.xhtml",
      sentences: ["A quiet book begins."],
    },
  ],
  analysis: {
    sections: [
      {
        title: "Chapter 1",
        index: 0,
        kind: "chapter",
        confidence: "high",
        flags: [],
      },
    ],
    startChapter: 0,
    reviewCount: 0,
  },
  startChapter: 0,
  searchIndex: [],
  warnings: [],
  sourceSize: 50,
};
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("caches", {
    open: async () => ({ match: async () => undefined }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      throw Error(`Unexpected fetch: ${url}`);
    }),
  );
  vi.stubGlobal(
    "Worker",
    class {
      postMessage(data) {
        if (data.file)
          queueMicrotask(() =>
            this.onmessage?.({
              data: { type: "complete", book: structuredClone(sample) },
            }),
          );
      }
      terminate() {}
    },
  );
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
});
afterEach(() => vi.unstubAllGlobals());
it("starts without a backend, makes no API probe and never presents a connection banner", async () => {
  render(<App />);
  await screen.findByRole("heading", {
    name: "Add a PDF or EPUB to start reading.",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(
    screen.queryByText(/could not reach|PageVoice API|PocketBase/i),
  ).toBeNull();
});
it("shows explicit local model sizes and privacy notice instead of online voices", async () => {
  render(<App />);
  await screen.findByRole("heading", {
    name: "Add a PDF or EPUB to start reading.",
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Offline tools", exact: true }),
  );
  await screen.findByRole("heading", { name: "Offline tools" });
  expect(screen.getByText("Kokoro · English")).toBeTruthy();
  expect(screen.getByText("Piper · Spain Spanish")).toBeTruthy();
  expect(screen.queryByText(/Aria|Edge Online|Microsoft/)).toBeNull();
});
it("session-only import disappears in a fresh app instance, with keyboard-accessible confirmation", async () => {
  const first = render(<App />);
  await screen.findByRole("heading", {
    name: "Add a PDF or EPUB to start reading.",
  });
  await userEvent.click(screen.getByRole("button", { name: "Add a book" }));
  const checkbox = screen.getByRole("checkbox");
  await userEvent.click(checkbox);
  expect(
    screen.getByText(
      "This book disappears when you close or refresh this tab.",
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Choose a file"), {
    target: { files: [new File(["book"], "book.epub")] },
  });
  await screen.findByRole("heading", { name: "A quiet book" });
  expect(fetch).not.toHaveBeenCalled();
  first.unmount();
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", {
        name: "Add a PDF or EPUB to start reading.",
      }),
    ).toBeTruthy(),
  );
});
it("announces an import, opens it, and finds text inside the reader", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  render(<App />);
  await screen.findByRole("heading", {
    name: "Add a PDF or EPUB to start reading.",
  });
  fireEvent.change(screen.getByLabelText("Choose a file"), {
    target: { files: [new File(["book"], "book.epub")] },
  });
  await screen.findByText('Added "A quiet book".');
  expect(screen.getByText("Not started")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open" }));
  await screen.findByRole("tab", { name: "Read", selected: true });
  await userEvent.click(screen.getByRole("button", { name: "Find in book" }));
  await userEvent.type(
    screen.getByPlaceholderText("Find in this book"),
    "quiet",
  );
  await screen.findByText("1 of 1");
  await userEvent.click(
    screen.getByRole("button", { name: "Back to library" }),
  );
  await screen.findByRole("heading", { name: "Continue reading" });
});
