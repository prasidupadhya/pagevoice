// Emscripten engines (Piper, ONNX Runtime, FFmpeg) abort with "Aborted(...)"
// when their WebAssembly instance fails, for example when memory cannot grow.
// After an abort the instance is unusable and must be discarded.
export const isWasmAbort = (error) =>
  /aborted|out of memory|OOM/iu.test(error?.message || "");
