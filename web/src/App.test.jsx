import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApiApp, { SentenceEditor, UploadDialog } from "./ApiApp";
import { messages } from "./i18n";

const project = {
  id: "a".repeat(32),
  title: "The Quiet Harbour",
  author: "PageVoice",
  language: "en",
  status: "ready",
  engine: "say",
  voice: "Samantha",
  format: "m4b",
  device: "auto",
  chapters: [
    {
      index: 0,
      title: "Arrival",
      sentences: [
        { id: "0000-00000", text: "Mira opened her book.", ready: false },
      ],
    },
  ],
  progress: { complete: 0, total: 1 },
  source_pages: [],
  job: { status: "complete" },
  output: null,
};
function server(current = project) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path, _options) => ({
      ok: true,
      json: async () =>
        path === "/api/projects"
          ? [current]
          : path === "/api/engines"
            ? [
                {
                  id: "say",
                  installed: true,
                  model_ready: true,
                  voices: [{ id: "Samantha", language: "en" }],
                },
              ]
            : path === "/api/voices"
              ? []
              : path === "/api/hardware"
                ? { device: "cpu" }
                : current,
    })),
  );
}
describe("reader interactions", () => {
  it("waits for detected language before choosing clean initial voice settings", async () => {
    let progress;
    vi.stubGlobal(
      "EventSource",
      class {
        addEventListener(name, callback) {
          if (name === "progress") progress = callback;
        }
        close() {}
      },
    );
    const pending = {
      ...project,
      engine: "edge",
      voice: null,
      language: "auto",
      chapters: [],
      job: { status: "running" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path) => ({
        ok: true,
        json: async () =>
          path === "/api/projects"
            ? [pending]
            : path === "/api/engines"
              ? [
                  {
                    id: "edge",
                    installed: true,
                    voices: [
                      {
                        id: "es-ES-ElviraNeural",
                        language: "es",
                        name: "Elvira",
                      },
                    ],
                  },
                ]
              : path === "/api/voices"
                ? []
                : path === "/api/hardware"
                  ? {}
                  : pending,
      })),
    );
    render(<ApiApp />);
    await waitFor(() => expect(progress).toBeTypeOf("function"));
    progress({
      data: JSON.stringify({
        ...project,
        engine: "edge",
        language: "es",
        voice: "es-ES-ElviraNeural",
      }),
    });
    await screen.findByRole("combobox", { name: messages.en.voice });
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: messages.en.voice }).value,
      ).toBe("es-ES-ElviraNeural"),
    );
    expect(screen.queryByRole("button", { name: messages.en.save })).toBeNull();
  });
  it("offers an export bundle with the completed audiobook", async () => {
    const ready = {
      ...project,
      output: `/api/projects/${project.id}/download`,
      bundle: `/api/projects/${project.id}/bundle`,
    };
    server(ready);
    render(<ApiApp />);
    expect(
      (
        await screen.findByRole("link", { name: messages.en.download })
      ).getAttribute("href"),
    ).toBe(ready.output);
    expect(
      screen
        .getByRole("link", { name: messages.en.downloadBundle })
        .getAttribute("href"),
    ).toBe(ready.bundle);
  });
  it("switches interface language and theme while preserving the book language", async () => {
    server();
    render(<ApiApp />);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "The Quiet Harbour" });
    await user.selectOptions(screen.getByLabelText("Interface language"), "es");
    expect(document.documentElement.lang).toBe("es");
    expect(screen.getByText("Voz y exportación")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Tema de color: Oscuro" }),
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("pagevoice-locale")).toBe("es");
    expect(screen.getAllByText("English").length).toBeGreaterThan(0);
  });
  it("does not offer retired cloning or XTTS controls", async () => {
    server();
    render(<ApiApp />);
    await screen.findByRole("heading", { name: "The Quiet Harbour" });
    expect(
      screen.queryByRole("button", { name: "Add your own voice" }),
    ).toBeNull();
    expect(screen.queryByText(/XTTS/)).toBeNull();
    expect(screen.queryByLabelText(messages.en.engine)).toBeNull();
    expect(
      [...screen.getByLabelText("Interface language").options].map(
        (o) => o.text,
      ),
    ).toEqual(["EN", "ES"]);
    expect(
      screen.getByRole("button", {
        name: `${messages.en.theme}: ${messages.en.dark}`,
      }).textContent,
    ).toBe("");
  });
  it("edits and saves exactly the selected sentence", async () => {
    const saved = vi.fn();
    render(
      <SentenceEditor
        row={{ text: "Original sentence." }}
        t={messages.en}
        onClose={() => {}}
        onSave={saved}
        busy={false}
      />,
    );
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Narration text"));
    await user.type(
      screen.getByLabelText("Narration text"),
      "Updated sentence.",
    );
    await user.click(screen.getByRole("button", { name: "Save & regenerate" }));
    expect(saved).toHaveBeenCalledWith("Updated sentence.", "Narrator");
  });
  it("uploads without forcing interface language onto the book", async () => {
    server();
    let uploaded;
    vi.stubGlobal(
      "XMLHttpRequest",
      class {
        upload = {};
        open() {}
        setRequestHeader() {}
        send(body) {
          uploaded = body;
          this.status = 202;
          this.responseText = JSON.stringify(project);
          this.onload();
        }
        abort() {}
      },
    );
    const created = vi.fn();
    render(
      <UploadDialog
        t={messages.en}
        locale="en"
        onCreated={created}
        onClose={() => {}}
      />,
    );
    const user = userEvent.setup();
    await user.upload(
      screen.getByLabelText("PDF or EPUB"),
      new File(["book"], "novela.epub", { type: "application/epub+zip" }),
    );
    expect(screen.queryByLabelText("Book language")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Read this book" }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(uploaded.get("language")).toBeNull();
  });
  it("keeps both translation dictionaries complete", () => {
    expect(Object.keys(messages.en).sort()).toEqual(
      Object.keys(messages.es).sort(),
    );
  });
});

it("exposes a read-only project tool with validated input", async () => {
  const { registerProjectTools } = await import("./webmcp");
  server();
  const registerTool = vi.fn();
  const cleanup = registerProjectTools({ registerTool });
  const tool = registerTool.mock.calls[0][0];
  expect(tool.annotations.readOnlyHint).toBe(true);
  expect((await tool.execute({}))[0].title).toBe("The Quiet Harbour");
  await expect(tool.execute({ render: true })).rejects.toThrow("empty object");
  cleanup();
  expect(registerTool.mock.calls[0][1].signal.aborted).toBe(true);
});

it("Listen from here uses the checked network option, saves settings and starts at sentence 20", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `0000-${String(i).padStart(5, "0")}`,
    text: `Sentence ${i + 1}.`,
    ready: i < 19,
    audio: `/audio/${i}`,
  }));
  const book = {
    ...project,
    engine: "edge",
    voice: "es-MX-JorgeNeural",
    language: "es",
    chapters: [{ index: 0, title: "Arrival", sentences: rows }],
    progress: { complete: 19, total: 25 },
    job: { status: "complete" },
  };
  let progress;
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener(name, fn) {
        if (name === "progress") progress = fn;
      }
      close() {}
    },
  );
  const start = vi.fn(),
    resume = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      destination = {};
      resume = resume;
      suspend = async () => {};
      close = async () => {};
      decodeAudioData = async () => ({ duration: 2 });
      createBufferSource = () => ({
        connect() {},
        disconnect() {},
        stop() {},
        start,
      });
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
      json: async () =>
        path === "/api/projects"
          ? [book]
          : path === "/api/engines"
            ? [
                {
                  id: "edge",
                  installed: true,
                  voices: [{ id: "es-ES-ElviraNeural", language: "es" }],
                },
              ]
            : path === "/api/voices"
              ? []
              : path === "/api/hardware"
                ? { device: "cpu" }
                : path.endsWith("/settings") || path.endsWith("/listen")
                  ? { ...book, voice: "es-ES-ElviraNeural" }
                  : book,
    })),
  );
  render(<ApiApp />);
  await screen.findByRole("heading", { name: book.title });
  const buttons = screen.getAllByRole("button", { name: "Listen from here" });
  await waitFor(() => expect(buttons[0].disabled).toBe(false));
  expect(
    screen.getByRole("checkbox", { name: messages.en.onlineConsent }).checked,
  ).toBe(true);
  expect(fetch.mock.calls.some(([path]) => path.endsWith("/listen"))).toBe(
    false,
  );
  await userEvent.click(buttons[0]);
  await waitFor(() =>
    expect(fetch.mock.calls.some(([path]) => path.endsWith("/listen"))).toBe(
      true,
    ),
  );
  const saved = fetch.mock.calls.find(([path]) => path.endsWith("/settings"));
  expect(JSON.parse(saved[1].body).voice).toBe("es-ES-ElviraNeural");
  const requested = fetch.mock.calls.find(([path]) => path.endsWith("/listen"));
  expect(JSON.parse(requested[1].body)).toEqual({
    chapter: 0,
    allow_network: true,
  });
  expect(resume).toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  await waitFor(() => expect(progress).toBeTypeOf("function"));
  const next = {
    ...book,
    voice: "es-ES-ElviraNeural",
    chapters: [
      {
        ...book.chapters[0],
        sentences: rows.map((r, i) => ({ ...r, ready: i < 20 })),
      },
    ],
    job: { kind: "listen", status: "running" },
  };
  const { act } = await import("@testing-library/react");
  await act(async () => progress({ data: JSON.stringify(next) }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(4));
  expect(screen.getByText("Listening now")).toBeTruthy();
});

it("persists bookmarks and reader text size per browser", async () => {
  server();
  render(<ApiApp />);
  await screen.findByRole("heading", { name: "The Quiet Harbour" });
  await userEvent.click(
    screen.getByRole("button", { name: "Bookmark sentence 1" }),
  );
  expect(
    JSON.parse(localStorage.getItem("pagevoice-bookmarks-" + project.id)),
  ).toEqual(["0000-00000"]);
  fireEvent.change(screen.getByLabelText("Text size"), {
    target: { value: "25" },
  });
  expect(localStorage.getItem("pagevoice-text-size")).toBe("25");
  await userEvent.click(
    screen.getByRole("button", { name: "Keyboard shortcuts" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
  ).toBeTruthy();
});
