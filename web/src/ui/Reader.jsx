import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft,
  BookOpen,
  Search,
  SlidersHorizontal,
  Download,
  Play,
  Bookmark,
  PenLine,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Menu,
  Trash2,
  Check,
  Volume2,
  Copy,
  X,
  Keyboard,
  Plus,
  Maximize2,
  Minimize2,
  LoaderCircle,
} from "lucide-react";
import Modal from "./Modal";
import PlayerPanel from "./PlayerPanel";
import { fold, findMatches, highlightParts, MIN_QUERY } from "./find";
import { voicesFor, modelFor } from "../offline/engines";
import { progressOf } from "../offline/format";
import { applySectionReview } from "../browser/analysis";

const MEASURES = { narrow: "28em", medium: "34em", wide: "42em" };
const TABS = [
  ["read", BookOpen],
  ["explore", Search],
  ["voice", SlidersHorizontal],
  ["export", Download],
];

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query),
      change = () => setMatches(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, [query]);
  return matches;
}

export default function Reader({
  book,
  api,
  t,
  prefs,
  setPref,
  focus,
  setFocus,
  toolsOpen,
  onBack,
  onDelete,
  onModels,
  toast,
}) {
  const [chapter, setChapter] = useState(book.position.chapter),
    [tab, setTab] = useState("read"),
    [drawer, setDrawer] = useState(false),
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
    [searching, setSearching] = useState(false),
    [analysis, setAnalysis] = useState(null),
    [exportScope, setExportScope] = useState(""),
    [format, setFormat] = useState("zip"),
    [exportProgress, setExportProgress] = useState(null),
    [busy, setBusy] = useState(false),
    [charName, setCharName] = useState(""),
    [findOpen, setFindOpen] = useState(false),
    [findQuery, setFindQuery] = useState(""),
    [findIndex, setFindIndex] = useState(0),
    [activeSentence, setActiveSentence] = useState(null),
    [voiceReady, setVoiceReady] = useState(null),
    [headingHeight, setHeadingHeight] = useState(0);
  const scroll = useRef(null),
    searchRef = useRef(null),
    findRef = useRef(null),
    searchWorker = useRef(null),
    drawerRef = useRef(null),
    tabRefs = useRef({}),
    heading = useRef(null),
    searchSequence = useRef(0),
    restoring = useRef(true);
  const narrow = useMediaQuery("(max-width: 1099px)"),
    compact = narrow || focus;
  const c = book.chapters[chapter] || book.chapters[0],
    position =
      api.playback.bookId === book.id && api.playback.row
        ? api.playback.row
        : book.position;
  const sentences = c.sentences,
    virtual = useVirtualizer({
      count: sentences.length,
      getScrollElement: () => scroll.current,
      estimateSize: () => prefs.textSize * 3.4,
      overscan: 8,
      paddingStart: 40,
      scrollMargin: headingHeight,
    });
  const playback =
      api.playback.bookId === book.id ? api.playback : { status: "idle" },
    preparation =
      api.preparation.bookId === book.id ? api.preparation : { status: "idle" };
  const voices = voicesFor(
    book.settings.engine,
    book.language,
    api.deviceVoices,
  );
  const percent = progressOf({ ...book, position });

  // Find in book
  const foldedBook = useMemo(
    () => (findOpen ? book.chapters.map((ch) => ch.sentences.map(fold)) : []),
    [book.chapters, findOpen],
  );
  const deferredFind = useDeferredValue(findQuery);
  const matches = useMemo(
    () => findMatches(foldedBook, deferredFind),
    [foldedBook, deferredFind],
  );
  const match = matches[findIndex];
  const findActive = findOpen && deferredFind.trim().length >= MIN_QUERY;

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
  const openFind = () => {
    setTab("read");
    setFindOpen(true);
    setTimeout(() => {
      findRef.current?.focus();
      findRef.current?.select();
    }, 30);
  };
  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
  };
  const stepFind = (delta) => {
    if (!matches.length) return;
    const next = (findIndex + delta + matches.length) % matches.length;
    setFindIndex(next);
    show(matches[next].chapter, matches[next].sentence);
  };
  // Jump to the first match at or after the current section as the query changes.
  useEffect(() => {
    if (!matches.length) return;
    const first = Math.max(
      0,
      matches.findIndex((m) => m.chapter >= chapter),
    );
    setFindIndex(first);
    show(matches[first].chapter, matches[first].sentence);
  }, [matches]);

  // The chapter heading scrolls with the text; the list starts below it.
  useEffect(() => {
    if (!heading.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeadingHeight(entry.target.offsetHeight),
    );
    observer.observe(heading.current);
    return () => observer.disconnect();
  }, [tab]);
  useEffect(() => {
    let live = true;
    if (book.settings.engine === "device") setVoiceReady(voices.length > 0);
    else
      api.refs.current.assets
        .status(
          modelFor(
            book.settings.engine,
            book.settings.voice,
            book.settings.device,
          ),
        )
        .then((s) => live && setVoiceReady(s.ready))
        .catch(() => live && setVoiceReady(null));
    return () => {
      live = false;
    };
  }, [
    book.settings.engine,
    book.settings.voice,
    book.settings.device,
    toolsOpen,
    voices.length,
  ]);
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
    setSearching(!!query.trim());
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
        if (data.id === searchSequence.current) {
          setHits(data.hits);
          setSearching(false);
        }
      };
      searchWorker.current.postMessage({ id, query, chapter: filter, vector });
    }, 180);
    return () => clearTimeout(timer);
  }, [query, filter, searchMode, book.semantics]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [chapter]);
  useEffect(() => {
    if (tab !== "read" || chapter !== book.position.chapter) return;
    const timer = setTimeout(() => {
      virtual.scrollToIndex(book.position.sentence, { align: "start" });
      setTimeout(() => (restoring.current = false), 300);
    }, 70);
    return () => clearTimeout(timer);
  }, [book.id, tab]);
  // Remember the reading position while the reader scrolls without audio.
  useEffect(() => {
    const element = scroll.current;
    if (!element || tab !== "read") return;
    let timer;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (restoring.current || api.playback.status === "playing") return;
        const top = element.scrollTop + 48,
          item = virtual.getVirtualItems().find((i) => i.end > top);
        if (!item) return;
        const current = api.refs.current.store.get(book.id)?.position;
        if (
          current &&
          current.chapter === chapter &&
          current.sentence === item.index
        )
          return;
        api
          .update(book.id, {
            position: { chapter, sentence: item.index },
          })
          .catch(() => {});
      }, 700);
    };
    element.addEventListener("scroll", save, { passive: true });
    return () => {
      clearTimeout(timer);
      element.removeEventListener("scroll", save);
    };
  }, [chapter, tab, book.id, api.playback.status]);
  useEffect(() => {
    if (!drawer) return;
    const previous = document.activeElement;
    const focusable = () =>
      [...drawerRef.current.querySelectorAll("button,a[href]")].filter(
        (el) => el.getClientRects().length,
      );
    (
      drawerRef.current.querySelector('[aria-current="page"]') || focusable()[0]
    )?.focus();
    const key = (e) => {
      if (e.key === "Escape") setDrawer(false);
      if (e.key === "Tab") {
        const els = focusable(),
          first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [drawer]);
  useEffect(() => {
    if (!compact) setDrawer(false);
  }, [compact]);
  useEffect(() => {
    if (focus) setTab("read");
  }, [focus]);
  useEffect(() => {
    if (playback.status === "playing" && playback.row) {
      if (playback.row.chapter !== chapter) setChapter(playback.row.chapter);
      else virtual.scrollToIndex(playback.row.sentence, { align: "center" });
    }
  }, [playback.row?.id, playback.status]);
  useEffect(() => {
    const key = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        openFind();
        return;
      }
      if (e.key === "F3" && findOpen) {
        e.preventDefault();
        stepFind(e.shiftKey ? -1 : 1);
        return;
      }
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.target.closest(
          "input,select,textarea,button,[contenteditable],dialog,.popover",
        )
      )
        return;
      if (e.key === "Escape") {
        if (findOpen) closeFind();
        else if (focus) setFocus(false);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        api.togglePlayback(book);
      }
      if (e.key === "?") setHelp(true);
      if (e.key === "/") {
        e.preventDefault();
        openFind();
      }
      if (e.key.toLowerCase() === "f" && !e.shiftKey) setFocus(!focus);
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
  }, [book, playback, findOpen, matches, findIndex, focus]);
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
  const tabKey = (e, index) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? TABS.length - 1
          : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[TABS[next][0]]?.focus();
  };
  const renderText = (text, isMatch) =>
    findActive && isMatch
      ? highlightParts(text, deferredFind).map((part, i) =>
          part.match ? <mark key={i}>{part.text}</mark> : part.text,
        )
      : text;
  const matchSet = useMemo(
    () =>
      new Set(
        findActive
          ? matches.filter((m) => m.chapter === chapter).map((m) => m.sentence)
          : [],
      ),
    [matches, chapter, findActive],
  );
  return (
    <main
      className={`reader-room ${compact ? "compact" : ""} ${focus ? "is-focus" : ""}`}
    >
      <div className="reader-bar">
        <button
          className="ghost small back-button"
          onClick={onBack}
          aria-label={t("back")}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          <span className="bar-label">{t("library")}</span>
        </button>
        <div className="reader-title">
          <span className="reader-book-title">{book.title}</span>
          <span className="reader-meta">
            {t("sectionOf", {
              current: chapter + 1,
              total: book.chapters.length,
            })}
            {" · "}
            {t("bookProgress", { percent })}
          </span>
        </div>
        <div className="reader-actions">
          {compact && (
            <button
              className="icon-button"
              onClick={() => setDrawer(true)}
              aria-label={t("chapters")}
              aria-expanded={drawer}
              title={t("chapters")}
            >
              <Menu size={18} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => (findOpen ? closeFind() : openFind())}
            aria-label={t("find")}
            aria-pressed={findOpen}
            title={`${t("find")} (/)`}
          >
            <Search size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setFocus(!focus)}
            aria-label={t(focus ? "exitFocus" : "focusMode")}
            aria-pressed={focus}
            title={`${t(focus ? "exitFocus" : "focusMode")} (F)`}
          >
            {focus ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button
            className="icon-button wide-only"
            aria-label={t("shortcuts")}
            title={`${t("shortcuts")} (?)`}
            onClick={() => setHelp(true)}
          >
            <Keyboard size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => onDelete(book)}
            aria-label={t("remove")}
            title={t("remove")}
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
      <div className="reading-progress" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="reader-layout">
        {drawer && (
          <div
            className="drawer-backdrop"
            aria-hidden="true"
            onClick={() => setDrawer(false)}
          />
        )}
        <nav
          ref={drawerRef}
          role={drawer ? "dialog" : undefined}
          aria-modal={drawer ? "true" : undefined}
          className={`chapter-drawer ${drawer ? "open" : ""}`}
          aria-label={t("chapters")}
          hidden={compact && !drawer}
        >
          <div className="drawer-heading">
            <h2 className="eyebrow">{t("chapters")}</h2>
            {compact && (
              <button
                className="icon-button small"
                onClick={() => setDrawer(false)}
                aria-label={t("close")}
              >
                <X size={18} />
              </button>
            )}
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
                    <span className="chapter-number">{index + 1}</span>
                    <span className="chapter-text">
                      <span className="chapter-name">{ch.title}</span>
                      {(["front_matter", "back_matter"].includes(
                        section?.kind,
                      ) ||
                        count > 0 ||
                        index === book.startChapter) && (
                        <small>
                          {["front_matter", "back_matter"].includes(
                            section?.kind,
                          ) && <span>{t(section.kind)}</span>}
                          {index === book.startChapter && (
                            <span>{t("start")}</span>
                          )}
                          {count > 0 && (
                            <span>
                              {count === ch.sentences.length ? (
                                <Check size={12} aria-hidden="true" />
                              ) : null}
                              {t("audioReady", {
                                n: count,
                                total: ch.sentences.length,
                              })}
                            </span>
                          )}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="drawer-bookmarks">
            <h2 className="eyebrow">{t("bookmarks")}</h2>
            {!(book.bookmarks || []).length ? (
              <p className="fine-print">{t("noBookmarks")}</p>
            ) : (
              book.bookmarks.map((id) => {
                const [ch, s] = id.split(":").map(Number);
                return (
                  <button
                    className="bookmark-link"
                    key={id}
                    onClick={() => show(ch, s)}
                  >
                    <Bookmark size={14} aria-hidden="true" />
                    <span>{book.chapters[ch]?.sentences[s]?.slice(0, 90)}</span>
                  </button>
                );
              })
            )}
          </div>
        </nav>
        <section className="reader-center">
          <div className="reader-tabs" role="tablist" aria-label={book.title}>
            {TABS.map(([id, Icon], index) => (
              <button
                key={id}
                ref={(el) => (tabRefs.current[id] = el)}
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(e) => tabKey(e, index)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{t(id)}</span>
              </button>
            ))}
          </div>
          {tab === "read" && (
            <div
              className="read-panel"
              role="tabpanel"
              id="panel-read"
              aria-labelledby="tab-read"
            >
              {findOpen && (
                <div className="find-bar" role="search">
                  <label className="search-field">
                    <Search size={16} aria-hidden="true" />
                    <span className="sr-only">{t("find")}</span>
                    <input
                      ref={findRef}
                      type="search"
                      value={findQuery}
                      placeholder={t("findPlaceholder")}
                      maxLength={200}
                      onChange={(e) => setFindQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          stepFind(e.shiftKey ? -1 : 1);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          closeFind();
                        }
                      }}
                    />
                  </label>
                  <span className="find-count" role="status">
                    {findActive
                      ? matches.length
                        ? t("findCount", {
                            current: findIndex + 1,
                            total:
                              matches.length >= 5000 ? "5000+" : matches.length,
                          })
                        : t("findNone")
                      : ""}
                  </span>
                  <button
                    className="icon-button small"
                    aria-label={t("findPrevious")}
                    disabled={!matches.length}
                    onClick={() => stepFind(-1)}
                  >
                    <ChevronUp size={18} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={t("findNext")}
                    disabled={!matches.length}
                    onClick={() => stepFind(1)}
                  >
                    <ChevronDown size={18} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={t("closeFind")}
                    onClick={closeFind}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              <div
                className="reading-scroll"
                ref={scroll}
                style={{
                  "--reading-size": `${prefs.textSize}px`,
                  "--measure": MEASURES[prefs.width] || MEASURES.medium,
                }}
              >
                <header className="reading-heading" ref={heading}>
                  <p className="eyebrow">
                    {t("sectionOf", {
                      current: chapter + 1,
                      total: book.chapters.length,
                    })}
                  </p>
                  <h1>{c.title}</h1>
                </header>
                <div
                  className="sentence-virtual"
                  style={{ height: virtual.getTotalSize() }}
                >
                  {virtual.getVirtualItems().map((item) => {
                    const s = item.index,
                      id = `${chapter}:${s}`,
                      isReady = !!book.prepared[id],
                      current =
                        ["playing", "paused", "starting"].includes(
                          playback.status,
                        ) &&
                        playback.row?.chapter === chapter &&
                        playback.row.sentence === s,
                      marked = book.bookmarks?.includes(id),
                      isMatch = matchSet.has(s),
                      currentMatch =
                        findActive &&
                        match?.chapter === chapter &&
                        match.sentence === s;
                    return (
                      <div
                        data-index={s}
                        ref={virtual.measureElement}
                        className={`sentence ${current ? "speaking" : ""} ${currentMatch ? "find-current" : ""} ${activeSentence === s ? "active" : ""}`}
                        key={s}
                        style={{
                          transform: `translateY(${item.start - headingHeight}px)`,
                        }}
                        data-ready={isReady}
                        data-sentence={id}
                        onClick={() => {
                          if (!getSelection()?.toString()) setActiveSentence(s);
                        }}
                      >
                        <span className="sentence-gutter" aria-hidden="true">
                          {current ? (
                            <Volume2 size={14} />
                          ) : marked ? (
                            <Bookmark size={13} />
                          ) : isReady ? (
                            <span className="ink-dot" />
                          ) : null}
                        </span>
                        <p
                          className="sentence-text"
                          aria-current={current ? "true" : undefined}
                        >
                          {renderText(sentences[s], isMatch)}
                        </p>
                        <div className="sentence-tools">
                          <button
                            className="icon-button small"
                            aria-label={`${t("listenHere")} · ${s + 1}`}
                            title={t("listenHere")}
                            onClick={() => listen(chapter, s)}
                          >
                            <Play size={15} />
                          </button>
                          <button
                            className={`icon-button small ${marked ? "marked" : ""}`}
                            aria-label={`${t("bookmark")} · ${s + 1}`}
                            title={t("bookmark")}
                            aria-pressed={!!marked}
                            onClick={() => bookmark(chapter, s)}
                          >
                            <Bookmark
                              size={15}
                              fill={marked ? "currentColor" : "none"}
                            />
                          </button>
                          <button
                            className="icon-button small"
                            aria-label={`${t("editSentence")} · ${s + 1}`}
                            title={t("editSentence")}
                            onClick={() => {
                              setEditor({ chapter, sentence: s });
                              setEditText(sentences[s]);
                              setSpeaker(book.characters?.speakers[id] || "");
                            }}
                          >
                            <PenLine size={15} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <nav className="page-navigation" aria-label={t("chapters")}>
                  <button
                    disabled={chapter === 0}
                    onClick={() => show(chapter - 1)}
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                    <span>
                      <small>{t("previousChapter")}</small>
                      {chapter > 0 && (
                        <span className="nav-title">
                          {book.chapters[chapter - 1].title}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    disabled={chapter === book.chapters.length - 1}
                    onClick={() => show(chapter + 1)}
                  >
                    <span>
                      <small>{t("nextChapter")}</small>
                      {chapter < book.chapters.length - 1 && (
                        <span className="nav-title">
                          {book.chapters[chapter + 1].title}
                        </span>
                      )}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </div>
          )}
          {tab === "explore" && (
            <div
              className="panel-scroll explore-panel"
              role="tabpanel"
              id="panel-explore"
              aria-labelledby="tab-explore"
            >
              <section className="panel-section">
                <h2>{t("search")}</h2>
                <p className="muted">{t("searchNotice")}</p>
                <label className="search-field">
                  <Search size={18} aria-hidden="true" />
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
                    {t("chapter")}
                    <select
                      aria-label={t("chapter")}
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
                    {t("searchMode")}
                    <select
                      aria-label={t("searchMode")}
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
                  aria-busy={searching}
                >
                  {query.trim() &&
                    (searching ? (
                      <p className="search-status">
                        <LoaderCircle
                          className="spin"
                          size={16}
                          aria-hidden="true"
                        />
                        {t("searching")}
                      </p>
                    ) : hits.length ? (
                      <p className="search-status">
                        {t(hits.length === 1 ? "resultOne" : "results", {
                          n: hits.length > 40 ? "40+" : hits.length,
                        })}
                      </p>
                    ) : (
                      <p className="no-evidence">{t("noEvidence")}</p>
                    ))}
                  {hits.slice(0, 40).map((hit) => (
                    <article key={hit.citation}>
                      <div className="hit-heading">
                        <span className="match-badge">{t(hit.match)}</span>
                        <small>
                          {hit.title} · {hit.citation}
                        </small>
                      </div>
                      <p>{highlight(hit.text, hit.matchedTerms)}</p>
                      {hit.context && (
                        <small className="muted">{hit.context}</small>
                      )}
                      <div className="hit-actions">
                        <button
                          className="small"
                          onClick={() => show(hit.chapter, hit.sentence)}
                        >
                          <BookOpen size={15} aria-hidden="true" />
                          {t("showSource")}
                        </button>
                        <button
                          className="small"
                          onClick={() => listen(hit.chapter, hit.sentence)}
                        >
                          <Play size={15} aria-hidden="true" />
                          {t("listenHere")}
                        </button>
                        <button
                          className="icon-button small"
                          aria-label={t("copyCitation")}
                          title={t("copyCitation")}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(
                                `${book.title} · ${hit.citation} · ${book.chapters[hit.chapter].source}\n${hit.text}`,
                              );
                              toast(t("copied"));
                            } catch {
                              api.setError("clipboardFailed");
                            }
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="panel-section">
                <h2>{t("structure")}</h2>
                <p className="muted">{t("structureHelp")}</p>
                <div className="structure-ribbon" aria-hidden="true">
                  {book.analysis.sections.map((s) => (
                    <span
                      key={s.index}
                      className={s.kind}
                      title={s.title}
                      style={{ flex: Math.max(1, Math.sqrt(s.wordCount)) }}
                    />
                  ))}
                </div>
                <details className="structure-details">
                  <summary>
                    {t("reviewSections", {
                      n: book.analysis.sections.length,
                      review: book.analysis.reviewCount,
                    })}
                  </summary>
                  {book.analysis.sections.map((s) => (
                    <div className="structure-row" key={s.index}>
                      <div>
                        <strong>{s.title}</strong>
                        <small>
                          {t(s.kind === "chapter" ? "chapterType" : s.kind)} ·{" "}
                          {t(s.confidence)} · {t(s.reason)}
                          {s.sourceAnchor && <> · {s.sourceAnchor}</>}
                        </small>
                        {s.flags.map((f) => (
                          <small className="warning" key={f}>
                            {t(f)}
                          </small>
                        ))}
                      </div>
                      <button
                        className="icon-button small"
                        onClick={() => {
                          setReview(s.index);
                          setReviewTitle(s.title);
                          setReviewKind(s.kind);
                        }}
                        aria-label={`${t("editSection")} · ${s.title}`}
                        title={t("editSection")}
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
              </section>
              <section className="panel-section optional-analysis">
                <h2>{t("optionalAnalysis")}</h2>
                <p className="muted">{t("analysisNotice")}</p>
                <div className="button-row">
                  <button
                    disabled={!!analysis}
                    onClick={() => analyze("embeddings")}
                  >
                    {book.semantics && <Check size={16} aria-hidden="true" />}
                    {t("semanticIndex")}
                  </button>
                  <button disabled={!!analysis} onClick={() => analyze("ner")}>
                    {book.entities && <Check size={16} aria-hidden="true" />}
                    {t("nerIndex")}
                  </button>
                  <button className="text-button" onClick={onModels}>
                    {t("models")}
                  </button>
                </div>
                {analysis && (
                  <div className="inline-progress">
                    <progress
                      value={analysis.current}
                      max={analysis.total}
                      aria-label={t("indexing")}
                    />
                    <button
                      className="small"
                      onClick={() => api.refs.current.cancelAnalysis?.()}
                    >
                      {t("cancelAnalysis")}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "voice" && (
            <div
              className="panel-scroll voice-panel"
              role="tabpanel"
              id="panel-voice"
              aria-labelledby="tab-voice"
            >
              <section className="panel-section">
                <h2>{t("voice")}</h2>
                <p className="muted">{t("voiceLocal")}</p>
                <div className="form-grid">
                  <label>
                    {t("bookLanguage")}
                    <select
                      aria-label={t("bookLanguage")}
                      value={book.language}
                      onChange={(e) =>
                        run(() => api.changeLanguage(book.id, e.target.value))
                      }
                    >
                      <option value="en">English</option>
                      <option value="es">Español</option>
                    </select>
                  </label>
                  <label>
                    {t("engine")}
                    <select
                      aria-label={t("engine")}
                      value={book.settings.engine}
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
                      <option
                        value={book.language === "es" ? "piper" : "kokoro"}
                      >
                        {t(book.language === "es" ? "piper" : "kokoro")}
                      </option>
                      <option value="supertonic">{t("supertonic")}</option>
                      <option value="device">{t("device")}</option>
                    </select>
                  </label>
                  <label>
                    {t("voicePicker")}
                    <select
                      aria-label={t("voicePicker")}
                      value={book.settings.voice}
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
                        aria-label={t("execution")}
                        value={book.settings.device || "wasm"}
                        onChange={(e) =>
                          run(() =>
                            api.settings(book.id, { device: e.target.value }),
                          )
                        }
                      >
                        <option value="wasm">{t("wasm")}</option>
                        <option value="webgpu" disabled={!navigator.gpu}>
                          {t(navigator.gpu ? "webgpu" : "webgpuUnavailable")}
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
                      aria-label={t("buffer")}
                      value={book.settings.buffer}
                      onChange={(e) =>
                        api
                          .settings(book.id, {
                            buffer: Number(e.target.value),
                          })
                          .catch((e) => api.setError(e.message))
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
                  <p className="fine-print">{t("bufferHelp")}</p>
                )}
                {book.settings.engine === "supertonic" && (
                  <p className="notice">{t("supertonicNotice")}</p>
                )}
                <div className="button-row">
                  <button
                    onClick={() => run(() => api.preview(book))}
                    disabled={
                      busy ||
                      preparation.status === "preparing" ||
                      !voices.length
                    }
                  >
                    <Volume2 size={16} aria-hidden="true" />
                    {t("preview")}
                  </button>
                  {book.settings.engine !== "device" && (
                    <button onClick={onModels}>
                      <Download size={16} aria-hidden="true" />
                      {t("models")}
                    </button>
                  )}
                </div>
              </section>
              {book.settings.engine !== "device" && (
                <section className="panel-section casting-panel">
                  <h2>{t("cast")}</h2>
                  <p className="muted">{t("heuristicNotice")}</p>
                  {!book.characters?.characters.length && (
                    <p className="fine-print">{t("noCharacters")}</p>
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
                        aria-label={`${t("voicePicker")} · ${character.name}`}
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
                  <form
                    className="add-character"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!charName.trim()) return;
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
                      });
                    }}
                  >
                    <label>
                      <span className="sr-only">{t("characterName")}</span>
                      <input
                        value={charName}
                        onChange={(e) => setCharName(e.target.value)}
                        placeholder={t("characterName")}
                        maxLength={50}
                      />
                    </label>
                    <button type="submit" disabled={!charName.trim()}>
                      <Plus size={16} aria-hidden="true" />
                      {t("addCharacter")}
                    </button>
                  </form>
                </section>
              )}
            </div>
          )}
          {tab === "export" && (
            <div
              className="panel-scroll export-panel"
              role="tabpanel"
              id="panel-export"
              aria-labelledby="tab-export"
            >
              <section className="panel-section">
                <h2>{t("export")}</h2>
                <p className="muted">{t("exportHelp")}</p>
                <p className="eyebrow">
                  {t("preparedCount", {
                    n: Object.keys(book.prepared).length,
                    total: book.chapters.reduce(
                      (n, ch) => n + ch.sentences.length,
                      0,
                    ),
                  })}
                </p>
                <div className="form-grid">
                  <label>
                    {t("exportScope")}
                    <select
                      aria-label={t("exportScope")}
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
                    {t("exportFormat")}
                    <select
                      aria-label={t("exportFormat")}
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
                    <button className="text-button" onClick={onModels}>
                      {t("models")}
                    </button>
                  </p>
                )}
                {book.settings.engine === "device" && (
                  <p className="notice">{t("deviceExport")}</p>
                )}
                <div className="button-row">
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
                    {exportProgress ? (
                      <LoaderCircle
                        className="spin"
                        size={18}
                        aria-hidden="true"
                      />
                    ) : (
                      <Download size={18} aria-hidden="true" />
                    )}
                    {t(exportProgress ? "exporting" : "downloadAudio")}
                  </button>
                  {exportProgress && (
                    <button onClick={() => api.refs.current.cancelExport?.()}>
                      {t("cancel")}
                    </button>
                  )}
                </div>
                {exportProgress && (
                  <progress
                    value={exportProgress.current}
                    max={exportProgress.total}
                    aria-label={t("exporting")}
                  />
                )}
              </section>
            </div>
          )}
        </section>
        <PlayerPanel
          book={book}
          api={api}
          t={t}
          playback={playback}
          preparation={preparation}
          position={position}
          compact={compact}
          voiceReady={voiceReady}
          rate={prefs.rate}
          onRate={(rate) => {
            api.refs.current.player.setRate(rate);
            setPref("rate", rate);
          }}
          onModels={onModels}
          onVoice={() => setTab("voice")}
          listen={listen}
        />
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {t(
          playback.status === "gesture"
            ? "tapAudio"
            : playback.status === "idle"
              ? "ready"
              : playback.status,
        )}
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
              aria-label={t("speaker")}
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
          <div className="button-row modal-actions">
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
              aria-label={t("sectionKind")}
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
          <p className="muted excerpt">
            {book.analysis.sections[review].excerpt}
          </p>
          <div className="button-row modal-actions">
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
          </div>
        </Modal>
      )}
      {help && (
        <Modal
          title={t("shortcuts")}
          closeLabel={t("close")}
          onClose={() => setHelp(false)}
        >
          <dl className="shortcut-list">
            {[
              ["Space", "shortcutPlay"],
              ["/  ·  Ctrl F", "shortcutFind"],
              ["Enter  ·  Shift Enter", "shortcutFindStep"],
              ["J  ·  K", "shortcutSentence"],
              ["←  ·  →", "shortcutSeek"],
              ["F", "shortcutFocus"],
              ["Esc", "shortcutEscape"],
              ["?", "shortcutHelp"],
            ].map(([keys, label]) => (
              <div key={label}>
                <dt>
                  {keys.split("  ·  ").map((k, i) => (
                    <span key={k}>
                      {i > 0 && " / "}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{t(label)}</dd>
              </div>
            ))}
          </dl>
          <p className="fine-print">{t("shortcutsNote")}</p>
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
