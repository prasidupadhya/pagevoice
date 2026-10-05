export async function createOCR(progress = () => {}) {
  const { createWorker, OEM } = await import("tesseract.js");
  const worker = await createWorker("eng+spa", OEM.LSTM_ONLY, {
    workerPath: new URL("/runtime/ocr/worker.min.js", self.location.origin)
      .href,
    corePath: new URL("/runtime/ocr", self.location.origin).href,
    langPath: new URL("/language-data", self.location.origin).href,
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true,
    logger: (event) =>
      progress({
        stage: "ocr",
        fraction: event.progress || 0,
        status: event.status,
      }),
  });
  return {
    async read(page) {
      const viewport = page.getViewport({
        scale: Math.min(2, 4096 / Math.max(page.view[2], page.view[3])),
      });
      const canvas = new OffscreenCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      const image = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      const { data } = await worker.recognize(
        image,
        {},
        { text: true, blocks: true },
      );
      const lines = (data.blocks || [])
        .flatMap((b) => b.paragraphs || [])
        .flatMap((p) => p.lines || []);
      if (lines.length)
        return lines
          .map((l) => ({
            text: l.text.trim(),
            height: l.bbox.y1 - l.bbox.y0,
            y: viewport.height - l.bbox.y0,
          }))
          .filter((l) => l.text);
      return data.text
        .split("\n")
        .map((text, i) => ({
          text: text.trim(),
          height: 12,
          y: viewport.height - i * 16,
        }))
        .filter((l) => l.text);
    },
    dispose: () => worker.terminate(),
  };
}
