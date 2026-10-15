import { useEffect, useRef, useState } from "react";
import { LibraryStore, rowsOf } from "./library";
import { AssetManager } from "./assets";
import { listVoices, synthesize, durationOf } from "./engines";
import { RenderQueue, signatureFor, effectiveVoice } from "./render";
import { AudioPlayer } from "./player";
import { detectCharacters } from "./knowledge";
import { buildSearchIndex } from "../browser/search";
import { analyzeSections } from "../browser/analysis";
import { downloadBlob } from "./format";
import { voicesFor } from "./voices";

export function useReader() {
  const [books, setBooks] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [errorFile, setErrorFile] = useState(null),
    [progress, setProgress] = useState(null),
    [preparation, setPreparation] = useState({ status: "idle" }),
    [playback, setPlayback] = useState({ status: "idle" }),
    [voices, setVoices] = useState([]),
    [voicesError, setVoicesError] = useState(null);
  const refs = useRef({}),
    lastFile = useRef(null),
    previewURL = useRef(null);
  const sync = () => setBooks(refs.current.store.list());
  // Errors not tied to an imported file clear the file name shown with them.
  const showError = (value) => {
    setError(value);
    setErrorFile(null);
  };
  useEffect(() => {
    const store = new LibraryStore({
        onChange: (id, book) => {
          if (!active) return;
          if (!book || book.deletedAt) {
            refs.current.queue?.stop(id);
            if (refs.current.player?.bookId === id) stopPlayback();
          }
          sync();
        },
      }),
      assets = new AssetManager();
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
    const queue = new RenderQueue({
      store,
      onChange: (state) => {
        if (!active) return;
        setPreparation(state);
        sync();
        player.notifyReady().catch((e) => showError(e.message));
      },
    });
    refs.current = { store, assets, player, queue };
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
          showError(e.message);
          setLoading(false);
        }
      });
    const unload = ({ persisted }) => {
      player.pause();
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
      refs.current.analysisWorker?.terminate();
      refs.current.queryWorker?.terminate();
      refs.current.exportWorker?.terminate();
      refs.current.previewAudio?.pause();
      store.dispose();
      URL.revokeObjectURL(previewURL.current);
      window.removeEventListener("pagehide", unload);
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
    showError(null);
    let cancelled = false;
    const added = [],
      failed = [];
    refs.current.cancelParse = () => {
      cancelled = true;
      refs.current.parser?.terminate();
      refs.current.rejectParse?.(Error("cancelled"));
    };
    try {
      for (const [index, file] of files.entries()) {
        if (cancelled) break;
        setProgress({
          stage: "reading",
          current: 0,
          total: 1,
          name: file.name,
          large: file.size > 50 * 1024 * 1024,
          queue:
            files.length > 1 ? { index: index + 1, total: files.length } : null,
        });
        // One unreadable file must not stop the rest of a multi-file import.
        try {
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
                  reject(Error(data.code || "processingError"));
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
          added.push(await refs.current.store.add(book, keep));
          sync();
        } catch (e) {
          if (e.message === "cancelled") break;
          if (e.name === "QuotaExceededError") {
            // A full disk affects every remaining file as well.
            failed.push({ file, code: "quotaExceeded" });
            break;
          }
          failed.push({ file, code: e.message });
        }
      }
    } finally {
      setProgress(null);
      refs.current.parser = null;
      refs.current.cancelParse = null;
    }
    lastFile.current = failed.length
      ? { files: failed.map((f) => f.file), keep }
      : null;
    if (failed.length) {
      setError(failed[0].code);
      setErrorFile(failed.map((f) => f.file.name).join(", "));
    }
    return added;
  }
  async function update(id, patch) {
    await refs.current.store.update(id, patch);
    sync();
  }
  async function settings(id, patch) {
    const book = refs.current.store.get(id);
    refs.current.queue.pause();
    const next = { ...book.settings, ...patch };
    if (["voice", "cast"].some((k) => k in patch)) {
      stopPlayback();
      await update(id, { settings: next });
      // Only the sentences whose voice changed lose their audio.
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
      settings: { ...book.settings, cast: {}, voice: "" },
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
  }
  // Voices are requested when a book is opened or narration starts, not at
  // startup. Every caller shares one request.
  function ensureVoices() {
    refs.current.voicesRequest ||= listVoices()
      .then((list) => {
        setVoices(list);
        setVoicesError(null);
        return list;
      })
      .catch((e) => {
        refs.current.voicesRequest = null;
        refs.current.voicesFailure = e.message;
        setVoicesError(e.message);
        return [];
      });
    return refs.current.voicesRequest;
  }
  // The narration voice is the one chosen for the book, or the first voice
  // the service offers.
  // The saved voice when it speaks the book's language, otherwise the first
  // voice for that language. Empty when the list has none for the language.
  const narrationVoice = (book, list) => {
    const pool = voicesFor(list, book.language);
    if (!pool.length) return list.length ? "" : book.settings.voice || "";
    return pool.some((v) => v.id === book.settings.voice)
      ? book.settings.voice
      : pool[0].id;
  };
  async function listen(id, chapter, sentence) {
    showError(null);
    const book = refs.current.store.get(id),
      list = await ensureVoices(),
      voice = narrationVoice(book, list);
    if (!voice) {
      showError(
        refs.current.voicesFailure ||
          (list.length ? "noVoicesForLanguage" : "ttsUnavailable"),
      );
      return;
    }
    if (voice !== book.settings.voice)
      await update(id, { settings: { ...book.settings, voice } });
    await refs.current.player.start(id, chapter, sentence);
    refs.current.queue
      .prepare(id, chapter, sentence)
      .catch((e) => showError(e.message));
  }
  function togglePlayback(book) {
    if (playback.bookId === book.id && playback.status === "playing")
      refs.current.player.pause();
    else if (
      playback.bookId === book.id &&
      ["paused", "gesture"].includes(playback.status)
    )
      refs.current.player.resume();
    else listen(book.id, book.position.chapter, book.position.sentence);
  }
  async function preview(book) {
    showError(null);
    stopPlayback();
    const text =
      book.language === "es"
        ? "Una habitación tranquila, un libro abierto y una voz que te acompaña."
        : "A quiet room, an open book, and a voice that keeps you company.";
    const voice = narrationVoice(book, await ensureVoices());
    if (!voice) throw Error("voiceUnknown");
    const blob = await synthesize(text, voice);
    refs.current.previewAudio?.pause();
    URL.revokeObjectURL(previewURL.current);
    previewURL.current = URL.createObjectURL(blob);
    const audio = new Audio(previewURL.current);
    refs.current.previewAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(previewURL.current);
      previewURL.current = null;
    };
    await audio.play();
  }
  async function remove(id) {
    refs.current.queue.stop(id);
    if (playback.bookId === id) stopPlayback();
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
          .catch((e) => showError(e.message)),
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
    const blob = await synthesize(row.text, effectiveVoice(book, row));
    const duration = await durationOf(blob);
    const latest = refs.current.store.get(id),
      latestRow = latest && rowsOf(latest).find((r) => r.id === row.id);
    if (
      !latest ||
      latest.deletedAt ||
      !latestRow ||
      (await signatureFor(latest, latestRow)) !== signature
    )
      throw Error("sentenceChanged");
    await refs.current.store.putAudio(id, row.id, signature, blob, {
      duration,
      rtf: 0,
    });
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
        audio.push({ blob, duration: a.duration || 0 });
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
    errorFile,
    setError: showError,
    progress,
    preparation,
    playback,
    voices,
    voicesError,
    refs,
    ensureVoices,
    sync,
    upload,
    cancelUpload: () => refs.current.cancelParse?.(),
    retryUpload: () =>
      lastFile.current && upload(lastFile.current.files, lastFile.current.keep),
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
