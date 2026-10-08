import { expect, it } from "vitest";
import { isWasmAbort } from "./wasm";

it("recognises Emscripten aborts and out-of-memory failures", () => {
  expect(isWasmAbort(Error("Aborted()"))).toBe(true);
  expect(isWasmAbort(Error("Aborted(OOM)"))).toBe(true);
  expect(isWasmAbort(Error("out of memory"))).toBe(true);
});

it("leaves ordinary engine errors alone", () => {
  expect(isWasmAbort(Error("silentAudio"))).toBe(false);
  expect(isWasmAbort(Error("tokenLimit"))).toBe(false);
  expect(isWasmAbort(undefined)).toBe(false);
});
