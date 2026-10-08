import JSZip from "jszip";
import { decodeWav } from "./audio";
import { isWasmAbort } from "./wasm";
self.onmessage = async ({ data: { book, chapters, format } }) => {
  try {
    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const files = [];
    for (const [index, chapter] of chapters.entries()) {
      const first = await decodeWav(chapter.audio[0]);
      const encoder = new Mp3Encoder(1, first.rate, 128),
        parts = [];
      let duration = 0;
      for (const blob of chapter.audio) {
        const { pcm, rate, duration: d } = await decodeWav(blob);
        if (rate !== first.rate) throw Error("mixedSampleRates");
        duration += d;
        for (let p = 0; p < pcm.length; p += 1152) {
          const output = encoder.encodeBuffer(pcm.subarray(p, p + 1152));
          if (output.length) parts.push(new Uint8Array(output));
        }
      }
      const tail = encoder.flush();
      if (tail.length) parts.push(new Uint8Array(tail));
      files.push({
        name: `${String(index + 1).padStart(3, "0")} - ${chapter.title.replace(/[<>:"/\\|?*]/gu, "").slice(0, 100)}.mp3`,
        blob: new Blob(parts, { type: "audio/mpeg" }),
        duration,
        title: chapter.title,
        source: chapter.source,
      });
      self.postMessage({
        type: "progress",
        current: index + 1,
        total: chapters.length,
      });
    }
    const metadata = {
      title: book.title,
      author: book.author,
      language: book.language,
      generatedSpeech: true,
      engine: book.settings.engine,
      voice: book.settings.voice,
      pace: book.settings.pace,
      chapters: files.map(({ name, title, source, duration }) => ({
        name,
        title,
        source,
        duration,
      })),
      citations: book.chapters.map((c, ch) => ({
        title: c.title,
        source: c.source,
        sentences: c.sentences.map((text, s) => ({
          citation: `${String(ch + 1).padStart(4, "0")}-${String(s + 1).padStart(5, "0")}`,
          text,
        })),
      })),
    };
    if (format === "m4b") {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: new URL("/runtime/ffmpeg/ffmpeg-core.js", self.location.origin)
          .href,
        wasmURL: new URL(
          "/runtime/ffmpeg/ffmpeg-core.wasm",
          self.location.origin,
        ).href,
      });
      let time = 0,
        meta = `;FFMETADATA1\ntitle=${book.title.replace(/[\n\r=;#\\]/gu, " ")}\nartist=${book.author.replace(/[\n\r=;#\\]/gu, " ")}\ncomment=Generated speech; ${book.settings.engine}\n`;
      for (const [i, f] of files.entries()) {
        await ffmpeg.writeFile(
          `${i}.mp3`,
          new Uint8Array(await f.blob.arrayBuffer()),
        );
        const end = time + Math.round(f.duration * 1000);
        meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${time}\nEND=${end}\ntitle=${f.title.replace(/[\n\r=;#\\]/gu, " ")}\n`;
        time = end;
      }
      await ffmpeg.writeFile(
        "list.txt",
        new TextEncoder().encode(
          files.map((f, i) => `file '${i}.mp3'`).join("\n"),
        ),
      );
      await ffmpeg.writeFile("meta.txt", new TextEncoder().encode(meta));
      const exit = await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "list.txt",
        "-i",
        "meta.txt",
        "-map_metadata",
        "1",
        "-map_chapters",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        "book.m4b",
      ]);
      if (exit !== 0) throw Error("m4bFailed");
      const output = await ffmpeg.readFile("book.m4b");
      ffmpeg.terminate();
      self.postMessage({
        type: "complete",
        blob: new Blob([output], { type: "audio/mp4" }),
        extension: "m4b",
      });
      return;
    }
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, await f.blob.arrayBuffer());
    zip.file("metadata-and-citations.json", JSON.stringify(metadata, null, 2));
    self.postMessage({
      type: "complete",
      blob: await zip.generateAsync({ type: "blob", compression: "STORE" }),
      extension: "zip",
    });
  } catch (error) {
    const aborted = isWasmAbort(error);
    self.postMessage({
      type: "error",
      message: aborted
        ? format === "m4b"
          ? "m4bFailed"
          : "engineFailed"
        : error.message,
    });
  }
};
