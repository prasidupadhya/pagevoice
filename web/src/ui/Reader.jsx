import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  BookOpen,
  Search,
  SlidersHorizontal,
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Bookmark,
  PenLine,
  ChevronLeft,
  ChevronRight,
  Menu,
  Trash2,
  Check,
  Volume2,
  Copy,
  X,
  Keyboard,
  Plus,
  WifiOff,
} from "lucide-react";
import Modal from "./Modal";
import { voicesFor } from "../offline/engines";
import { readyRun } from "../offline/render";
import { duration } from "../offline/format";
import { applySectionReview } from "../browser/analysis";

export default function Reader({
  book,
  api,
  t,
  onBack,
  onDelete,
  onModels,
  toast,
}) {
  const [chapter, setChapter] = useState(book.position.chapter),
    [tab, setTab] = useState("read"),
    [drawer, setDrawer] = useState(false),
    [size, setSize] = useState(20),
    [help, setHelp] = useState(false),
    [editor, setEditor] = useState(null),
    [editText, setEditText] = useState(""),
    [speaker, setSpeaker] = useState(""),
    [review, setReview] = useState(null),
    [reviewTitle, setReviewTitle] = useState(""),
    [reviewKind, setReviewKind] = useState("unclassified"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [searchMode, setSearchMode] = useState("lexical"),
    [hits, setHits] = useState([]),
    [analysis, setAnalysis] = useState(null),
    [exportScope, setExportScope] = useState(""),
    [format, setFormat] = useState("zip"),
    [exportProgress, setExportProgress] = useState(null),
    [busy, setBusy] = useState(false),
    [charName, setCharName] = useState("");
  const scroll = useRef(null),
    searchRef = useRef(null),
    searchWorker = useRef(null),
    searchSequence = useRef(0);
  const c = book.chapters[chapter] || book.chapters[0],
    position =
      api.playback.bookId === book.id && api.playback.row
        ? api.playback.row
        : book.position;
  const sentences = c.sentences,
    virtual = useVirtualizer({
      count: sentences.length,
      getScrollElement: () => scroll.current,
      estimateSize: () => 130,
      overscan: 6,
    });
  const playback =
      api.playback.bookId === book.id ? api.playback : { status: "idle" },
    preparation =
      api.preparation.bookId === book.id ? api.preparation : { status: "idle" };
  const buffer = readyRun(
      book,
      playback.target?.chapter ?? position.chapter,
      playback.target?.sentence ?? position.sentence,
    ),
    prepared = Object.keys(book.prepared).length,
    total = book.chapters.reduce((n, ch) => n + ch.sentences.length, 0);
  const voices = voicesFor(
    book.settings.engine,
    book.language,
    api.deviceVoices,
  );
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e.message !== "cancelled") api.setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const show = (ch, s = 0) => {
    setChapter(ch);
    setTab("read");
    setDrawer(false);
    setTimeout(() => virtual.scrollToIndex(s, { align: "center" }), 40);
  };
  const listen = (ch, s) => {
    show(ch, s);
    api.listen(book.id, ch, s).catch((e) => api.setError(e.message));
  };
  useEffect(() => {
    const worker = new Worker(
      new URL("../offline/search.worker.js", import.meta.url),
      { type: "module" },
    );
    searchWorker.current = worker;
    return () => worker.terminate();
  }, []);
  useEffect(() => {
    searchWorker.current?.postMessage({ book });
  }, [book.chapters, book.searchIndex, book.semantics]);
  useEffect(() => {
    const id = ++searchSequence.current;
    const timer = setTimeout(async () => {
      let vector;
      try {
        if (searchMode === "hybrid" && book.semantics && query.trim())
          vector = await api.semanticQuery(query);
      } catch (e) {
        api.setError(e.message);
      }
      if (id !== searchSequence.current) return;
      searchWorker.current.onmessage = ({ data }) => {
        if (data.id === searchSequence.current) setHits(data.hits);
      };
      searchWorker.current.postMessage({ id, query, chapter: filter, vector });
    }, 180);
    return () => clearTimeout(timer);
  }, [query, filter, searchMode, book.semantics]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [chapter]);
  useEffect(() => {
    if (playback.status === "playing" && playback.row) {
      if (playback.row.chapter !== chapter) setChapter(playback.row.chapter);
      else virtual.scrollToIndex(playback.row.sentence, { align: "center" });
    }
  }, [playback.row?.id, playback.status]);
  useEffect(() => {
    const key = (e) => {
      if (
        e.target.closest(
          "input,select,textarea,button,[contenteditable],dialog",
        )
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        api.togglePlayback(book);
      }
      if (e.key === "?") setHelp(true);
      if (e.key === "/") {
        e.preventDefault();
        setTab("explore");
        setTimeout(() => searchRef.current?.focus(), 30);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        api.refs.current.player.seek(e.key === "ArrowLeft" ? -10 : 10);
      }
      if (e.key.toLowerCase() === "j" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (book.settings.engine === "device")
          api.refs.current.speech[
            e.key.toLowerCase() === "j" ? "previous" : "next"
          ]();
        else api.refs.current.player.next(e.key.toLowerCase() === "j" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [book, playback]);
  const bookmark = async (ch, s) => {
    const id = `${ch}:${s}`,
      marks = book.bookmarks || [];
    await api.update(book.id, {
      bookmarks: marks.includes(id)
        ? marks.filter((v) => v !== id)
        : [...marks, id],
    });
    toast(t(marks.includes(id) ? "bookmarkRemoved" : "bookmarkSaved"));
  };
  const analyze = (kind) =>
    run(async () => {
      setAnalysis({ kind, current: 0, total: 1 });
      try {
        await api.analyze(book.id, kind, (p) => setAnalysis({ kind, ...p }));
        toast(t(kind === "embeddings" ? "semanticReady" : "nerReady"));
      } finally {
        setAnalysis(null);
      }
    });
  return (
    <main className="reader-room">
      <div className="reader-bar">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={17} />
          {t("back")}
        </button>
        <span className="reader-book-title">{book.title}</span>
        <span className="language-tag" title={t("detected")}>
          {book.language.toUpperCase()}
        </span>
        <button
          className="icon-button"
          onClick={() => onDelete(book)}
          aria-label={t("remove")}
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="reader-layout">
        <aside
          className={`chapter-drawer ${drawer ? "open" : ""}`}
          aria-label={t("chapters")}
        >
          <div className="drawer-heading">
            <h2>{t("chapters")}</h2>
            <button
              className="icon-button drawer-close"
              onClick={() => setDrawer(false)}
              aria-label={t("close")}
            >
              <X size={18} />
            </button>
          </div>
          <ol>
            {book.chapters.map((ch, index) => {
              const section = book.analysis.sections[index],
                count = Object.keys(book.prepared).filter((k) =>
                  k.startsWith(`${index}:`),
                ).length;
              return (
                <li key={index}>
                  <button
                    onClick={() => show(index)}
                    aria-current={index === chapter ? "page" : undefined}
                  >
                    <span className="chapter-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <span className="chapter-name">{ch.title}</span>
                      <small>
                        {count} / {ch.sentences.length}
                        <span
                          className={`kind-dot ${section.kind}`}
                          title={t(
                            section.kind === "chapter"
                              ? "chapterType"
                              : section.kind,
                          )}
                        />
                      </small>
                    </span>
                    {index === book.startChapter && <Bookmark size={13} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="drawer-bookmarks">
            <h3>{t("bookmarks")}</h3>
            {!(book.bookmarks || []).length ? (
              <small className="muted">{t("noBookmarks")}</small>
            ) : (
              book.bookmarks.map((id) => {
                const [ch, s] = id.split(":").map(Number);
                return (
                  <button
                    className="bookmark-link"
                    key={id}
                    onClick={() => show(ch, s)}
                  >
                    {book.chapters[ch]?.sentences[s]?.slice(0, 85)}
                  </button>
                );
              })
            )}
          </div>
        </aside>
        <section className="reader-center">
          <div className="reader-tabs">
            <button
              className="icon-button chapters-toggle"
              onClick={() => setDrawer(true)}
              aria-label={t("chapters")}
              aria-expanded={drawer}
            >
              <Menu size={20} />
            </button>
            {[
              ["read", BookOpen],
              ["explore", Search],
              ["voice", SlidersHorizontal],
              ["export", Download],
            ].map(([id, Icon]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
              >
                <Icon size={16} />
                <span>{t(id)}</span>
              </button>
            ))}
          </div>
          {tab === "read" && (
            <>
              <div className="reading-heading">
                <div>
                  <p className="eyebrow">
                    {t("chapter")} {chapter + 1} / {book.chapters.length}
                  </p>
                  <h1>{c.title}</h1>
                </div>
                <div className="text-controls">
                  <label>
                    <span className="sr-only">{t("textSize")}</span>
                    <select
                      aria-label={t("textSize")}
                      value={size}
                      onChange={(e) => setSize(Number(e.target.value))}
                    >
                      {[18, 20, 22, 24, 28].map((n) => (
                        <option value={n} key={n}>
                          {n}px
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="icon-button"
                    aria-label={t("shortcuts")}
                    onClick={() => setHelp(true)}
                  >
                    <Keyboard size={17} />
                  </button>
                </div>
              </div>
              <div
                className="reading-scroll"
                ref={scroll}
                style={{ "--reading-size": `${size}px` }}
                aria-label={t("read")}
              >
                <div
                  className="sentence-virtual"
                  style={{ height: virtual.getTotalSize() }}
                >
                  {virtual.getVirtualItems().map((item) => {
                    const s = item.index,
                      id = `${chapter}:${s}`,
                      isReady = !!book.prepared[id],
                      current =
                        playback.status === "playing" &&
                        playback.row?.chapter === chapter &&
                        playback.row.sentence === s,
                      marked = book.bookmarks?.includes(id);
                    return (
                      <div
                        data-index={s}
                        ref={virtual.measureElement}
                        className={`sentence ${isReady ? "inked" : ""} ${current ? "speaking" : ""}`}
                        key={s}
                        style={{ transform: `translateY(${item.start}px)` }}
                        data-ready={isReady}
                        data-sentence={id}
                      >
                        <span className="sentence-number" aria-hidden="true">
                          {s + 1}
                          {isReady && <span className="ink-dot" />}
                        </span>
                        <button
                          className="sentence-text"
                          onClick={() => listen(chapter, s)}
                          aria-current={current ? "true" : undefined}
                          title={t("listenHere")}
                        >
                          {sentences[s]}
                        </button>
                        <div className="sentence-tools">
                          <button
                            className="icon-button"
                            aria-label={`${t("listenHere")} · ${s + 1}`}
                            onClick={() => listen(chapter, s)}
                          >
                            <Play size={14} />
                          </button>
                          <button
                            className={`icon-button ${marked ? "marked" : ""}`}
                            aria-label={`${t("bookmark")} · ${s + 1}`}
                            aria-pressed={!!marked}
                            onClick={() => bookmark(chapter, s)}
                          >
                            <Bookmark size={14} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`${t("editSentence")} · ${s + 1}`}
                            onClick={() => {
                              setEditor({ chapter, sentence: s });
                              setEditText(sentences[s]);
                              setSpeaker(book.characters?.speakers[id] || "");
                            }}
                          >
                            <PenLine size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="page-navigation">
                  <button
                    disabled={chapter === 0}
                    onClick={() => show(chapter - 1)}
                  >
                    <ChevronLeft size={16} />
                    {t("previous")}
                  </button>
                  <button
                    disabled={chapter === book.chapters.length - 1}
                    onClick={() => show(chapter + 1)}
                  >
                    {t("next")}
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
          {tab === "explore" && (
            <div className="panel-scroll explore-panel">
              <p className="eyebrow">{t("documentDerived")}</p>
              <h1>{t("explore")}</h1>
              <div className="structure-ribbon" aria-label={t("chapters")}>
                {book.analysis.sections.map((s) => (
                  <button
                    key={s.index}
                    className={s.kind}
                    title={`${s.title} · ${t(s.confidence)} · ${t(s.reason)}`}
                    aria-label={s.title}
                    onClick={() => {
                      setReview(s.index);
                      setReviewTitle(s.title);
                      setReviewKind(s.kind);
                    }}
                    style={{ flex: Math.max(1, Math.sqrt(s.wordCount)) }}
                  />
                ))}
              </div>
              <details className="structure-details">
                <summary>
                  {t("chapters")} · {book.analysis.reviewCount}{" "}
                  {t("review").toLowerCase()}
                </summary>
                {book.analysis.sections.map((s) => (
                  <div className="structure-row" key={s.index}>
                    <div>
                      <strong>{s.title}</strong>
                      <small>
                        {t(s.kind === "chapter" ? "chapterType" : s.kind)} ·{" "}
                        {t(s.confidence)} · {t(s.reason)}
                        <br />
                        {s.sourceAnchor}
                      </small>
                      {s.flags.map((f) => (
                        <small className="warning" key={f}>
                          {t(f)}
                        </small>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setReview(s.index);
                        setReviewTitle(s.title);
                        setReviewKind(s.kind);
                      }}
                      aria-label={`${t("editSentence")} · ${s.title}`}
                    >
                      <PenLine size={15} />
                    </button>
                  </div>
                ))}
                {book.warnings?.map((w, i) => (
                  <small className="warning" key={i}>
                    {t("warnings")} · {w.page ? `${w.page}: ` : ""}
                    {t(w.text) || w.text}
                  </small>
                ))}
              </details>
              <h2>{t("search")}</h2>
              <p className="muted">{t("searchNotice")}</p>
              <label className="search-field">
                <Search size={18} />
                <span className="sr-only">{t("query")}</span>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  maxLength={500}
                />
              </label>
              <div className="search-options">
                <label>
                  <span className="sr-only">{t("chapter")}</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">{t("allChapters")}</option>
                    {book.chapters.map((ch, i) => (
                      <option key={i} value={i}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">{t("search")}</span>
                  <select
                    value={searchMode}
                    onChange={(e) => setSearchMode(e.target.value)}
                  >
                    <option value="lexical">{t("lexical")}</option>
                    <option value="hybrid" disabled={!book.semantics}>
                      {t("hybrid")}
                    </option>
                  </select>
                </label>
              </div>
              <div
                className="search-hits"
                aria-label={t("searchResults")}
                aria-live="polite"
              >
                {query && !hits.length && (
                  <p className="no-evidence">{t("noEvidence")}</p>
                )}
                {hits.slice(0, 40).map((hit) => (
                  <article key={hit.citation}>
                    <div className="hit-heading">
                      <span className="match-badge">{t(hit.match)}</span>
                      <small>
                        {hit.title} · {hit.citation}
                      </small>
                    </div>
                    <p>{highlight(hit.text, hit.matchedTerms)}</p>
                    <small className="muted">{hit.context}</small>
                    <div className="hit-actions">
                      <button onClick={() => show(hit.chapter, hit.sentence)}>
                        {t("showSource")}
                      </button>
                      <button onClick={() => listen(hit.chapter, hit.sentence)}>
                        <Play size={13} />
                        {t("listenHere")}
                      </button>
                      <button
                        aria-label={t("copyCitation")}
                        onClick={async () => {
                          await navigator.clipboard.writeText(
                            `${book.title} · ${hit.citation} · ${book.chapters[hit.chapter].source}\n${hit.text}`,
                          );
                          toast(t("copied"));
                        }}
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <section className="optional-analysis">
                <h2>{t("optionalAnalysis")}</h2>
                <p>{t("analysisNotice")}</p>
                <div className="button-row">
                  <button
                    disabled={!!analysis}
                    onClick={() => analyze("embeddings")}
                  >
                    {book.semantics && <Check size={16} />} {t("semanticIndex")}
                  </button>
                  <button disabled={!!analysis} onClick={() => analyze("ner")}>
                    {book.entities && <Check size={16} />} {t("nerIndex")}
                  </button>
                </div>
                {analysis && (
                  <>
                    <progress
                      value={analysis.current}
                      max={analysis.total}
                      aria-label={t("indexing")}
                    />
                    <button onClick={() => api.refs.current.cancelAnalysis?.()}>
                      {t("cancelAnalysis")}
                    </button>
                  </>
                )}
                <button className="text-button" onClick={onModels}>
                  {t("models")} <Download size={14} />
                </button>
              </section>
            </div>
          )}
          {tab === "voice" && (
            <div className="panel-scroll voice-panel">
              <p className="eyebrow">{t("voiceLocal")}</p>
              <h1>{t("voice")}</h1>
              <div className="form-grid">
                <label>
                  {t("engine")}
                  <select
                    value={book.settings.engine}
                    aria-label={t("engine")}
                    onChange={(e) =>
                      run(() =>
                        api.settings(book.id, {
                          engine: e.target.value,
                          voice:
                            voicesFor(
                              e.target.value,
                              book.language,
                              api.deviceVoices,
                            )[0]?.id || "",
                          cast: {},
                          device: "wasm",
                        }),
                      )
                    }
                  >
                    <option value={book.language === "es" ? "piper" : "kokoro"}>
                      {t(book.language === "es" ? "piper" : "kokoro")}
                    </option>
                    <option value="supertonic">{t("supertonic")}</option>
                    <option value="device">{t("device")}</option>
                  </select>
                </label>
                <label>
                  {t("voicePicker")}
                  <select
                    value={book.settings.voice}
                    aria-label={t("voicePicker")}
                    onChange={(e) =>
                      run(() =>
                        api.settings(book.id, { voice: e.target.value }),
                      )
                    }
                  >
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {v.locale}
                      </option>
                    ))}
                  </select>
                </label>
                {book.settings.engine === "kokoro" && (
                  <label>
                    {t("execution")}
                    <select
                      value={book.settings.device || "wasm"}
                      onChange={(e) =>
                        run(() =>
                          api.settings(book.id, { device: e.target.value }),
                        )
                      }
                    >
                      <option value="wasm">{t("wasm")}</option>
                      <option value="webgpu" disabled={!navigator.gpu}>
                        {t("webgpu")}
                      </option>
                    </select>
                  </label>
                )}
                <label>
                  {t("generationPace")} · {book.settings.pace.toFixed(1)}×
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={book.settings.pace}
                    onChange={(e) =>
                      api
                        .settings(book.id, { pace: Number(e.target.value) })
                        .catch((e) => api.setError(e.message))
                    }
                  />
                </label>
                <label>
                  {t("buffer")}
                  <select
                    value={book.settings.buffer}
                    onChange={(e) =>
                      api.settings(book.id, { buffer: Number(e.target.value) })
                    }
                  >
                    {[5, 10, 20, 40].map((n) => (
                      <option key={n} value={n}>
                        {n} {t("sentences")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {book.settings.engine === "device" ? (
                <p className="notice">
                  {t("deviceNotice")}
                  {!voices.length && <strong>{t("deviceNoVoices")}</strong>}
                </p>
              ) : (
                <p className="muted">{t("bufferHelp")}</p>
              )}
              <div className="button-row">
                <button
                  onClick={() => run(() => api.preview(book))}
                  disabled={
                    busy || preparation.status === "preparing" || !voices.length
                  }
                >
                  <Volume2 size={16} />
                  {t("preview")}
                </button>
                {book.settings.engine !== "device" && (
                  <button onClick={onModels}>
                    <Download size={16} />
                    {t("models")}
                  </button>
                )}
              </div>
              {book.settings.engine === "supertonic" && (
                <p className="notice">{t("supertonicNotice")}</p>
              )}
              {book.settings.engine !== "device" && (
                <section className="casting-panel">
                  <h2>{t("cast")}</h2>
                  <p className="muted">{t("heuristicNotice")}</p>
                  {!book.characters?.characters.length && (
                    <p>{t("noCharacters")}</p>
                  )}
                  {book.characters?.characters.map((character) => (
                    <label className="casting-row" key={character.name}>
                      <span>
                        <strong>{character.name}</strong>
                        <small>
                          {character.count} · {t("inferred")}
                        </small>
                      </span>
                      <select
                        value={book.settings.cast[character.name] || ""}
                        onChange={(e) =>
                          run(() =>
                            api.settings(book.id, {
                              cast: {
                                ...book.settings.cast,
                                [character.name]:
                                  e.target.value || book.settings.voice,
                              },
                            }),
                          )
                        }
                      >
                        <option value="">{t("defaultVoice")}</option>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.locale}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <div className="button-row">
                    <label>
                      <span className="sr-only">{t("characterName")}</span>
                      <input
                        value={charName}
                        onChange={(e) => setCharName(e.target.value)}
                        placeholder={t("characterName")}
                        maxLength={50}
                      />
                    </label>
                    <button
                      disabled={!charName.trim()}
                      onClick={() =>
                        run(async () => {
                          await api.update(book.id, {
                            characters: {
                              ...book.characters,
                              characters: [
                                ...book.characters.characters.filter(
                                  (c) => c.name !== charName.trim(),
                                ),
                                {
                                  name: charName.trim(),
                                  count: 0,
                                  source: "manual review",
                                },
                              ],
                            },
                          });
                          setCharName("");
                        })
                      }
                    >
                      <Plus size={16} />
                      {t("addCharacter")}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
          {tab === "export" && (
            <div className="panel-scroll export-panel">
              <p className="eyebrow">
                {prepared} / {total} {t("sentences")} {t("prepared")}
              </p>
              <h1>{t("export")}</h1>
              <p>{t("exportHelp")}</p>
              <div className="form-grid">
                <label>
                  {t("exportScope")}
                  <select
                    value={exportScope || String(chapter)}
                    onChange={(e) => setExportScope(e.target.value)}
                  >
                    <option value="all">{t("wholeBook")}</option>
                    {book.chapters.map((ch, i) => (
                      <option key={i} value={String(i)}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("downloadAudio")}
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="zip">{t("chapterZIP")}</option>
                    <option value="m4b">{t("m4b")}</option>
                  </select>
                </label>
              </div>
              {format === "m4b" && (
                <p className="notice">
                  {t("m4bHelp")}{" "}
                  <button onClick={onModels}>{t("models")}</button>
                </p>
              )}
              <button
                className="primary"
                disabled={busy || book.settings.engine === "device"}
                onClick={() =>
                  run(async () => {
                    setExportProgress({ current: 0, total: 1 });
                    try {
                      await api.exportAudio(
                        book,
                        exportScope || String(chapter),
                        format,
                        setExportProgress,
                      );
                    } finally {
                      setExportProgress(null);
                    }
                  })
                }
              >
                <Download size={18} />
                {t(exportProgress ? "exporting" : "downloadAudio")}
              </button>
              {exportProgress && (
                <>
                  <progress
                    value={exportProgress.current}
                    max={exportProgress.total}
                    aria-label={t("exporting")}
                  />
                  <button onClick={() => api.refs.current.cancelExport?.()}>
                    {t("cancel")}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
        <aside className="player-panel" aria-label={t("play")}>
          <div className="player-book">
            <p className="eyebrow">
              {t(
                playback.status === "idle"
                  ? "ready"
                  : playback.status === "gesture"
                    ? "tapAudio"
                    : playback.status,
              )}
            </p>
            <h2>{playback.row?.title || c.title}</h2>
            <small>{book.author}</small>
          </div>
          <div className="player-controls">
            <button
              className="icon-button"
              aria-label={t("previous")}
              onClick={() =>
                book.settings.engine === "device"
                  ? api.refs.current.speech.previous()
                  : api.refs.current.player.next(-1)
              }
              disabled={!playback.row}
            >
              <SkipBack size={21} />
            </button>
            <button
              className="play-button"
              aria-label={t(
                playback.status === "playing"
                  ? "pause"
                  : playback.status === "gesture"
                    ? "tapAudio"
                    : "play",
              )}
              onClick={() => api.togglePlayback(book)}
            >
              {playback.status === "playing" ? (
                <Pause size={23} />
              ) : (
                <Play size={23} />
              )}
            </button>
            <button
              className="icon-button"
              aria-label={t("next")}
              onClick={() =>
                book.settings.engine === "device"
                  ? api.refs.current.speech.next()
                  : api.refs.current.player.next(1)
              }
              disabled={!playback.row}
            >
              <SkipForward size={21} />
            </button>
          </div>
          <div className="player-timing">
            <span>{duration(playback.time)}</span>
            <input
              aria-label={t("play")}
              type="range"
              min="0"
              max={playback.duration || 1}
              step=".1"
              value={Math.min(playback.time || 0, playback.duration || 1)}
              onChange={(e) => {
                api.refs.current.player.audio.currentTime = Number(
                  e.target.value,
                );
              }}
              disabled={book.settings.engine === "device" || !playback.duration}
            />
            <span>{duration(playback.duration)}</span>
          </div>
          <div className="chapter-ticks" aria-label={t("chapters")}>
            {book.chapters.map((ch, i) => (
              <button
                key={i}
                style={{ flex: Math.max(1, ch.sentences.length) }}
                className={i === chapter ? "selected" : ""}
                aria-label={ch.title}
                title={ch.title}
                onClick={() => listen(i, 0)}
              />
            ))}
          </div>
          <div className="player-options">
            <label>
              {t("playbackSpeed")}
              <select
                defaultValue="1"
                onChange={(e) =>
                  api.refs.current.player.setRate(Number(e.target.value))
                }
                disabled={book.settings.engine === "device"}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((n) => (
                  <option value={n} key={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("sleep")}
              <select
                defaultValue="0"
                onChange={(e) =>
                  api.refs.current.player.sleep(Number(e.target.value))
                }
                disabled={book.settings.engine === "device"}
              >
                <option value="0">{t("sleepOff")}</option>
                {[15, 30, 60].map((n) => (
                  <option key={n} value={n}>
                    {t("minutes", { n })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {book.settings.engine !== "device" && (
            <div className="preparation-panel">
              <div
                className="ink-buffer"
                aria-label={t("readyBuffer", {
                  ready: buffer.count,
                  required: buffer.required,
                })}
              >
                {Array.from({ length: buffer.required }, (_, i) => (
                  <span key={i} className={i < buffer.count ? "inked" : ""} />
                ))}
              </div>
              <small>
                {t("readyBuffer", {
                  ready: buffer.count,
                  required: buffer.required,
                })}
              </small>
              <div className="preparation-total">
                <span>
                  {t(
                    preparation.status === "preparing"
                      ? "preparing"
                      : preparation.status === "complete"
                        ? "complete"
                        : "progressLabel",
                  )}
                </span>
                <strong>
                  {prepared} / {total}
                </strong>
              </div>
              <progress
                aria-label={t("progressLabel")}
                value={prepared}
                max={total}
              />
              <button
                className="prepare-button"
                onClick={() => {
                  if (preparation.status === "preparing")
                    api.refs.current.queue.pause();
                  else
                    api.refs.current.queue
                      .prepare(book.id, chapter, 0)
                      .catch((e) => api.setError(e.message));
                }}
              >
                {preparation.status === "preparing" ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}{" "}
                {t(
                  preparation.status === "preparing"
                    ? "pausePreparation"
                    : preparation.status === "paused"
                      ? "resumePreparation"
                      : "prepare",
                )}
              </button>
              {preparation.rtf !== undefined && (
                <p className="performance-note" title={t("rtfHelp")}>
                  {t("rtf", { rtf: preparation.rtf.toFixed(2) })}
                  {preparation.eta > 0 && (
                    <small>
                      {t("eta", { time: duration(preparation.eta) })}
                    </small>
                  )}
                  {preparation.rtf > 1 && (
                    <small className="warning">{t("slow")}</small>
                  )}
                </p>
              )}
              <p className="fine-print">{t("preparingNote")}</p>
            </div>
          )}
          <button
            className="text-button player-voice-link"
            onClick={() => setTab("voice")}
          >
            <SlidersHorizontal size={15} />
            {t("voice")}
          </button>
        </aside>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {t(playback.status === "gesture" ? "tapAudio" : playback.status)}{" "}
        {prepared} {t("sentences")} {t("prepared")}
      </span>
      {editor && (
        <Modal
          title={t("editSentence")}
          closeLabel={t("close")}
          onClose={() => setEditor(null)}
        >
          <p className="muted">
            {t("editHelp")} {t("splitHelp")}
          </p>
          <label>
            {t("editText")}
            <textarea
              rows={7}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              maxLength={8000}
            />
          </label>
          <label>
            {t("speaker")}
            <select
              value={speaker}
              onChange={(e) => setSpeaker(e.target.value)}
            >
              <option value="">{t("narrator")}</option>
              {book.characters.characters.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || !editText.trim()}
              onClick={() =>
                run(async () => {
                  await api.edit(
                    book.id,
                    editor.chapter,
                    editor.sentence,
                    editText,
                    speaker,
                  );
                  setEditor(null);
                  toast(t("sentenceSaved"));
                })
              }
            >
              {t("save")}
            </button>
            <button
              disabled={busy || book.settings.engine === "device"}
              onClick={() =>
                run(async () => {
                  await api.edit(
                    book.id,
                    editor.chapter,
                    editor.sentence,
                    editText,
                    speaker,
                  );
                  await api.regenerate(
                    book.id,
                    editor.chapter,
                    editor.sentence,
                  );
                  setEditor(null);
                })
              }
            >
              {t("regenerate")}
            </button>
          </div>
        </Modal>
      )}
      {review !== null && (
        <Modal
          title={t("manual")}
          closeLabel={t("close")}
          onClose={() => setReview(null)}
        >
          <label>
            {t("title")}
            <input
              value={reviewTitle}
              onChange={(e) => setReviewTitle(e.target.value)}
            />
          </label>
          <label>
            {t("sectionKind")}
            <select
              value={reviewKind}
              onChange={(e) => setReviewKind(e.target.value)}
            >
              {["chapter", "front_matter", "back_matter", "unclassified"].map(
                (k) => (
                  <option key={k} value={k}>
                    {t(k === "chapter" ? "chapterKind" : k)}
                  </option>
                ),
              )}
            </select>
          </label>
          <p className="muted">{book.analysis.sections[review].excerpt}</p>
          <div className="button-row">
            <button
              className="primary"
              onClick={() =>
                run(async () => {
                  const updated = applySectionReview(book, review, {
                    title: reviewTitle,
                    kind: reviewKind,
                  });
                  await api.update(book.id, {
                    chapters: updated.chapters,
                    analysis: updated.analysis,
                  });
                  setReview(null);
                  toast(t("sectionSaved"));
                })
              }
            >
              {t("save")}
            </button>
            <button
              onClick={() =>
                run(async () => {
                  await api.update(book.id, {
                    startChapter: review,
                    position: { chapter: review, sentence: 0 },
                  });
                  setReview(null);
                  show(review);
                })
              }
            >
              {t("setStart")}
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title={t("shortcuts")}
          closeLabel={t("close")}
          onClose={() => setHelp(false)}
        >
          <p>{t("shortcutsBody")}</p>
        </Modal>
      )}
    </main>
  );
}
function highlight(text, terms) {
  if (!terms?.length) return text;
  const pattern = new RegExp(
    `(${terms.map((s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})`,
    "giu",
  );
  return text
    .split(pattern)
    .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}
