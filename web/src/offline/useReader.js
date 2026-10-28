import { useEffect, useRef, useState } from "react";
import { LibraryStore, rowAt, rowById } from "./library";
import { AssetManager } from "./assets";
import { LocalEngine, VOICES, defaultVoice, modelFor } from "./engines";
import {
  RenderQueue,
  signatureFor,
  renderRow,
  modelsFor,
  loadVoiceFiles,
} from "./render";
import { encodeWav } from "./audio";
import { AudioPlayer } from "./player";
import { detectCharacters } from "./knowledge";
import { analyzeSections } from "../browser/analysis";
import { voicesFor } from "./voices";

export function useReader() {
  const [books, setBooks] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null),
    [errorFile, setErrorFile] = useState(null),
    [progress, setProgress] = useState(null),
    [preparation, setPreparation] = useState({ status: "idle" }),
    [playback, setPlayback] = useState({ status: "idle" });
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
      assets = new AssetManager(),
      engine = new LocalEngine();
    let active = true;
    const player = new AudioPlayer({
      store,
      onState: (state, timeOnly) => {
        if (!active) return;
        setPlayback(state);
        // Time updates arrive several times a second and change no book.
        if (!timeOnly) sync();
      },
    });
    const queue = new RenderQueue({
      store,
      engine,
      assets,
      onChange: (state) => {
        if (!active) return;
        setPreparation(state);
        sync();
        player.notifyReady().catch((e) => showError(e.message));
      },
    });
    refs.current = { store, assets, engine, player, queue };
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
        URL.revokeObjectURL(previewURL.current);
      }
    };
    window.addEventListener("pagehide", unload);
    return () => {
      active = false;
      refs.current.parser?.terminate();
      queue.dispose();
      player.dispose();
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
  // Reads one file in a worker. Rejects with the reader's error code.
  function parse(file, ocr) {
    return new Promise((resolve, reject) => {
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
  }
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
          let parsed;
          try {
            parsed = await parse(
              file,
              (await refs.current.assets.status("ocr")).ready,
            );
          } catch (e) {
            if (e.message !== "ocrRequired" || cancelled) throw e;
            // Scanned pages need text recognition. Its files are fetched
            // once, the first time a scanned PDF is imported.
            setProgress((p) => ({ ...p, stage: "ocrLoading", fraction: 0 }));
            try {
              await refs.current.assets.ensure("ocr", ({ loaded, total }) =>
                setProgress((p) => ({
                  ...p,
                  current: 0,
                  total: 1,
                  fraction: loaded / Math.max(1, total),
                })),
              );
            } catch (error) {
              if (error.name === "QuotaExceededError") throw error;
              throw Error("ocrLoadFailed", { cause: error });
            }
            if (cancelled) break;
            setProgress((p) => ({ ...p, stage: "reading", fraction: 0 }));
            parsed = await parse(file, true);
          }
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
  async function load(id) {
    await refs.current.store.load(id);
    sync();
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
      // Only the sentences whose voice changed lose their audio: find them
      // all first, then remove them in one write.
      const latest = refs.current.store.get(id),
        stale = [];
      for (const [row, a] of Object.entries(book.prepared)) {
        const current = rowById(latest, row);
        if (!current || (await signatureFor(latest, current)) !== a.signature)
          stale.push([row, a.key]);
      }
      if (!stale.length) return;
      await refs.current.store.deleteAudios(stale.map(([, key]) => key));
      await update(id, (b) => {
        const prepared = { ...b.prepared };
        for (const [row, key] of stale)
          if (prepared[row]?.key === key) delete prepared[row];
        return { prepared };
      });
    } else await update(id, { settings: next });
  }
  async function changeLanguage(id, language) {
    if (!["en", "es"].includes(language)) throw Error("unsupportedLanguage");
    refs.current.queue.stop(id);
    stopPlayback();
    const book = refs.current.store.get(id);
    await refs.current.store.deleteAudios(
      Object.values(book.prepared).map((a) => a.key),
    );
    // Only the fields that change are written; the text and the source file
    // stay as they are.
    const patch = {
      language,
      prepared: {},
      settings: { ...book.settings, cast: {}, voice: defaultVoice(language) },
      languageDetection: {
        ...book.languageDetection,
        source: "manual",
        review: false,
      },
    };
    patch.analysis = analyzeSections({ ...book, ...patch });
    await update(id, patch);
  }
  function stopPlayback() {
    refs.current.player.stop();
  }
  // The saved voice when it reads the book's language, otherwise the first
  // voice for that language.
  const narrationVoice = (book) =>
    voicesFor(VOICES, book.language).some((v) => v.id === book.settings.voice)
      ? book.settings.voice
      : defaultVoice(book.language);
  async function listen(id, chapter, sentence) {
    showError(null);
    const book = refs.current.store.get(id),
      voice = narrationVoice(book);
    if (!voice) {
      showError("noVoicesForLanguage");
      return;
    }
    if (voice !== book.settings.voice)
      await update(id, { settings: { ...book.settings, voice } });
    await refs.current.player.start(id, chapter, sentence);
    refs.current.queue.prepare(id, chapter, sentence).catch((e) => {
      showError(e.message);
      // Without new audio the player would wait forever.
      if (refs.current.player.state?.status === "buffering")
        refs.current.player.pause();
    });
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
  async function preview(book, voice = narrationVoice(book), onProgress) {
    showError(null);
    stopPlayback();
    if (!voice) throw Error("noVoicesForLanguage");
    await loadVoiceFiles(refs.current.assets, [modelFor(voice)], onProgress);
    const text =
      book.language === "es"
        ? "Una habitación tranquila, un libro abierto y una voz que te acompaña."
        : "A quiet room, an open book, and a voice that keeps you company.";
    const result = await refs.current.engine.synthesize({ text, voice });
    refs.current.previewAudio?.pause();
    URL.revokeObjectURL(previewURL.current);
    previewURL.current = URL.createObjectURL(
      encodeWav(result.samples, result.sampleRate),
    );
    const audio = new Audio(previewURL.current);
    audio.playbackRate = refs.current.player.rate;
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
      analysis: analyzeSections({ ...book, chapters }),
    });
  }
  async function regenerate(id, chapter, sentence) {
    refs.current.queue.pause();
    if (refs.current.queue.running) await refs.current.queue.running;
    const book = refs.current.store.get(id),
      row = rowAt(book, chapter, sentence);
    const signature = await signatureFor(book, row);
    await loadVoiceFiles(refs.current.assets, modelsFor(book));
    const { blob, duration, rtf } = await renderRow(
      refs.current.engine,
      book,
      row,
    );
    const latest = refs.current.store.get(id),
      latestRow = latest && rowById(latest, row.id);
    if (
      !latest ||
      latest.deletedAt ||
      !latestRow ||
      (await signatureFor(latest, latestRow)) !== signature
    )
      throw Error("sentenceChanged");
    await refs.current.store.putAudio(id, row.id, signature, blob, {
      duration,
      rtf,
    });
    sync();
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
    voices: VOICES,
    refs,
    sync,
    upload,
    cancelUpload: () => refs.current.cancelParse?.(),
    retryUpload: () =>
      lastFile.current && upload(lastFile.current.files, lastFile.current.keep),
    load,
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
    stopPlayback,
  };
}
