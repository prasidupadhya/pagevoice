import { useEffect, useRef, useState } from "react";
import { LibraryStore, rowsOf } from "./library";
import { AssetManager } from "./assets";
import { LocalEngine, modelFor } from "./engines";
import { RenderQueue, signatureFor } from "./render";
import { AudioPlayer } from "./player";
import { SpeechController } from "../browser/SpeechController";
import { detectCharacters } from "./knowledge";
import { buildSearchIndex } from "../browser/search";
import { analyzeSections } from "../browser/analysis";
import { encodeWav } from "./audio";
import { downloadBlob } from "./format";

export function useReader() {
  const [books, setBooks] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [progress, setProgress] = useState(null),
    [preparation, setPreparation] = useState({ status: "idle" }),
    [playback, setPlayback] = useState({ status: "idle" }),
    [deviceVoices, setDeviceVoices] = useState([]);
  const refs = useRef({}),
    lastFile = useRef(null),
    previewURL = useRef(null);
  const sync = () => setBooks(refs.current.store.list());
  useEffect(() => {
    const store = new LibraryStore({
        onChange: (id, book) => {
          if (!active) return;
          if (!book || book.deletedAt) {
            refs.current.queue?.stop(id);
            if (
              refs.current.player?.bookId === id ||
              refs.current.speechBook === id
            )
              stopPlayback();
          }
          sync();
        },
      }),
      assets = new AssetManager(),
      engine = new LocalEngine();
    let active = true;
    const player = new AudioPlayer({
      store,
      onState: (state) => {
        if (active) {
          setPlayback(state);
          sync();
        }
      },
    });
    const speech = new SpeechController({
      onState: (state) => {
        if (!active) return;
        setPlayback({ ...state, bookId: refs.current.speechBook });
        if (state.row && refs.current.speechBook)
          store
            .update(refs.current.speechBook, {
              position: { chapter: state.chapter, sentence: state.sentence },
            })
            .then(sync)
            .catch((e) => setError(e.message));
      },
    });
    const queue = new RenderQueue({
      store,
      assets,
      engine,
      onChange: (state) => {
        if (!active) return;
        setPreparation(state);
        sync();
        player.notifyReady().catch((e) => setError(e.message));
      },
    });
    refs.current = { store, assets, engine, player, speech, queue };
    store
      .init()
      .then(() => {
        if (active) {
          sync();
          setLoading(false);
        } else store.dispose();
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    const voices = () =>
      setDeviceVoices(globalThis.speechSynthesis?.getVoices() || []);
    voices();
    globalThis.speechSynthesis?.addEventListener("voiceschanged", voices);
    const unload = ({ persisted }) => {
      player.pause();
      speech.stop();
      refs.current.previewAudio?.pause();
      if (!persisted) {
        store.dispose();
        queue.dispose();
        refs.current.queryWorker?.terminate();
        refs.current.exportWorker?.terminate();
        URL.revokeObjectURL(previewURL.current);
      }
    };
    window.addEventListener("pagehide", unload);
    return () => {
      active = false;
      refs.current.parser?.terminate();
      queue.dispose();
      player.dispose();
      speech.stop();
      refs.current.analysisWorker?.terminate();
      refs.current.queryWorker?.terminate();
      refs.current.exportWorker?.terminate();
      refs.current.previewAudio?.pause();
      store.dispose();
      URL.revokeObjectURL(previewURL.current);
      window.removeEventListener("pagehide", unload);
      globalThis.speechSynthesis?.removeEventListener("voiceschanged", voices);
    };
  }, []);
  useEffect(() => {
    const warn = (e) => {
      if (books.some((b) => !b.keep)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [books]);
  async function upload(files, keep) {
    setError(null);
    let cancelled = false;
    refs.current.cancelParse = () => {
      cancelled = true;
      refs.current.parser?.terminate();
      refs.current.rejectParse?.(Error("cancelled"));
    };
    try {
      for (const file of files) {
        if (cancelled) break;
        lastFile.current = { file, keep };
        setProgress({
          stage: "reading",
          current: 0,
          total: 1,
          name: file.name,
          large: file.size > 50 * 1024 * 1024,
        });
        const ocr = (await refs.current.assets.status("ocr")).ready;
        const parsed = await new Promise((resolve, reject) => {
          const worker = new Worker(
            new URL("../browser/reader.worker.js", import.meta.url),
            { type: "module" },
          );
          refs.current.parser = worker;
          refs.current.rejectParse = reject;
          worker.onmessage = ({ data }) => {
            if (data.type === "progress")
              setProgress((p) => ({ ...p, ...data.value }));
            else if (["complete", "error"].includes(data.type)) {
              worker.terminate();
              if (data.type === "complete") resolve(data.book);
              else {
                if (data.message)
                  console.warn("Book processing failed:", data.message);
                reject(Error(data.code || data.message || "processingError"));
              }
            }
          };
          worker.onerror = () => {
            worker.terminate();
            reject(Error("processingError"));
          };
          worker.postMessage({ file, language: "auto", options: { ocr } });
        });
        if (cancelled) break;
        const book = {
          ...parsed,
          coverBlob: parsed.cover,
          sourceFile: file,
          filename: file.name,
          characters: detectCharacters(parsed),
        };
        delete book.cover;
        await refs.current.store.add(book, keep);
        sync();
        lastFile.current = null;
      }
    } catch (e) {
      if (e.message !== "cancelled")
        setError(e.name === "QuotaExceededError" ? "quotaExceeded" : e.message);
    } finally {
      setProgress(null);
      refs.current.parser = null;
      refs.current.cancelParse = null;
    }
  }
  async function update(id, patch) {
    await refs.current.store.update(id, patch);
    sync();
  }
  async function settings(id, patch) {
    const book = refs.current.store.get(id);
    refs.current.queue.pause();
    const next = { ...book.settings, ...patch };
    if (["engine", "voice", "pace", "cast", "device"].some((k) => k in patch)) {
      stopPlayback();
      await update(id, { settings: next });
      for (const [row, a] of Object.entries(book.prepared)) {
        const current = rowsOf(refs.current.store.get(id)).find(
          (r) => r.id === row,
        );
        if (
          !current ||
          (await signatureFor(refs.current.store.get(id), current)) !==
            a.signature
        ) {
          await refs.current.store.deleteAudio(a.key);
          await update(id, (b) => {
            if (b.prepared[row]?.key !== a.key) return {};
            const prepared = { ...b.prepared };
            delete prepared[row];
            return { prepared };
          });
        }
      }
    } else await update(id, { settings: next });
  }
  async function changeLanguage(id, language) {
    if (!["en", "es"].includes(language)) throw Error("unsupportedLanguage");
    refs.current.queue.stop(id);
    stopPlayback();
    const book = refs.current.store.get(id);
    for (const a of Object.values(book.prepared))
      await refs.current.store.deleteAudio(a.key);
    const next = {
      ...book,
      language,
      prepared: {},
      semantics: null,
      entities: null,
      settings: {
        ...book.settings,
        engine: language === "es" ? "piper" : "kokoro",
        voice: language === "es" ? "davefx" : "af_heart",
        cast: {},
        device: "wasm",
      },
      languageDetection: {
        ...book.languageDetection,
        source: "manual",
        review: false,
      },
    };
    next.searchIndex = buildSearchIndex(next);
    next.analysis = analyzeSections(next);
    await update(id, next);
  }
  function stopPlayback() {
    refs.current.player.stop();
    refs.current.speech.stop();
    refs.current.speechBook = null;
  }
  async function listen(id, chapter, sentence) {
    setError(null);
    const book = refs.current.store.get(id);
    if (book.settings.engine === "device") {
      refs.current.player.stop();
      refs.current.speechBook = id;
      const voice =
        deviceVoices.find((v) => v.voiceURI === book.settings.voice) ||
        deviceVoices.find((v) => v.lang.split(/[-_]/u)[0] === book.language);
      if (!voice) {
        setError(
          globalThis.speechSynthesis ? "deviceNoVoices" : "unsupportedSpeech",
        );
        return;
      }
      refs.current.speech.play(
        book,
        chapter,
        sentence,
        voice,
        book.settings.pace,
      );
      return;
    }
    refs.current.speech.stop();
    refs.current.speechBook = null;
    const ready = (
      await refs.current.assets.status(
        modelFor(
          book.settings.engine,
          book.settings.voice,
          book.settings.device,
        ),
      )
    ).ready;
    if (!ready) {
      setError("modelNotCached");
      return;
    }
    await refs.current.player.start(id, chapter, sentence);
    refs.current.queue
      .prepare(id, chapter, sentence)
      .catch((e) => setError(e.message));
  }
  function togglePlayback(book) {
    if (book.settings.engine === "device") {
      if (playback.status === "playing") refs.current.speech.pause();
      else if (playback.status === "paused") refs.current.speech.resume();
      else listen(book.id, book.position.chapter, book.position.sentence);
    } else if (playback.bookId === book.id && playback.status === "playing")
      refs.current.player.pause();
    else if (
      playback.bookId === book.id &&
      ["paused", "gesture"].includes(playback.status)
    )
      refs.current.player.resume();
    else listen(book.id, book.position.chapter, book.position.sentence);
  }
  async function preview(book) {
    setError(null);
    stopPlayback();
    const text =
      book.language === "es"
        ? "Una habitación tranquila, un libro abierto y una voz que te acompaña."
        : "A quiet room, an open book, and a voice that keeps you company.";
    if (book.settings.engine === "device") {
      refs.current.speech.preview(
        text,
        deviceVoices.find((v) => v.voiceURI === book.settings.voice),
        book.language,
        book.settings.pace,
      );
      return;
    }
    if (
      !(
        await refs.current.assets.status(
          modelFor(
            book.settings.engine,
            book.settings.voice,
            book.settings.device,
          ),
        )
      ).ready
    )
      throw Error("modelNotCached");
    const output = await refs.current.engine.synthesize({
      engine: book.settings.engine,
      language: book.language,
      voice: book.settings.voice,
      text,
      pace: book.settings.pace,
      device: book.settings.device || "wasm",
    });
    refs.current.previewAudio?.pause();
    URL.revokeObjectURL(previewURL.current);
    previewURL.current = URL.createObjectURL(
      encodeWav(output.samples, output.sampleRate),
    );
    const audio = new Audio(previewURL.current);
    refs.current.previewAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(previewURL.current);
      previewURL.current = null;
    };
    await audio.play();
    return output;
  }
  async function remove(id) {
    refs.current.queue.stop(id);
    if (playback.bookId === id || refs.current.speechBook === id)
      stopPlayback();
    refs.current.previewAudio?.pause();
    if (refs.current.analysisBook === id) {
      refs.current.analysisWorker?.terminate();
      refs.current.analysisWorker = null;
    }
    await refs.current.store.softDelete(id);
    sync();
    setTimeout(
      () =>
        refs.current.store.get(id)?.deletedAt &&
        Date.now() - refs.current.store.get(id).deletedAt >= 8000 &&
        refs.current.store
          .purge(id)
          .then(sync)
          .catch((e) => setError(e.message)),
      8000,
    );
  }
  async function undo(id) {
    await refs.current.store.restore(id);
    sync();
  }
  async function edit(id, chapter, sentence, text, speaker) {
    refs.current.queue.pause();
    stopPlayback();
    const book = refs.current.store.get(id),
      lines = text
        .split(/\n+/u)
        .map((t) => t.trim())
        .filter(Boolean);
    if (!lines.length) throw Error("noReadableText");
    const chapters = book.chapters.map((c, i) =>
      i === chapter
        ? {
            ...c,
            sentences: [
              ...c.sentences.slice(0, sentence),
              ...lines,
              ...c.sentences.slice(sentence + 1),
            ],
          }
        : c,
    );
    const prepared = { ...book.prepared };
    for (const [key, a] of Object.entries(prepared)) {
      const [ch, s] = key.split(":").map(Number);
      if (
        ch === chapter &&
        (s === sentence || (lines.length !== 1 && s >= sentence))
      ) {
        await refs.current.store.deleteAudio(a.key);
        delete prepared[key];
      }
    }
    const characters = detectCharacters({ ...book, chapters });
    const remap = (key) => {
      const [ch, s] = key.split(":").map(Number);
      if (ch !== chapter || s < sentence) return key;
      if (s === sentence) return `${ch}:${s}`;
      return `${ch}:${s + lines.length - 1}`;
    };
    const manualSpeakers = Object.fromEntries(
      Object.entries(book.manualSpeakers || {}).map(([key, name]) => [
        remap(key),
        name,
      ]),
    );
    if (speaker) manualSpeakers[`${chapter}:${sentence}`] = speaker;
    else delete manualSpeakers[`${chapter}:${sentence}`];
    Object.assign(characters.speakers, manualSpeakers);
    await update(id, {
      chapters,
      prepared,
      characters,
      manualSpeakers,
      bookmarks: (book.bookmarks || []).map(remap),
      position: {
        ...book.position,
        sentence:
          book.position.chapter === chapter && book.position.sentence > sentence
            ? book.position.sentence + lines.length - 1
            : book.position.sentence,
      },
      semantics: null,
      entities: null,
      searchIndex: buildSearchIndex({ ...book, chapters }),
      analysis: analyzeSections({ ...book, chapters }),
    });
  }
  async function regenerate(id, chapter, sentence) {
    refs.current.queue.pause();
    if (refs.current.queue.running) await refs.current.queue.running;
    const book = refs.current.store.get(id),
      row = rowsOf(book).find(
        (r) => r.chapter === chapter && r.sentence === sentence,
      );
    const signature = await signatureFor(book, row);
    const result = await refs.current.engine.synthesize({
      engine: book.settings.engine,
      language: book.language,
      voice:
        book.settings.cast?.[book.characters?.speakers[row.id]] ||
        book.settings.voice,
      cast: book.settings.cast,
      pace: book.settings.pace,
      device: book.settings.device || "wasm",
      text: row.text,
    });
    const latest = refs.current.store.get(id),
      latestRow = latest && rowsOf(latest).find((r) => r.id === row.id);
    if (
      !latest ||
      latest.deletedAt ||
      !latestRow ||
      (await signatureFor(latest, latestRow)) !== signature
    )
      throw Error("sentenceChanged");
    await refs.current.store.putAudio(
      id,
      row.id,
      signature,
      encodeWav(result.samples, result.sampleRate),
      { duration: result.duration, rtf: result.rtf },
    );
    sync();
  }
  async function analyze(id, kind, onProgress = () => {}) {
    if (!(await refs.current.assets.status(kind)).ready)
      throw Error("modelNotCached");
    if (refs.current.analysisWorker) throw Error("analysisBusy");
    const book = refs.current.store.get(id),
      version = JSON.stringify(book.chapters.map((c) => c.sentences));
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./knowledge.worker.js", import.meta.url),
        { type: "module" },
      );
      refs.current.analysisWorker = worker;
      refs.current.analysisBook = id;
      worker.onmessage = ({ data }) => {
        if (data.progress) onProgress(data.progress);
        else {
          worker.terminate();
          refs.current.analysisWorker = null;
          if (data.error) reject(Error(data.error));
          else resolve(data.result);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        refs.current.analysisWorker = null;
        reject(Error("engineFailed"));
      };
      worker.postMessage({ id: 1, kind, book });
      refs.current.cancelAnalysis = () => {
        worker.terminate();
        refs.current.analysisWorker = null;
        reject(Error("cancelled"));
      };
    });
    const latest = refs.current.store.get(id);
    if (
      !latest ||
      latest.deletedAt ||
      JSON.stringify(latest.chapters.map((c) => c.sentences)) !== version
    )
      throw Error("analysisChanged");
    if (kind === "embeddings") await update(id, { semantics: result });
    else {
      const characters = detectCharacters(latest, result);
      Object.assign(characters.speakers, latest.manualSpeakers || {});
      await update(id, { entities: result, characters });
    }
  }
  async function semanticQuery(query) {
    refs.current.queryPending ||= new Map();
    refs.current.querySequence ||= 0;
    if (!refs.current.queryWorker) {
      const worker = new Worker(
        new URL("./knowledge.worker.js", import.meta.url),
        { type: "module" },
      );
      refs.current.queryWorker = worker;
      worker.onmessage = ({ data }) => {
        const pending = refs.current.queryPending.get(data.id);
        if (!pending) return;
        refs.current.queryPending.delete(data.id);
        if (data.error) pending.reject(Error(data.error));
        else pending.resolve(data.result);
      };
      worker.onerror = () => {
        for (const p of refs.current.queryPending.values())
          p.reject(Error("engineFailed"));
        refs.current.queryPending.clear();
        worker.terminate();
        refs.current.queryWorker = null;
      };
    }
    return new Promise((resolve, reject) => {
      const id = ++refs.current.querySequence;
      refs.current.queryPending.set(id, { resolve, reject });
      refs.current.queryWorker.postMessage({ id, kind: "embeddings", query });
    });
  }
  async function exportAudio(book, scope, format, onProgress = () => {}) {
    const selected =
        scope === "all" ? book.chapters : [book.chapters[Number(scope)]],
      chapters = [];
    let size = 0;
    for (const c of selected) {
      const index = book.chapters.indexOf(c),
        audio = [];
      for (let s = 0; s < c.sentences.length; s++) {
        const a = book.prepared[`${index}:${s}`],
          blob = a && (await refs.current.store.getAudio(a.key));
        if (!blob) throw Error("exportIncomplete");
        size += blob.size;
        audio.push(blob);
      }
      chapters.push({ ...c, audio });
    }
    if (size > 256 * 1024 * 1024) throw Error("exportLimit");
    if (format === "m4b" && !(await refs.current.assets.status("ffmpeg")).ready)
      throw Error("modelNotCached");
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL("./export.worker.js", import.meta.url),
        { type: "module" },
      );
      refs.current.exportWorker = worker;
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress(data);
        else {
          worker.terminate();
          refs.current.exportWorker = null;
          if (data.type === "error") reject(Error(data.message));
          else resolve(data);
        }
      };
      worker.onerror = () => {
        worker.terminate();
        reject(Error("exportFailed"));
      };
      worker.postMessage({ book, chapters, format });
      refs.current.cancelExport = () => {
        worker.terminate();
        refs.current.exportWorker = null;
        reject(Error("cancelled"));
      };
    });
    downloadBlob(
      result.blob,
      `${book.title.replace(/[<>:"/\\|?*]/gu, "")}.${result.extension}`,
    );
  }
  return {
    books,
    loading,
    error,
    setError,
    progress,
    preparation,
    playback,
    deviceVoices,
    refs,
    sync,
    upload,
    cancelUpload: () => refs.current.cancelParse?.(),
    retryUpload: () =>
      lastFile.current &&
      upload([lastFile.current.file], lastFile.current.keep),
    update,
    settings,
    changeLanguage,
    listen,
    togglePlayback,
    preview,
    remove,
    undo,
    edit,
    regenerate,
    analyze,
    semanticQuery,
    exportAudio,
    stopPlayback,
  };
}
