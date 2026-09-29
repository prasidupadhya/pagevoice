import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Globe,
  Headphones,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sun,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BrowserBackend } from "./backends/BrowserBackend";
import { SpeechController } from "./browser/SpeechController";
import {
  DEFAULT_EDGE_VOICE,
  EDGE_ONLINE_VOICES,
  resolveDeviceVoice,
} from "./browser/edgeVoices";
import { messages, persist, preference } from "./i18n";

function Modal({ title, onClose, children, className = "", closeLabel }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      className={`browser-dialog ${className}`}
      ref={dialog}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="browser-dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label={closeLabel}
        >
          <X size={19} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function displayChapterTitle(book, index, b) {
  const title = book.chapters[index]?.title?.trim();
  if (title) return title;
  if (book.chapters.length === 1 && book.format === "pdf")
    return b.continuousText;
  if (
    book.format === "pdf" &&
    index === 0 &&
    book.chapters[index]?.evidence === "page-fallback"
  )
    return b.openingPages;
  return `${b.sectionNumber} ${index + 1}`;
}

function stableCoverHue(book) {
  let hash = 0;
  for (const character of `${book.language || "en"}:${book.title || "PageVoice"}`)
    hash = (hash * 31 + character.codePointAt(0)) | 0;
  return 190 + (Math.abs(hash) % 68);
}

function BrowserUploadDialog({
  initialFile,
  backend,
  locale,
  t,
  onCreated,
  onClose,
}) {
  const b = t.browser;
  const [file, setFile] = useState(initialFile || null);
  const [language, setLanguage] = useState(locale);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event) {
    event.preventDefault();
    if (!file) {
      setError("unsupportedFile");
      return;
    }
    if (!/\.(?:pdf|epub)$/iu.test(file.name)) {
      setError("unsupportedFile");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError("fileTooLarge");
      return;
    }
    controller.current = new AbortController();
    setProgress({ stage: "reading", current: 0, total: 1 });
    setError("");
    try {
      const book = await backend.importBook(file, language, {
        signal: controller.current.signal,
        onProgress: setProgress,
      });
      onCreated(book);
    } catch (failure) {
      if (failure.name !== "AbortError")
        setError(b[failure.message] ? failure.message : "processingError");
      setProgress(null);
    } finally {
      controller.current = null;
    }
  }

  const busy = Boolean(progress);
  const progressLabel =
    progress?.stage === "structuring"
      ? b.structuring
      : progress?.stage === "indexing"
        ? b.indexing
        : b.reading;
  return (
    <Modal
      title={b.addBook}
      closeLabel={b.close}
      onClose={() => {
        controller.current?.abort();
        onClose();
      }}
      className="browser-upload-dialog"
    >
      <form className="browser-form" onSubmit={submit}>
        <label className="browser-file-field">
          <span>{b.selectedFile}</span>
          <input
            type="file"
            accept=".pdf,.epub,application/pdf,application/epub+zip"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              setError("");
            }}
          />
        </label>
        {file && (
          <p className="browser-selected-file">
            <FileText size={17} />
            <span>{file.name}</span>
            <small>{(file.size / 1024 ** 2).toFixed(1)} MB</small>
          </p>
        )}
        {file && file.size > 50 * 1024 * 1024 && (
          <p className="browser-warning" role="status">
            {b.largeFileWarning}
          </p>
        )}
        <label>
          {b.bookLanguage}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={busy}
          >
            <option value="en">{b.english}</option>
            <option value="es">{b.spanish}</option>
          </select>
        </label>
        {error && (
          <p className="browser-error" role="alert">
            {b[error] || b.processingError}
          </p>
        )}
        {progress && (
          <div className="browser-progress" role="status" aria-live="polite">
            <p>{progressLabel}</p>
            <progress
              aria-label={progressLabel}
              max={Math.max(1, progress.total || 1)}
              value={Math.min(progress.current || 0, progress.total || 1)}
            />
          </div>
        )}
        <div className="browser-dialog-actions">
          {busy ? (
            <button
              type="button"
              className="secondary"
              onClick={() => controller.current?.abort()}
            >
              {b.cancelProcessing}
            </button>
          ) : (
            <button type="button" className="secondary" onClick={onClose}>
              {b.cancel}
            </button>
          )}
          <button className="primary" disabled={busy || !file}>
            <Upload size={17} /> {b.importBook}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BrowserSentences({
  book,
  chapterIndex,
  playback,
  canListen,
  onListen,
  textSize,
  labels,
}) {
  const scrollRef = useRef(null);
  const sentences = book.chapters[chapterIndex]?.sentences || [];
  const virtual = sentences.length > 80;
  const virtualizer = useVirtualizer({
    count: sentences.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 98,
    overscan: 5,
    enabled: virtual,
    initialRect: { width: 700, height: 620 },
    getItemKey: (index) => `${chapterIndex}-${index}`,
  });
  const indices = virtual
    ? virtualizer.getVirtualItems().map((item) => ({ index: item.index, item }))
    : sentences.map((_, index) => ({ index, item: null }));
  useEffect(() => {
    if (virtual && playback.chapter === chapterIndex && playback.sentence >= 0)
      virtualizer.scrollToIndex(playback.sentence, { align: "auto" });
  }, [virtual, playback.chapter, playback.sentence, chapterIndex, virtualizer]);
  return (
    <div
      ref={scrollRef}
      className="browser-sentence-scroll"
      role="region"
      aria-label={labels.chapterText}
      tabIndex={0}
      style={{ "--browser-reading-size": `${textSize}px` }}
    >
      <ol
        className="browser-sentence-list"
        style={
          virtual
            ? { height: virtualizer.getTotalSize(), position: "relative" }
            : undefined
        }
      >
        {indices.map(({ index, item }) => {
          const current =
            playback.status === "playing" &&
            playback.chapter === chapterIndex &&
            playback.sentence === index;
          return (
            <li
              key={`${chapterIndex}-${index}`}
              id={`browser-sentence-${chapterIndex}-${index}`}
              ref={virtual ? virtualizer.measureElement : undefined}
              data-index={index}
              aria-posinset={index + 1}
              aria-setsize={sentences.length}
              aria-current={current ? "true" : undefined}
              className={current ? "browser-speaking" : ""}
              style={
                item
                  ? {
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                    }
                  : undefined
              }
            >
              <span className="browser-sentence-number" aria-hidden="true">
                {index + 1}
              </span>
              <button
                className="browser-sentence-text"
                onClick={() => onListen(chapterIndex, index)}
                aria-label={`${labels.listenFromHere}: ${sentences[index]}`}
                disabled={!canListen}
              >
                {sentences[index]}
              </button>
              <button
                className="browser-sentence-listen"
                onClick={() => onListen(chapterIndex, index)}
                aria-label={`${labels.listenSentence} ${index + 1}`}
                disabled={!canListen}
              >
                <Play size={15} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const reasonKeys = {
  reviewed: "reviewedReason",
  document_role: "documentReason",
  navigation_boundary: "navigationReason",
  navigation_with_title: "navigationTitleReason",
  title_keyword: "titleReason",
  explicit_heading: "headingReason",
  before_first_chapter: "beforeChapterReason",
  unknown_boundary: "unknownReason",
};
const sourceKeys = {
  "document role": "documentRole",
  navigation: "navigation",
  outline: "outline",
  bookmark: "bookmark",
  "title keyword": "titleKeyword",
  heading: "heading",
  spine: "spine",
  "manual review": "manual",
};

function SectionReview({ book, backend, onBook, onStart, t }) {
  const b = t.browser;
  const [draftTitles, setDraftTitles] = useState({});
  useEffect(() => setDraftTitles({}), [book.id]);
  const analysis = book.analysis;
  function save(index, patch) {
    const title = draftTitles[index];
    const next = backend.review(book.id, index, {
      ...(title !== undefined ? { title } : {}),
      ...patch,
    });
    if (next) onBook(next);
  }
  return (
    <details className="browser-structure" open>
      <summary>
        <span>{b.analyze}</span>
        <small>{b.analysisHint}</small>
      </summary>
      <p className="browser-start-hint">
        <Check size={15} /> {b.startSuggested}:{" "}
        {displayChapterTitle(book, book.startChapter, b)}
      </p>
      <ol className="browser-section-list">
        {analysis.sections.map((section, index) => {
          const chapter = book.chapters[index];
          const reason = b[reasonKeys[section.reason] || "unknownReason"];
          const source = b[sourceKeys[section.source] || "spine"];
          const confidence = b[section.confidence] || b.low;
          const kind = chapter.reviewedKind || section.kind;
          const title = displayChapterTitle(book, index, b);
          return (
            <li key={`${book.id}-${index}`} className="browser-section-row">
              <div className="browser-section-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="browser-section-main">
                <label>
                  {b.sectionName}
                  <input
                    value={draftTitles[index] ?? (chapter.title || title)}
                    maxLength={160}
                    onChange={(event) =>
                      setDraftTitles((current) => ({
                        ...current,
                        [index]: event.target.value,
                      }))
                    }
                    onBlur={() => {
                      if (draftTitles[index] !== undefined) save(index, {});
                    }}
                  />
                </label>
                <label>
                  {b.sectionType}
                  <select
                    value={kind}
                    onChange={(event) =>
                      save(index, { kind: event.target.value })
                    }
                  >
                    <option value="chapter">{b.chapter}</option>
                    <option value="front_matter">{b.frontMatter}</option>
                    <option value="back_matter">{b.backMatter}</option>
                    <option value="unclassified">{b.unclassified}</option>
                  </select>
                </label>
                <p className="browser-evidence-line">
                  <span>{source}</span>
                  <span>{confidence}</span>
                  {section.review && <span>{b.needsReview}</span>}
                </p>
                <p className="browser-reason">
                  <strong>{b.reason}:</strong> {reason}
                </p>
                {section.excerpt && (
                  <blockquote className="browser-section-excerpt">
                    {section.excerpt}
                  </blockquote>
                )}
                {section.flags.length > 0 && (
                  <p className="browser-section-flags">
                    {section.flags
                      .map((flag) =>
                        flag === "duplicate_title"
                          ? b.duplicateTitle
                          : flag === "tiny_section"
                            ? b.tinySection
                            : b.hugeSection,
                      )
                      .join(" · ")}
                  </p>
                )}
                <button
                  className="browser-start-button"
                  onClick={() => {
                    save(index, { startHere: true });
                    onStart(index);
                  }}
                  aria-pressed={book.startChapter === index}
                >
                  {book.startChapter === index ? (
                    <Check size={15} />
                  ) : (
                    <Play size={14} />
                  )}
                  {book.startChapter === index ? b.startSuggested : b.setStart}
                </button>
              </div>
              <button
                className="icon-button browser-open-section"
                aria-label={`${b.readingTitle}: ${title}`}
                onClick={() => onStart(index)}
              >
                <ChevronRight size={18} />
              </button>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export function BrowserApp({ backend: suppliedBackend } = {}) {
  const [backend] = useState(() => suppliedBackend || new BrowserBackend());
  const [locale, setLocale] = useState(() =>
    preference("pagevoice-locale", "en") === "es" ? "es" : "en",
  );
  const [theme, setTheme] = useState(() =>
    preference(
      "pagevoice-theme",
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
  );
  const [books, setBooks] = useState(() => backend.list());
  const [activeId, setActiveId] = useState("");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchChapter, setSearchChapter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [undoBooks, setUndoBooks] = useState([]);
  const [voiceList, setVoiceList] = useState([]);
  const [voiceListLoaded, setVoiceListLoaded] = useState(false);
  const [voiceKey, setVoiceKey] = useState("");
  const [playback, setPlayback] = useState({ status: "idle", rate: 1 });
  const [rate, setRate] = useState(1);
  const [textSize, setTextSize] = useState(21);
  const [helpOpen, setHelpOpen] = useState(false);
  const b = messages[locale].browser;
  const t = messages[locale];
  const activeBook = books.find((book) => book.id === activeId) || null;
  const speechSupported =
    typeof window !== "undefined" &&
    Boolean(window.speechSynthesis) &&
    typeof window.SpeechSynthesisUtterance === "function";
  const timers = useRef(new Map());
  const removalTimers = useRef(new Set());
  const speech = useRef(null);
  const searchRef = useRef(null);
  const activeLanguage = activeBook?.language === "es" ? "es" : "en";
  const edgeVoicesForBook = useMemo(
    () =>
      EDGE_ONLINE_VOICES.filter((voice) => voice.language === activeLanguage),
    [activeLanguage],
  );
  const selectedEdgeVoice =
    edgeVoicesForBook.find((voice) => voice.id === voiceKey) ||
    edgeVoicesForBook.find(
      (voice) => voice.id === DEFAULT_EDGE_VOICE[activeLanguage],
    ) ||
    edgeVoicesForBook[0] ||
    null;
  const matchingVoices = useMemo(
    () =>
      new Map(
        edgeVoicesForBook.map((voice) => [
          voice.id,
          resolveDeviceVoice(voice, voiceList),
        ]),
      ),
    [edgeVoicesForBook, voiceList],
  );
  const selectedVoiceResolution = selectedEdgeVoice
    ? matchingVoices.get(selectedEdgeVoice.id) || null
    : null;
  const selectedSpeechVoice = selectedVoiceResolution?.voice || null;
  const searchResults = useMemo(
    () =>
      activeBook
        ? backend.search(activeBook.id, searchQuery, searchChapter)
        : [],
    [activeBook, backend, searchChapter, searchQuery],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    document.title =
      locale === "es"
        ? "PageVoice · Sala de lectura"
        : "PageVoice · Reading room";
    persist("pagevoice-locale", locale);
    persist("pagevoice-theme", theme);
  }, [locale, theme]);

  useEffect(() => {
    if (!speechSupported) return undefined;
    const controller = new SpeechController({
      synth: window.speechSynthesis,
      onState: setPlayback,
    });
    speech.current = controller;
    const updateVoices = () => {
      try {
        setVoiceList(window.speechSynthesis.getVoices());
      } catch {
        setVoiceList([]);
      } finally {
        setVoiceListLoaded(true);
      }
    };
    updateVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", updateVoices);
    window.speechSynthesis.onvoiceschanged = updateVoices;
    const retry = setTimeout(updateVoices, 500);
    return () => {
      clearTimeout(retry);
      window.speechSynthesis.removeEventListener?.(
        "voiceschanged",
        updateVoices,
      );
      if (window.speechSynthesis.onvoiceschanged === updateVoices)
        window.speechSynthesis.onvoiceschanged = null;
      controller.dispose();
      speech.current = null;
    };
  }, [speechSupported]);

  useEffect(() => {
    const warnBeforeClose = (event) => {
      if (!backend.hasTemporaryData) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const leaving = () => {
      speech.current?.dispose();
      backend.dispose();
    };
    window.addEventListener("beforeunload", warnBeforeClose);
    window.addEventListener("pagehide", leaving, { once: true });
    return () => {
      window.removeEventListener("beforeunload", warnBeforeClose);
      window.removeEventListener("pagehide", leaving);
      for (const timer of timers.current.values()) clearTimeout(timer);
      for (const timer of removalTimers.current) clearTimeout(timer);
      speech.current?.dispose();
      backend.dispose();
    };
  }, [backend]);

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      if (
        target?.closest?.(
          "input,textarea,select,button,dialog,[contenteditable=true]",
        ) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!activeBook) return;
      if (event.key === " ") {
        event.preventDefault();
        if (playback.status === "playing") speech.current?.pause();
        else if (["paused", "blocked", "error"].includes(playback.status))
          speech.current?.resume();
        else startListening(chapterIndex, 0);
      }
      if (["j", "k", "ArrowRight", "ArrowLeft"].includes(event.key)) {
        event.preventDefault();
        if (["j", "ArrowRight"].includes(event.key)) speech.current?.next();
        else speech.current?.previous();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeBook, chapterIndex, playback.status, rate, selectedSpeechVoice]);

  useEffect(() => {
    if (!activeBook) return;
    const timer = setTimeout(() => {
      document
        .getElementById(`browser-sentence-${chapterIndex}-${playback.sentence}`)
        ?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    }, 0);
    return () => clearTimeout(timer);
  }, [activeBook, chapterIndex, playback.chapter, playback.sentence]);

  useEffect(() => {
    if (
      ["starting", "playing"].includes(playback.status) &&
      playback.chapter >= 0
    )
      setChapterIndex(playback.chapter);
  }, [playback.chapter, playback.status]);

  function refreshBooks() {
    setBooks(backend.list());
  }

  function openUpload(file = null) {
    setUploadFile(file);
    setUploadOpen(true);
  }

  function created(book) {
    refreshBooks();
    setActiveId(book.id);
    setChapterIndex(book.startChapter || 0);
    setSearchQuery("");
    setSearchChapter("");
    setUploadOpen(false);
    setUploadFile(null);
  }

  function chooseBook(id) {
    speech.current?.stop();
    setActiveId(id);
    const book = backend.get(id);
    setChapterIndex(book?.startChapter || 0);
    setSearchQuery("");
    setSearchChapter("");
  }

  function startListening(chapter = chapterIndex, sentence = 0) {
    if (!activeBook || !speechSupported) return;
    if (!selectedSpeechVoice) return;
    setChapterIndex(chapter);
    speech.current?.play(
      activeBook,
      chapter,
      sentence,
      selectedSpeechVoice,
      rate,
    );
  }

  function previewVoice() {
    if (!selectedSpeechVoice || !activeBook) return;
    speech.current?.preview(
      b.voiceSample,
      selectedSpeechVoice,
      activeBook.language,
      rate,
    );
  }

  function setStart(index) {
    if (!activeBook) return;
    speech.current?.stop();
    const updated = backend.review(activeBook.id, index, { startHere: true });
    if (updated) {
      refreshBooks();
      setChapterIndex(index);
    }
  }

  function requestDelete(book) {
    speech.current?.status !== "idle" &&
      speech.current?.rows.some(
        (row) => row.chapter >= 0 && activeBook?.id === book.id,
      ) &&
      speech.current?.stop();
    setDeleteTarget(book);
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const book = deleteTarget;
    setDeleteTarget(null);
    setRemovingIds((current) => new Set(current).add(book.id));
    const animation = setTimeout(() => {
      removalTimers.current.delete(animation);
      const removed = backend.softDelete(book.id);
      setRemovingIds((current) => {
        const next = new Set(current);
        next.delete(book.id);
        return next;
      });
      if (!removed) return;
      refreshBooks();
      if (activeId === book.id) {
        speech.current?.stop();
        setActiveId("");
      }
      setUndoBooks((current) => [
        ...current,
        { id: book.id, title: book.title },
      ]);
      const purge = setTimeout(() => {
        backend.purge(book.id);
        timers.current.delete(book.id);
        setUndoBooks((current) =>
          current.filter((item) => item.id !== book.id),
        );
      }, 8000);
      timers.current.set(book.id, purge);
    }, 180);
    removalTimers.current.add(animation);
  }

  function undoDelete(id) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    const restored = backend.restore(id);
    if (!restored) return;
    refreshBooks();
    setUndoBooks((current) => current.filter((item) => item.id !== id));
    setActiveId(id);
    setChapterIndex(restored.startChapter || 0);
  }

  function clearEverything() {
    speech.current?.stop();
    backend.clear();
    for (const timer of removalTimers.current) clearTimeout(timer);
    removalTimers.current.clear();
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setUndoBooks([]);
    setRemovingIds(new Set());
    setBooks([]);
    setActiveId("");
    setChapterIndex(0);
    setSearchQuery("");
    setClearConfirm(false);
  }

  const removeErrorWarnings = activeBook?.warnings || [];
  const selectedChapter = activeBook?.chapters[chapterIndex];

  return (
    <div
      className="browser-mode"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file) openUpload(file);
      }}
    >
      <a className="skip-link" href="#browser-reading-area">
        {t.skip}
      </a>
      <header className="topbar browser-topbar">
        <a className="brand" href="#browser-reading-area">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          PageVoice
        </a>
        <span className="browser-temporary-badge">
          <ShieldCheck size={15} /> {b.badge}
        </span>
        <div className="top-controls browser-controls">
          {books.length > 0 && (
            <button
              className="secondary compact"
              onClick={() => setClearConfirm(true)}
            >
              <Trash2 size={16} /> {b.clearEverything}
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setHelpOpen(true)}
            aria-label={t.keyboardHelp}
          >
            ?
          </button>
          <label className="language-control">
            <Globe size={16} />
            <span className="sr-only">{t.language}</span>
            <select
              aria-label={t.language}
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </label>
          <button
            className="theme-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`${t.theme}: ${theme === "dark" ? t.light : t.dark}`}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <div className="browser-session-note" role="status">
        <span className="browser-session-icon">
          <ShieldCheck size={17} />
        </span>
        <p>
          <strong>{b.temporaryNotice}</strong>
          <small>{b.privacyNotice}</small>
        </p>
      </div>

      <div className="app-layout browser-layout">
        <aside className="library-rail browser-library">
          <div className="rail-heading">
            <h2>{b.library}</h2>
            <button
              className="icon-button"
              onClick={() => openUpload()}
              aria-label={b.addBook}
            >
              <Plus size={19} />
            </button>
          </div>
          <nav
            className="project-list browser-book-list"
            aria-label={b.library}
          >
            {books.map((book) => (
              <div
                key={book.id}
                className={`library-entry browser-book-entry ${removingIds.has(book.id) ? "browser-removing" : ""}`}
                data-book={book.id}
              >
                <button
                  className={`project-link ${activeId === book.id ? "selected" : ""}`}
                  onClick={() => chooseBook(book.id)}
                  aria-current={activeId === book.id ? "page" : undefined}
                >
                  <span
                    className="book-cover browser-cover"
                    style={{ "--cover-hue": stableCoverHue(book) }}
                    aria-hidden="true"
                  >
                    {book.cover ? (
                      <img src={book.cover} alt="" />
                    ) : (
                      <span className="cover-title">{book.title}</span>
                    )}
                    <span className="cover-language">
                      {book.language?.toUpperCase()}
                    </span>
                  </span>
                  <span>
                    <strong>{book.title}</strong>
                    <small>{book.author || b.authorUnknown}</small>
                  </span>
                  {activeId === book.id && <ChevronRight size={14} />}
                </button>
                <button
                  className="icon-button browser-card-delete"
                  aria-label={`${b.deleteBook}: ${book.title}`}
                  onClick={() => requestDelete(book)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </nav>
          {!books.length && (
            <p className="small muted browser-library-empty">{b.noBooks}</p>
          )}
          <button
            className="secondary browser-add-book"
            onClick={() => openUpload()}
          >
            <Plus size={16} /> {b.addBook}
          </button>
        </aside>

        <main
          id="browser-reading-area"
          className="main-area browser-main"
          tabIndex={-1}
        >
          {undoBooks.length > 0 && (
            <div className="browser-undo-stack" aria-live="polite">
              {undoBooks.map((item) => (
                <div key={item.id} className="undo-toast">
                  <p role="status">
                    {b.deleteBook}: {item.title}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => undoDelete(item.id)}
                  >
                    {b.undo}
                  </button>
                </div>
              ))}
            </div>
          )}
          {!activeBook ? (
            <section className="browser-empty-state">
              <div className="browser-empty-art" aria-hidden="true">
                <BookOpen size={34} />
                <span className="browser-ink-line" />
              </div>
              <p className="browser-eyebrow">PageVoice · {b.badge}</p>
              <h1>{b.noBooks}</h1>
              <p className="browser-empty-copy">{b.emptyHint}</p>
              <button className="browser-dropzone" onClick={() => openUpload()}>
                <Upload size={23} />
                <strong>{b.dropHere}</strong>
                <span>{b.chooseFile}</span>
                <small>PDF · EPUB · EN · ES</small>
              </button>
              <p className="browser-server-audio-note">{b.serverAudio}</p>
            </section>
          ) : (
            <>
              <section className="browser-book-heading">
                <span
                  className="book-cover large browser-cover-large"
                  style={{ "--cover-hue": stableCoverHue(activeBook) }}
                  aria-hidden="true"
                >
                  {activeBook.cover ? (
                    <img src={activeBook.cover} alt="" />
                  ) : (
                    <span className="cover-title">{activeBook.title}</span>
                  )}
                  <span className="cover-language">
                    {activeBook.language?.toUpperCase()}
                  </span>
                </span>
                <div className="browser-book-title-block">
                  <p className="book-author">
                    {activeBook.author || b.authorUnknown}
                  </p>
                  <h1>{activeBook.title}</h1>
                  <p className="book-meta">
                    <span>
                      {activeBook.language === "es" ? b.spanish : b.english}
                    </span>
                    <span>
                      {activeBook.chapters.length} {b.chapterCount}
                    </span>
                    <span>{activeBook.format.toUpperCase()}</span>
                  </p>
                </div>
                <div className="browser-book-actions">
                  <button
                    className="secondary compact"
                    onClick={() => openUpload()}
                  >
                    <Plus size={16} /> {b.addBook}
                  </button>
                  <button
                    className="icon-button"
                    onClick={() => requestDelete(activeBook)}
                    aria-label={`${b.deleteBook}: ${activeBook.title}`}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </section>

              {removeErrorWarnings.length > 0 && (
                <details className="browser-warning browser-margin-warning">
                  <summary>{b.removedMargins}</summary>
                  {removeErrorWarnings.map((warning, index) => (
                    <p key={`${warning.page}-${index}`}>
                      {b.page} {warning.page}: {warning.text}
                    </p>
                  ))}
                </details>
              )}

              <div className="browser-reader-grid">
                <nav className="browser-chapter-nav" aria-label={b.chapter}>
                  <p className="browser-eyebrow">{b.chapter}</p>
                  {activeBook.chapters.map((chapter, index) => (
                    <button
                      key={`${activeBook.id}-chapter-${index}`}
                      className={chapterIndex === index ? "selected" : ""}
                      onClick={() => {
                        speech.current?.stop();
                        setChapterIndex(index);
                      }}
                      aria-current={
                        chapterIndex === index ? "location" : undefined
                      }
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>
                        {displayChapterTitle(activeBook, index, b)}
                      </strong>
                    </button>
                  ))}
                </nav>

                <article className="reading-sheet browser-reading-sheet">
                  <header className="browser-current-chapter">
                    <span className="chapter-number">
                      {String(chapterIndex + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <p className="browser-eyebrow">
                        {activeBook.language === "es" ? b.spanish : b.english}
                      </p>
                      <h2>
                        {displayChapterTitle(activeBook, chapterIndex, b)}
                      </h2>
                      <small>
                        {selectedChapter?.sentences?.length || 0} {t.sentences}
                      </small>
                    </div>
                    <button
                      className="browser-chapter-play"
                      onClick={() => startListening(chapterIndex, 0)}
                      disabled={!selectedSpeechVoice}
                      aria-label={`${b.listenFromHere}: ${displayChapterTitle(activeBook, chapterIndex, b)}`}
                    >
                      <Play size={17} />
                    </button>
                  </header>
                  <BrowserSentences
                    book={activeBook}
                    chapterIndex={chapterIndex}
                    playback={playback}
                    canListen={Boolean(selectedSpeechVoice)}
                    onListen={startListening}
                    textSize={textSize}
                    labels={b}
                  />
                  <label className="browser-text-size">
                    {t.textSize}
                    <input
                      type="range"
                      min="17"
                      max="29"
                      value={textSize}
                      onChange={(event) =>
                        setTextSize(Number(event.target.value))
                      }
                    />
                  </label>
                </article>

                <aside className="browser-reader-sidebar">
                  <section
                    className="browser-player-panel"
                    aria-label={b.audioTitle}
                  >
                    <div className="browser-panel-title">
                      <span className="browser-player-icon">
                        <Headphones size={19} />
                      </span>
                      <div>
                        <p className="browser-eyebrow">{b.audioTitle}</p>
                        <h2>
                          {playback.status === "playing"
                            ? displayChapterTitle(
                                activeBook,
                                playback.chapter,
                                b,
                              )
                            : b.voice}
                        </h2>
                      </div>
                    </div>
                    <label
                      className="browser-field-label"
                      htmlFor="browser-voice"
                    >
                      {b.voice}
                    </label>
                    <select
                      id="browser-voice"
                      value={selectedEdgeVoice?.id || ""}
                      onChange={(event) => {
                        speech.current?.stop();
                        setVoiceKey(event.target.value);
                      }}
                    >
                      {[
                        { region: "US", label: b.englishUS },
                        { region: "GB", label: b.britishEnglish },
                        { region: "ES", label: b.spanishSpain },
                      ]
                        .map((group) => ({
                          ...group,
                          voices: edgeVoicesForBook.filter(
                            (voice) => voice.region === group.region,
                          ),
                        }))
                        .filter((group) => group.voices.length > 0)
                        .map((group) => (
                          <optgroup label={group.label} key={group.region}>
                            {group.voices.map((voice) => {
                              const available = matchingVoices.get(voice.id);
                              return (
                                <option
                                  key={voice.id}
                                  value={voice.id}
                                  disabled={!available}
                                >
                                  {voice.name} · {t[voice.gender]}
                                  {!available
                                    ? ` · ${b.voiceUnavailableShort}`
                                    : ""}
                                </option>
                              );
                            })}
                          </optgroup>
                        ))}
                    </select>
                    {selectedSpeechVoice ? (
                      <p className="browser-voice-match" role="status">
                        {selectedVoiceResolution.match === "exact" ? (
                          <>
                            {b.voiceMatched}: {selectedSpeechVoice.name} ·{" "}
                            {selectedSpeechVoice.lang}
                          </>
                        ) : (
                          <>
                            {b.voiceFallback}: {selectedSpeechVoice.name} ·{" "}
                            {selectedSpeechVoice.lang}. {b.voiceFallbackNote}
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="browser-small-warning" role="status">
                        {!speechSupported
                          ? b.unsupportedSpeech
                          : voiceListLoaded
                            ? b.voiceUnavailable
                            : b.voicesLoading}
                      </p>
                    )}
                    <button
                      className="text-button"
                      disabled={!selectedSpeechVoice}
                      onClick={previewVoice}
                    >
                      <Volume2 size={16} /> {b.previewVoice}
                    </button>
                    <details className="browser-edge-voice-catalogue">
                      <summary>{b.edgeCatalogueTitle}</summary>
                      <p>{b.edgeCatalogueNotice}</p>
                    </details>
                    <label
                      className="browser-field-label"
                      htmlFor="browser-speed"
                    >
                      {b.speed}: {rate.toFixed(1)}×
                    </label>
                    <input
                      id="browser-speed"
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={rate}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setRate(next);
                        speech.current?.setRate(next);
                      }}
                    />
                    {speechSupported ? (
                      <div className="browser-player-controls">
                        <button
                          className="icon-button"
                          onClick={() => speech.current?.previous()}
                          aria-label={b.previous}
                          disabled={!activeBook || !selectedSpeechVoice}
                        >
                          <SkipBack size={18} />
                        </button>
                        {playback.status === "playing" ||
                        playback.status === "starting" ? (
                          <button
                            className="primary"
                            onClick={() => speech.current?.pause()}
                          >
                            <Pause size={17} /> {b.pause}
                          </button>
                        ) : ["paused", "blocked", "error"].includes(
                            playback.status,
                          ) ? (
                          <button
                            className="primary"
                            onClick={() => speech.current?.resume()}
                          >
                            <Play size={17} />{" "}
                            {playback.status === "blocked"
                              ? b.tapToEnable
                              : b.resume}
                          </button>
                        ) : (
                          <button
                            className="primary"
                            onClick={() =>
                              startListening(activeBook.startChapter || 0, 0)
                            }
                            disabled={!selectedSpeechVoice}
                          >
                            <Play size={17} /> {b.listen}
                          </button>
                        )}
                        <button
                          className="icon-button"
                          onClick={() => speech.current?.next()}
                          aria-label={b.next}
                          disabled={!activeBook || !selectedSpeechVoice}
                        >
                          <SkipForward size={18} />
                        </button>
                        {playback.status !== "idle" &&
                          playback.status !== "ended" && (
                            <button
                              className="icon-button"
                              onClick={() => speech.current?.stop()}
                              aria-label={b.stop}
                            >
                              <X size={17} />
                            </button>
                          )}
                      </div>
                    ) : (
                      <p className="browser-error" role="status">
                        {b.unsupportedSpeech}
                      </p>
                    )}
                    {playback.status === "error" && (
                      <p role="alert" className="browser-error">
                        {b.speechError}
                      </p>
                    )}
                    {playback.status === "blocked" && (
                      <p role="status" className="browser-small-warning">
                        {b.tapToEnable}
                      </p>
                    )}
                    <p className="browser-audio-note">{b.audioPrivacy}</p>
                    <p className="browser-server-audio-note">{b.serverAudio}</p>
                  </section>

                  <section
                    className="browser-search-panel"
                    aria-label={b.search}
                  >
                    <div className="browser-panel-title">
                      <span className="browser-player-icon">
                        <Search size={17} />
                      </span>
                      <div>
                        <p className="browser-eyebrow">{b.analyze}</p>
                        <h2>{b.search}</h2>
                      </div>
                    </div>
                    <label className="sr-only" htmlFor="browser-search">
                      {b.searchPlaceholder}
                    </label>
                    <input
                      id="browser-search"
                      ref={searchRef}
                      type="search"
                      placeholder={b.searchPlaceholder}
                      value={searchQuery}
                      maxLength={500}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                    <label className="sr-only" htmlFor="browser-search-chapter">
                      {b.allSections}
                    </label>
                    <select
                      id="browser-search-chapter"
                      value={searchChapter}
                      onChange={(event) => setSearchChapter(event.target.value)}
                    >
                      <option value="">{b.allSections}</option>
                      {activeBook.chapters.map((_, index) => (
                        <option key={index} value={index}>
                          {displayChapterTitle(activeBook, index, b)}
                        </option>
                      ))}
                    </select>
                    <p className="browser-lexical-note">{b.localLexical}</p>
                    {searchQuery && !searchResults.length && (
                      <p className="small muted">{b.searchNoResults}</p>
                    )}
                    {!searchQuery && (
                      <p className="small muted">{b.searchEmpty}</p>
                    )}
                    <ol className="browser-search-results">
                      {searchResults.map((hit) => (
                        <li key={`${hit.chapter}-${hit.sentence}`}>
                          <div className="browser-hit-topline">
                            <span>
                              {displayChapterTitle(activeBook, hit.chapter, b)}
                            </span>
                            <small>{hit.citation}</small>
                          </div>
                          <p>{hit.text}</p>
                          {hit.context && (
                            <small className="browser-hit-context">
                              {hit.context}
                            </small>
                          )}
                          <div className="browser-hit-actions">
                            <span className={`browser-match ${hit.match}`}>
                              {hit.match === "exact" ? b.exact : b.partial}
                            </span>
                            <button
                              className="text-button"
                              disabled={!selectedSpeechVoice}
                              onClick={() => {
                                setChapterIndex(hit.chapter);
                                startListening(hit.chapter, hit.sentence);
                              }}
                            >
                              <Play size={13} /> {b.listenFromPassage}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                </aside>
              </div>

              <SectionReview
                book={activeBook}
                backend={backend}
                onBook={(updated) => {
                  refreshBooks();
                  if (updated.id === activeId)
                    setChapterIndex(updated.startChapter || chapterIndex);
                }}
                onStart={setStart}
                t={t}
              />
            </>
          )}
        </main>
      </div>

      {uploadOpen && (
        <BrowserUploadDialog
          key={uploadFile?.name || "upload"}
          initialFile={uploadFile}
          backend={backend}
          locale={locale}
          t={t}
          onCreated={created}
          onClose={() => {
            setUploadOpen(false);
            setUploadFile(null);
          }}
        />
      )}
      {deleteTarget && (
        <Modal
          title={b.deleteTitle}
          closeLabel={b.close}
          onClose={() => setDeleteTarget(null)}
        >
          <div className="browser-confirm-body">
            <p>
              <strong>{deleteTarget.title}</strong>
            </p>
            <p>{b.deleteDescription}</p>
            <div className="browser-dialog-actions">
              <button
                className="secondary"
                onClick={() => setDeleteTarget(null)}
              >
                {b.cancel}
              </button>
              <button className="primary danger" onClick={confirmDelete}>
                <Trash2 size={16} /> {b.deleteBook}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {clearConfirm && (
        <Modal
          title={b.clearTitle}
          closeLabel={b.close}
          onClose={() => setClearConfirm(false)}
        >
          <div className="browser-confirm-body">
            <p>{b.clearDescription}</p>
            <div className="browser-dialog-actions">
              <button
                className="secondary"
                onClick={() => setClearConfirm(false)}
              >
                {b.cancel}
              </button>
              <button className="primary danger" onClick={clearEverything}>
                <Trash2 size={16} /> {b.clearEverything}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {helpOpen && (
        <Modal
          title={t.keyboardHelp}
          closeLabel={b.close}
          onClose={() => setHelpOpen(false)}
        >
          <p className="browser-shortcuts">{t.shortcutsHint}</p>
        </Modal>
      )}
    </div>
  );
}

export default BrowserApp;
