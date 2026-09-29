import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteBook, UndoDeletion } from "./DeleteBook";
import { Modal } from "./ApiApp";
import { messages } from "./i18n";
const project = { id: "a".repeat(32), title: "Harbour" };
it("requires typed confirmation for audio and displays shared-source storage details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => ({
      ok: true,
      json: async () =>
        options?.method === "DELETE"
          ? { ...project, expires: Date.now() / 1000 + 8 }
          : { bytes: 1234, has_audio: true, source_shared: true },
    })),
  );
  const deleted = vi.fn(),
    stop = vi.fn();
  render(
    <DeleteBook
      project={project}
      Modal={Modal}
      t={messages.en}
      onClose={() => {}}
      onDeleted={deleted}
      onStopping={stop}
    />,
  );
  await screen.findByText(messages.en.deleteSharedSource);
  expect(screen.getByRole("button", { name: "Remove book" }).disabled).toBe(
    true,
  );
  await userEvent.type(screen.getByLabelText(messages.en.typeDelete), "DELETE");
  await userEvent.click(screen.getByRole("button", { name: "Remove book" }));
  await waitFor(() => expect(deleted).toHaveBeenCalled());
  expect(stop).toHaveBeenCalledWith(project.id);
  expect(fetch.mock.calls.at(-1)[1].method).toBe("DELETE");
});
it("restores through the server, not just a visual toast", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => project })),
  );
  const restored = vi.fn();
  render(
    <UndoDeletion
      receipt={{ ...project, expires: Date.now() / 1000 + 8 }}
      t={messages.es}
      onRestore={restored}
      onExpire={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Deshacer/ }));
  await waitFor(() => expect(restored).toHaveBeenCalledWith(project));
  expect(fetch.mock.calls[0][0]).toBe(`/api/trash/${project.id}/restore`);
});
