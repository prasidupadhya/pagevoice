import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import {
  BookOpen,
  Headphones,
  Plus,
  Upload,
  Sun,
  Moon,
  Globe,
  Play,
  Download,
  Settings2,
  Mic,
  X,
  Check,
  RefreshCw,
  Pencil,
  Volume2,
  AlertCircle,
  ChevronRight,
  AudioLines,
  ShieldCheck,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import {
  api,
  apiURL,
  request,
  progressEvents,
  setAccessToken,
  uploadBook,
  API_BASE,
} from "./backends/ApiBackend";
import {
  POCKETBASE_URL,
  ensureGuestIdentity,
  markBookDeleted,
  purgeBookMetadata,
  purgeExpiredBookMetadata,
  restoreBookMetadata,
  saveBookMetadata,
} from "./pocketbase";
import { DeleteBook, UndoDeletion } from "./DeleteBook";
import LanguageNotice from "./LanguageNotice";
import { Casting } from "./Casting";
import { Listener, forwardRows, bufferStatus } from "./listener";
const BookAnalysis = lazy(() =>
  import("./BookAnalysis").then((m) => ({ default: m.BookAnalysis })),
);
import { SentenceList } from "./SentenceList";
import { BookCover } from "./BookCover";
import { ListeningPlayer } from "./ListeningPlayer";
import { registerProjectTools } from "./webmcp";
import { messages, preference, persist } from "./i18n";

export function Modal({ title, onClose, children, t }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={t.close}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function ErrorNotice({ error, t }) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <AlertCircle size={18} />
      <div>
        {t[error] || t.unexpected}
        {!t[error] && (
          <details>
            <summary>{t.showDetails}</summary>
            <p>{error}</p>
          </details>
        )}
      </div>
    </div>
  );
}

export function UploadDialog({ initialFile, onClose, onCreated, t }) {
  const [file, setFile] = useState(initialFile),
    [ocr, setOcr] = useState("auto"),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const controller = useRef(null),
    [percent, setPercent] = useState(0);
  useEffect(() => () => controller.current?.abort(), []);
  function closeUpload() {
    controller.current?.abort();
    onClose();
  }
  async function submit(e) {
    e.preventDefault();
    if (!file) {
      setError("fileRequired");
      return;
    }
    if (!/\.(pdf|epub)$/i.test(file.name) || file.size > 100 * 1024 * 1024) {
      setError("uploadError");
      return;
    }
    setPending(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    body.append("ocr", ocr);
    controller.current = new AbortController();
    setPercent(0);
    try {
      onCreated(
        await uploadBook(body, {
          signal: controller.current.signal,
          onProgress: setPercent,
        }),
      );
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <Modal title={t.upload} onClose={closeUpload} t={t}>
      <form onSubmit={submit} className="form-stack">
        <label className="file-field">
          {t.file}
          <input
            required={!file}
            type="file"
            accept=".pdf,.epub"
            onChange={(e) => setFile(e.target.files[0])}
          />
        </label>
        {file && (
          <p className="selected-file">
            <BookOpen size={18} />
            {file.name}
          </p>
        )}
        <p className="import-hint">{t.autoLanguageHint}</p>
        <details className="import-options">
          <summary>{t.importOptions}</summary>
          <label>
            {t.ocr}
            <select value={ocr} onChange={(e) => setOcr(e.target.value)}>
              <option value="auto">{t.auto}</option>
              <option value="always">{t.always}</option>
              <option value="never">{t.never}</option>
            </select>
          </label>
        </details>
        <ErrorNotice error={error} t={t} />
        {pending && (
          <label>
            {t.uploadProgress}: {percent}%<progress max="100" value={percent} />
          </label>
        )}
        <div className="actions">
          <button type="button" className="secondary" onClick={closeUpload}>
            {t.cancel}
          </button>
          <button className="primary" disabled={pending}>
            {pending ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Upload size={18} />
            )}{" "}
            {pending ? t.pending : t.import}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SentenceEditor({
  row,
  onClose,
  onSave,
  t,
  busy,
  speakers = [],
}) {
  const [text, setText] = useState(row.text),
    [speaker, setSpeaker] = useState(row.speaker || "Narrator");
  return (
    <Modal title={t.edit} onClose={onClose} t={t}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text, speaker);
        }}
      >
        <p className="muted">{t.editHint}</p>
        <label>
          {t.text}
          <textarea
            autoFocus
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={10000}
          />
        </label>
        <label>
          {t.speaker}
          <input
            list="speaker-options"
            value={speaker}
            onChange={(e) => setSpeaker(e.target.value)}
            maxLength={80}
            required
          />
          <datalist id="speaker-options">
            {speakers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <p className="small muted">{t.pauseHint}</p>
        <p className="small muted character-count">
          {text.length}/10000 {t.characters}
        </p>
        <div className="actions">
          <button className="secondary" type="button" onClick={onClose}>
            {t.cancel}
          </button>
          <button className="primary" disabled={busy || !text.trim()}>
            {t.regenerate}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function statusText(p, t) {
  if (p.status === "assembling") return t.finishingExport;
  if (p.job?.status === "queued") return t.queued;
  if (p.job?.status === "running")
    return p.job.kind === "prepare" ? t.preparing : t.working;
  if (p.status === "paused") return t.preparationPaused;
  if (p.status === "failed" || p.job?.status === "failed") return t.failed;
  return p.output ? t.ready : t.reviewing;
}

export default function App() {
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
  const t = messages[locale];
  useEffect(() => registerProjectTools(), []);
  const [projects, setProjects] = useState([]),
    [activeId, setActiveId] = useState(""),
    [project, setProject] = useState(null),
    [engines, setEngines] = useState([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [disconnected, setDisconnected] = useState(false),
    [pending, setPending] = useState(false);
  const [upload, setUpload] = useState(false),
    [uploadFile, setUploadFile] = useState(null),
    [editor, setEditor] = useState(null),
    [chapter, setChapter] = useState(0),
    [playing, setPlaying] = useState(null);
  const [settings, setSettings] = useState(null),
    [dirty, setDirty] = useState(false),
    [allowNetwork, setAllowNetwork] = useState(true);
  const [listenConsent, setListenConsent] = useState(null);
  const [startSentence, setStartSentence] = useState(0),
    [focusRequest, setFocusRequest] = useState(null),
    [textSize, setTextSize] = useState(
      () => Number(preference("pagevoice-text-size", 21)) || 21,
    );
  const [bookmarks, setBookmarks] = useState([]),
    [savedPosition, setSavedPosition] = useState(null),
    [sleep, setSleep] = useState(0),
    [help, setHelp] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState(""),
    [sort, setSort] = useState("title"),
    [languageFilter, setLanguageFilter] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [storage, setStorage] = useState(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    try {
      setBookmarks(
        JSON.parse(preference("pagevoice-bookmarks-" + activeId, "[]")),
      );
      setSavedPosition(
        JSON.parse(preference("pagevoice-position-" + activeId, "null")),
      );
    } catch {
      setBookmarks([]);
      setSavedPosition(null);
    }
    setSleep(0);
    setStartSentence(0);
  }, [activeId]);
  useEffect(() => {
    persist("pagevoice-text-size", textSize);
  }, [textSize]);
  useEffect(() => {
    if (!sleep) return;
    const timer = setTimeout(() => {
      listener.current?.pause();
      setSleep(0);
    }, sleep * 60000);
    return () => clearTimeout(timer);
  }, [sleep, activeId]);

  const [auth, setAuth] = useState(false),
    [token, setToken] = useState(""),
    [hosted, setHosted] = useState(false),
    [guestLibrary, setGuestLibrary] = useState(Boolean(POCKETBASE_URL)),
    [authError, setAuthError] = useState("");
  useEffect(() => {
    api("/api/health")
      .then((info) => setHosted(Boolean(info.hosted)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const required = () => {
      if (!POCKETBASE_URL) {
        setAuth(true);
        return;
      }
      ensureGuestIdentity()
        .then((identity) => {
          setAccessToken(identity.token);
          refresh();
        })
        .catch((error) => setError(error.message || t.guestSetupError));
    };
    window.addEventListener("pagevoice-auth", required);
    return () => window.removeEventListener("pagevoice-auth", required);
  }, [t.guestSetupError]);
  const [deleting, setDeleting] = useState(null),
    [undo, setUndo] = useState([]);
  const removed = useRef(new Set()),
    shelf = useRef(null),
    positions = useRef(new Map());
  useLayoutEffect(() => {
    const next = new Map();
    shelf.current?.querySelectorAll("[data-book]").forEach((node) => {
      const box = node.getBoundingClientRect(),
        previous = positions.current.get(node.dataset.book);
      next.set(node.dataset.book, box);
      if (
        previous &&
        !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      )
        node.animate?.(
          [
            {
              transform: `translate(${previous.x - box.x}px,${previous.y - box.y}px)`,
            },
            { transform: "none" },
          ],
          { duration: 200, easing: "ease-out" },
        );
    });
    positions.current = next;
  }, [projects]);
  const audio = useRef(null),
    intent = useRef(null),
    listener = useRef(null),
    listenRequest = useRef(0);
  const [listenStart, setListenStart] = useState(0),
    [listenState, setListenState] = useState({
      status: "idle",
      cursor: 0,
      ready: 0,
      target: 20,
      total: 0,
    });
  useEffect(() => {
    const engine = new Listener(setListenState);
    listener.current = engine;
    return () => {
      engine.onChange = () => {};
      engine.dispose();
    };
  }, [activeId]);
  useEffect(() => {
    listener.current?.update(forwardRows(project, listenStart, startSentence));
  }, [project, listenStart, startSentence]);
  useEffect(() => {
    if (listenState.status === "playing" && listenState.row)
      setChapter(listenState.row.chapter);
  }, [listenState.row?.chapter, listenState.status]);
  useEffect(() => {
    if (listenState.status === "playing" && listenState.row) {
      const position = {
        chapter: listenState.row.chapter,
        sentence: listenState.row.sentence,
      };
      persist("pagevoice-position-" + activeId, JSON.stringify(position));
      setSavedPosition(position);
    }
  }, [listenState.row?.id, listenState.status, activeId]);
  useEffect(() => {
    function key(e) {
      if (
        e.target.closest(
          "input,textarea,select,button,[contenteditable=true],dialog",
        ) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (e.key === "?") {
        setHelp(true);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.querySelector(".book-analysis")?.setAttribute("open", "");
        document.getElementById("book-query")?.focus();
        return;
      }
      if (!project) return;
      if (e.key === " ") {
        e.preventDefault();
        if (["playing", "buffering"].includes(listenState.status))
          listener.current?.pause();
        else if (["paused", "blocked"].includes(listenState.status))
          listener.current?.resume();
        else beginListening();
      }
      if (["j", "k", "ArrowRight", "ArrowLeft"].includes(e.key)) {
        e.preventDefault();
        const delta = ["j", "ArrowRight"].includes(e.key) ? 1 : -1;
        const rows = forwardRows(project, listenStart, startSentence),
          row =
            rows[
              Math.max(
                0,
                Math.min(rows.length - 1, (listenState.cursor || 0) + delta),
              )
            ];
        if (row) beginListening(row.chapter, allowNetwork, row.sentence);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [project, listenState, chapter, allowNetwork, dirty, pending]);
  useEffect(() => {
    document.documentElement.lang = locale;
    persist("pagevoice-locale", locale);
    document.title =
      locale === "es"
        ? "PageVoice · Tu biblioteca"
        : "PageVoice · Your listening library";
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persist("pagevoice-theme", theme);
  }, [theme]);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      // Keep existing token-protected servers usable. A public PocketBase
      // deployment requires its browser origin, but legacy private hosts do not.
      if (API_BASE && !POCKETBASE_URL) {
        const info = await api("/api/health");
        if (info.auth_mode === "pocketbase") throw Error(t.guestSetupError);
      }
      if (POCKETBASE_URL) {
        const identity = await ensureGuestIdentity();
        setAccessToken(identity.token);
        setGuestLibrary(true);
        await purgeExpiredBookMetadata();
      } else {
        setGuestLibrary(false);
      }
      const [books, available] = await Promise.all([
        api("/api/projects"),
        api("/api/engines"),
      ]);
      if (POCKETBASE_URL) {
        const synced = await Promise.allSettled(
          books.map((book) => saveBookMetadata(book)),
        );
        if (synced.some((result) => result.status === "rejected"))
          setNotice(t.librarySyncError);
      }
      setProjects(books);
      setEngines(available);
      api("/api/storage")
        .then(setStorage)
        .catch(() => {});
      const stored = preference("pagevoice-project", "");
      setActiveId((id) =>
        books.some((p) => p.id === id)
          ? id
          : books.some((p) => p.id === stored)
            ? stored
            : books[0]?.id || "",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    setAllowNetwork(true);
    if (!activeId) {
      setProject(null);
      return;
    }
    persist("pagevoice-project", activeId);
    setChapter(0);
    setPlaying(null);
    setProject(null);
    setDirty(false);
    setDisconnected(false);
    let closed = false,
      initial = true;
    function update(p) {
      if (closed || removed.current.has(p.id)) return;
      if (initial) {
        initial = false;
        setChapter(p.listening?.chapter || 0);
        setListenStart(p.listening?.chapter || 0);
      }
      setProject(p);
      if (POCKETBASE_URL)
        saveBookMetadata(p).catch(() => setNotice(t.librarySyncError));
      setProjects((all) =>
        all.some((x) => x.id === p.id)
          ? all.map((x) => (x.id === p.id ? p : x))
          : [p, ...all],
      );
      if (intent.current?.project === p.id && p.job?.status === "complete") {
        const action = intent.current;
        intent.current = null;
        if (action.kind === "preview" && p.chapters[action.chapter]?.preview)
          setPlaying({
            src: p.chapters[action.chapter].preview,
            label: p.chapters[action.chapter].title,
          });
      }
    }
    api("/api/projects/" + activeId)
      .then(update)
      .catch((e) => setError(e.message));
    const events = progressEvents(`/api/projects/${activeId}/events`);
    events.addEventListener("progress", (e) => {
      setDisconnected(false);
      update(JSON.parse(e.data));
    });
    events.addEventListener("deleted", () => {
      events.close();
      removeFromLibrary(activeId);
    });
    events.onopen = () => setDisconnected(false);
    events.onerror = () => setDisconnected(true);
    return () => {
      closed = true;
      events.close();
    };
  }, [activeId]);
  useEffect(() => {
    if (
      project?.chapters?.length &&
      ["en", "es"].includes(project.language) &&
      !dirty &&
      engines.length
    ) {
      const retired = !engines.some((e) => e.id === project.engine);
      const unavailable = !engines
        .find((e) => e.id === project.engine)
        ?.voices.some(
          (v) => v.id === project.voice && v.language === project.language,
        );
      setSettings({
        engine: retired ? "edge" : project.engine,
        voice:
          retired || unavailable
            ? project.language === "es"
              ? "es-ES-ElviraNeural"
              : "en-US-AriaNeural"
            : project.voice || "",
        format: project.format,
        device: "auto",
        pace: project.pace || 1,
      });
      if (retired || unavailable) setDirty(true);
    }
  }, [
    project?.engine,
    project?.voice,
    project?.format,
    project?.device,
    project?.pace,
    dirty,
    engines,
  ]);
  useEffect(() => {
    if (playing && audio.current) audio.current.load();
  }, [playing]);
  const busy = pending || ["queued", "running"].includes(project?.job?.status);
  const selectedEngine = engines.find((e) => e.id === settings?.engine);
  const voiceOptions = (selectedEngine?.voices || [])
    .filter((v) => v.language === project?.language)
    .map((v) => ({ ...v, name: v.name || v.id }));
  const readyEngine = selectedEngine?.installed;
  const selectedChapter = project?.chapters[chapter];
  const canListenDuringJob = ["render", "listen", "regen"].includes(
    project?.job?.kind,
  );
  const cachedListening = bufferStatus(forwardRows(project, chapter)).canStart;
  const listenDisabled =
    pending ||
    !selectedChapter ||
    (!readyEngine && !cachedListening) ||
    (busy && !canListenDuringJob);
  function stopDeleted(id) {
    if (id === activeId) {
      listenRequest.current++;
      intent.current = null;
      listener.current?.reset();
      audio.current?.pause();
      setPlaying(null);
    }
  }
  function removeFromLibrary(id) {
    persist("pagevoice-position-" + id, "null");
    persist("pagevoice-bookmarks-" + id, "[]");
    if (POCKETBASE_URL)
      markBookDeleted(id).catch(() => setNotice(t.librarySyncError));
    removed.current.add(id);
    stopDeleted(id);
    setProjects((all) => all.filter((p) => p.id !== id));
    setActiveId((current) => (current === id ? "" : current));
  }
  function deleted(receipt) {
    removeFromLibrary(receipt.id);
    setDeleting(null);
    setUndo((all) => [...all, receipt]);
  }
  function expired(id) {
    setUndo((all) => all.filter((p) => p.id !== id));
    if (POCKETBASE_URL)
      purgeBookMetadata(id).catch(() => setNotice(t.librarySyncError));
  }
  function restored(p) {
    removed.current.delete(p.id);
    setProjects((all) => [p, ...all.filter((x) => x.id !== p.id)]);
    setUndo((all) => all.filter((receipt) => receipt.id !== p.id));
    if (POCKETBASE_URL)
      restoreBookMetadata(p).catch(() => setNotice(t.librarySyncError));
    chooseProject(p.id);
  }
  function chooseProject(id) {
    listenRequest.current++;
    setListenConsent(null);
    setActiveId(id);
    setError("");
    setNotice("");
  }
  function openUpload(file = null) {
    setUploadFile(file);
    setUpload(true);
  }
  function updateSettings(key, value) {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      if (key === "engine")
        next.voice =
          engines
            .find((e) => e.id === value)
            ?.voices.find((v) => v.language === project.language)?.id || "";
      return next;
    });
    setDirty(true);
  }
  async function saveSettings() {
    listener.current?.reset();
    setPending(true);
    setError("");
    try {
      const p = await api(`/api/projects/${activeId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setProject(p);
      setDirty(false);
      setNotice(t.saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }
  async function runJob(kind, extra = {}) {
    setPending(true);
    setError("");
    setNotice("");
    intent.current = { project: activeId, kind, chapter };
    try {
      await api(`/api/projects/${activeId}/${kind}`, {
        method: "POST",
        body: JSON.stringify({ allow_network: allowNetwork, ...extra }),
      });
      setEditor(null);
      const p = await api("/api/projects/" + activeId);
      setProject(p);
    } catch (e) {
      setError(e.message);
      intent.current = null;
    } finally {
      setPending(false);
    }
  }
  async function changeCasting(path, body, method) {
    listener.current?.reset();
    setPending(true);
    setError("");
    try {
      const p = await api(`/api/projects/${activeId}/${path}`, {
        method,
        body: JSON.stringify(body),
      });
      setProject(p);
      setNotice(t.castSaved);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function saveSentence(text, speaker) {
    listener.current?.reset();
    if (speaker !== (editor.speaker || "Narrator")) {
      const saved = await changeCasting(
        "casting",
        { tags: { [editor.id]: speaker } },
        "PATCH",
      );
      if (!saved) return;
    }
    await runJob("regen", { sentence_id: editor.id, text });
  }
  async function beginListening(
    next = chapter,
    network = allowNetwork,
    sentence = 0,
  ) {
    if (pending) return;
    const activePreparation = busy && canListenDuringJob;
    const needsPreparation = dirty || !project.output;
    if (
      settings?.engine === "edge" &&
      !network &&
      !activePreparation &&
      needsPreparation
    ) {
      setListenConsent({ chapter: next, sentence });
      return;
    }
    const request = ++listenRequest.current;
    setPlaying(null);
    audio.current?.pause();
    setListenStart(next);
    setStartSentence(sentence);
    setError("");
    const rows = forwardRows(project, next, sentence);
    // Unlock audio in the click gesture, before settings/network work.
    listener.current?.start(
      dirty ? rows.map((r) => ({ ...r, ready: false })) : rows,
    );
    if (!readyEngine && bufferStatus(rows).canStart) return;
    setPending(true);
    try {
      if (dirty) {
        const saved = await api(`/api/projects/${activeId}/settings`, {
          method: "PATCH",
          body: JSON.stringify(settings),
        });
        if (request !== listenRequest.current) return;
        setProject(saved);
        setDirty(false);
      }
      const p = await api(`/api/projects/${activeId}/listen`, {
        method: "POST",
        body: JSON.stringify({
          chapter: next,
          ...(sentence ? { sentence } : {}),
          allow_network: network,
        }),
      });
      if (request === listenRequest.current) setProject(p);
    } catch (e) {
      if (request !== listenRequest.current) return;
      setError(e.message);
      listener.current?.reset();
    } finally {
      setPending(false);
    }
  }
  function selectChapter(next, sentence = null) {
    setChapter(next);
    setListenStart(next);
    setStartSentence(0);
    setPlaying(null);
    if (sentence !== null) {
      listener.current?.reset();
      setFocusRequest({
        id: `${String(next).padStart(4, "0")}-${String(sentence).padStart(5, "0")}`,
        time: Date.now(),
      });
      return;
    }
    if (
      (canListenDuringJob && busy) ||
      ["playing", "buffering", "paused"].includes(listenState.status)
    )
      beginListening(next);
  }
  async function previewVoice() {
    setPending(true);
    setError("");
    listener.current?.reset();
    try {
      const response = await request("/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: settings.engine,
          voice: settings.voice,
          language: project.language,
          speed: settings.pace || 1,
          response_format: "wav",
          allow_network: allowNetwork,
          input:
            project.language === "es"
              ? "Abre tu libro. Cada página es el comienzo de una nueva aventura."
              : "Open your book. Every page is the beginning of a new adventure.",
        }),
      });
      if (!response.ok) {
        const problem = await response.json();
        throw Error(problem.detail || "Audio unavailable");
      }
      const src = URL.createObjectURL(await response.blob());
      setPlaying({ src, label: t.voicePreview });
    } catch (e) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  }
  useEffect(
    () => () => {
      if (playing?.src?.startsWith("blob:")) URL.revokeObjectURL(playing.src);
    },
    [playing],
  );
  function toggleBookmark(id) {
    setBookmarks((previous) => {
      const next = previous.includes(id)
        ? previous.filter((x) => x !== id)
        : [...previous, id];
      persist("pagevoice-bookmarks-" + activeId, JSON.stringify(next));
      return next;
    });
  }
  const filteredProjects = projects
    .filter(
      (p) =>
        (!languageFilter || p.language === languageFilter) &&
        `${p.title} ${p.author}`
          .toLocaleLowerCase()
          .includes(libraryQuery.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "progress"
        ? (b.progress?.complete || 0) / (b.progress?.total || 1) -
          (a.progress?.complete || 0) / (a.progress?.total || 1)
        : a.title.localeCompare(b.title),
    );
  return (
    <>
      <a className="skip-link" href="#reading-area">
        {t.skip}
      </a>
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          PageVoice
        </a>
        <span className="local-badge">
          <ShieldCheck size={16} />
          {guestLibrary ? t.guestStorage : hosted ? t.hostedStorage : t.local}
        </span>
        <div className="top-controls">
          <span className="connection-state" role="status">
            {online ? t.online : t.offline}
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label={t.keyboardHelp}
          >
            ?
          </button>
          <label className="language-control">
            <Globe size={17} />
            <span className="sr-only">{t.language}</span>
            <select
              aria-label={t.language}
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </label>
          <button
            className="theme-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`${t.theme}: ${theme === "dark" ? t.light : t.dark}`}
            title={theme === "dark" ? t.light : t.dark}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <div className="app-layout">
        <aside
          className={`library-rail ${projects.length ? "" : "library-empty"}`}
        >
          <div className="rail-heading">
            <h2>{t.books}</h2>
            <button
              className="icon-button"
              aria-label={t.newBook}
              onClick={() => openUpload()}
            >
              <Plus size={19} />
            </button>
          </div>
          <div className="shelf-controls">
            <label className="sr-only" htmlFor="library-query">
              {t.librarySearch}
            </label>
            <input
              id="library-query"
              type="search"
              value={libraryQuery}
              placeholder={t.librarySearch}
              onChange={(e) => setLibraryQuery(e.target.value)}
            />
            <div>
              <select
                aria-label={t.sortBooks}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="title">{t.byTitle}</option>
                <option value="progress">{t.byProgress}</option>
              </select>
              <select
                aria-label={t.bookLanguage}
                value={languageFilter}
                onChange={(e) => setLanguageFilter(e.target.value)}
              >
                <option value="">{t.allLanguages}</option>
                <option value="en">EN</option>
                <option value="es">ES</option>
              </select>
            </div>
          </div>
          <nav ref={shelf} aria-label={t.library} className="project-list">
            {filteredProjects.map((p) => (
              <div key={p.id} data-book={p.id} className="library-entry">
                <button
                  className={`project-link ${p.id === activeId ? "selected" : ""}`}
                  onClick={() => chooseProject(p.id)}
                  aria-current={p.id === activeId ? "page" : undefined}
                >
                  <BookCover book={p} />
                  <span>
                    <strong>{p.title}</strong>
                    <small>{p.language === "es" ? "Español" : "English"}</small>
                  </span>
                  {p.id === activeId && <ChevronRight size={15} />}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${t.deleteBook}: ${p.title}`}
                  onClick={() => setDeleting(p)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </nav>
          {!!projects.length && !filteredProjects.length && (
            <p className="small muted">{t.emptyFilter}</p>
          )}
          {!projects.length && (
            <p className="small muted rail-empty">{t.noBooks}</p>
          )}
          <div className="rail-bottom">
            {storage?.bytes != null && (
              <p className="small muted">
                {t.storageUsed}: {(storage.bytes / 1024 ** 2).toFixed(1)} MB
              </p>
            )}
            <p className="small muted privacy-note">
              <ShieldCheck size={16} />
              {guestLibrary
                ? t.guestPrivacy
                : hosted
                  ? t.hostedPrivacy
                  : t.localHint}
            </p>
          </div>
        </aside>
        <main id="reading-area" className="main-area" tabIndex={-1}>
          <ErrorNotice error={error} t={t} />
          {notice && (
            <div className="notice success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          {disconnected && (
            <div className="notice" role="status">
              <RefreshCw size={17} />
              {t.reconnecting}
            </div>
          )}
          {loading ? (
            <div className="loading-state" role="status">
              <div className="skeleton-book" />
              <span>{t.loading}</span>
            </div>
          ) : !project ? (
            <section className="empty-library">
              <span className="empty-symbol">
                <Headphones size={40} />
              </span>
              <h1>{t.empty}</h1>
              <p>{t.emptyHint}</p>
              <button
                className="dropzone"
                onClick={() => openUpload()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  openUpload(e.dataTransfer.files[0]);
                }}
              >
                <Upload size={28} />
                <strong>{t.choose}</strong>
                <span>PDF / EPUB</span>
              </button>
              {error && (
                <button className="secondary" onClick={refresh}>
                  {t.retry}
                </button>
              )}
            </section>
          ) : (
            <>
              <section className="book-heading">
                <BookCover book={project} large />
                <button
                  className="icon-button"
                  aria-label={t.deleteBook}
                  onClick={() => setDeleting(project)}
                >
                  <Trash2 size={19} />
                </button>
                <div>
                  <p className="book-author">{project.author || t.library}</p>
                  <h1>{project.title}</h1>
                  <p className="book-meta">
                    <span>
                      {project.language === "es" ? "Español" : "English"}
                    </span>
                    <span>
                      {project.chapters.length} {t.chapters.toLowerCase()}
                    </span>
                    <span className={`status-label ${busy ? "active" : ""}`}>
                      {busy ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : project.output ? (
                        <Check size={14} />
                      ) : (
                        <BookOpen size={14} />
                      )}{" "}
                      {statusText(project, t)}
                    </span>
                  </p>
                </div>
                <button
                  className="secondary compact"
                  onClick={() => openUpload()}
                >
                  <Plus size={18} />
                  {t.newBook}
                </button>
              </section>
              <LanguageNotice
                detection={project.language_detection}
                language={project.language}
                t={t}
              />
              {(project.error || project.job?.error) && (
                <ErrorNotice
                  error={project.job?.error || project.error}
                  t={t}
                />
              )}
              {project.source_pages?.some((p) => p.warning) && (
                <details className="notice">
                  <summary>{t.pageWarning}</summary>
                  {project.source_pages
                    .filter((p) => p.warning)
                    .map((p) => (
                      <p key={p.page}>
                        {p.page}: {p.warning}
                      </p>
                    ))}
                </details>
              )}
              {!project.chapters.length ? (
                <section className="preparing-panel">
                  <BookOpen size={35} />
                  <h2>{busy ? t.preparing : t.prepareError}</h2>
                  <p>{t.preparingHint}</p>
                  {!busy && (
                    <button
                      className="primary"
                      onClick={() => runJob("resume")}
                    >
                      {t.resume}
                    </button>
                  )}
                </section>
              ) : (
                <div className="workspace">
                  <section className="manuscript">
                    <div
                      className="chapter-tabs"
                      role="tablist"
                      aria-label={t.chapters}
                    >
                      {project.chapters.map((c, i) => (
                        <button
                          key={i}
                          role="tab"
                          aria-selected={chapter === i}
                          tabIndex={chapter === i ? 0 : -1}
                          onKeyDown={(e) => {
                            const next =
                              e.key === "ArrowRight"
                                ? (i + 1) % project.chapters.length
                                : e.key === "ArrowLeft"
                                  ? (i + project.chapters.length - 1) %
                                    project.chapters.length
                                  : e.key === "Home"
                                    ? 0
                                    : e.key === "End"
                                      ? project.chapters.length - 1
                                      : null;
                            if (next === null) return;
                            e.preventDefault();
                            selectChapter(next);
                            document
                              .getElementById("chapter-tab-" + next)
                              ?.focus();
                          }}
                          id={`chapter-tab-${i}`}
                          aria-controls="chapter-panel"
                          onClick={() => selectChapter(i)}
                        >
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          <span className="tab-title">
                            {c.title}
                            <small>
                              {c.ready ??
                                c.sentences.filter((s) => s.ready).length}
                              /{c.total ?? c.sentences.length} {t.chapterReady}
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>

                    <ListeningPlayer
                      state={listenState}
                      t={t}
                      title={selectedChapter?.title}
                      disabled={listenDisabled}
                      onStart={() => beginListening()}
                      onPause={() => listener.current?.pause()}
                      onResume={() => listener.current?.resume()}
                      onStop={() => listener.current?.reset()}
                      rows={forwardRows(project, listenStart, startSentence)}
                      onSeek={(index) => {
                        const row = forwardRows(
                          project,
                          listenStart,
                          startSentence,
                        )[index];
                        if (row)
                          beginListening(
                            row.chapter,
                            allowNetwork,
                            row.sentence,
                          );
                      }}
                      onRate={(rate) => listener.current?.setRate(rate)}
                      sleep={sleep}
                      onSleep={setSleep}
                    />
                    <div className="reader-tools">
                      <label>
                        {t.textSize}
                        <input
                          type="range"
                          min="18"
                          max="26"
                          value={textSize}
                          onChange={(e) => setTextSize(+e.target.value)}
                        />
                      </label>
                      {savedPosition && (
                        <button
                          className="text-button"
                          onClick={() =>
                            beginListening(
                              savedPosition.chapter,
                              allowNetwork,
                              savedPosition.sentence,
                            )
                          }
                        >
                          {t.continueSaved}
                        </button>
                      )}
                      {bookmarks.length > 0 && (
                        <label>
                          {t.bookmarks}
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                const [ci, si] = e.target.value
                                  .split("-")
                                  .map(Number);
                                selectChapter(ci, si);
                              }
                              e.target.value = "";
                            }}
                          >
                            <option value="">—</option>
                            {bookmarks.map((id) => (
                              <option key={id} value={id}>
                                {id}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                    <div
                      className="reading-sheet"
                      id="chapter-panel"
                      role="tabpanel"
                      aria-labelledby={`chapter-tab-${chapter}`}
                    >
                      <div className="chapter-heading">
                        <span className="chapter-number">
                          {String(chapter + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <h2>{selectedChapter?.title}</h2>
                          <p className="small muted">
                            {selectedChapter?.sentences.length} {t.sentences}
                          </p>
                        </div>
                        <button
                          className="icon-button"
                          disabled={listenDisabled}
                          onClick={() => beginListening()}
                          aria-label={t.listenNow}
                          title={t.listenNow}
                        >
                          <Play size={20} />
                        </button>
                      </div>
                      <SentenceList
                        key={chapter}
                        rows={selectedChapter?.sentences}
                        state={listenState}
                        t={t}
                        busy={busy}
                        onEdit={setEditor}
                        onListen={(i) =>
                          beginListening(chapter, allowNetwork, i)
                        }
                        onBookmark={toggleBookmark}
                        bookmarks={bookmarks}
                        focusRequest={focusRequest}
                        textSize={textSize}
                      />
                    </div>

                    <Suspense
                      fallback={<p role="status">{t.analysisLoading}</p>}
                    >
                      <BookAnalysis
                        key={project.id}
                        project={project}
                        locale={locale}
                        t={t}
                        onChapter={selectChapter}
                        onListen={(ci, si) =>
                          beginListening(ci, allowNetwork, si)
                        }
                        onReanalyze={async () => {
                          try {
                            const p = await api(
                              `/api/projects/${activeId}/reanalyze`,
                              { method: "POST" },
                            );
                            setProjects((all) => [p, ...all]);
                            chooseProject(p.id);
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                        disabled={busy}
                        onStructure={async (action, ci, boundary) => {
                          try {
                            listener.current?.reset();
                            const body = {
                              action,
                              chapter: ci,
                              ...(boundary ? { boundary } : {}),
                            };
                            const p = await api(
                              "/api/projects/" + activeId + "/structure",
                              { method: "POST", body: JSON.stringify(body) },
                            );
                            setProject(p);
                            setProjects((all) =>
                              all.map((x) => (x.id === p.id ? p : x)),
                            );
                            setChapter(Math.min(ci, p.chapters.length - 1));
                            setNotice(t.structureSaved);
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                        onReviewed={(p) => setProject(p)}
                      />
                    </Suspense>
                    {playing && (
                      <section className="player-panel">
                        <div className="player-label">
                          <Headphones size={18} />
                          <strong>{playing.label}</strong>
                        </div>
                        <audio
                          key={playing.src}
                          ref={audio}
                          controls
                          autoPlay
                          src={apiURL(playing.src)}
                          onError={() => setError("audioError")}
                          aria-label={t.playback}
                        />
                      </section>
                    )}
                    {project.output &&
                      listenState.status === "idle" &&
                      !playing && (
                        <details className="completed-player">
                          <summary>{t.finalAudio}</summary>
                          <audio
                            controls
                            src={apiURL(project.output)}
                            preload="none"
                            aria-label={t.finalAudio}
                            onPlay={() => listener.current?.reset()}
                          />
                        </details>
                      )}
                  </section>
                  <aside className="settings-panel">
                    <div className="section-title">
                      <Settings2 size={19} />
                      <h2>{t.settings}</h2>
                    </div>
                    <fieldset disabled={busy} className="form-stack">
                      <label>
                        {t.voice}
                        <select
                          value={settings?.voice || ""}
                          onChange={(e) =>
                            updateSettings("voice", e.target.value)
                          }
                        >
                          {voiceOptions.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                              {v.gender ? ` · ${t[v.gender]}` : ""}
                              {v.region ? ` · ${v.region}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        disabled={
                          pending ||
                          busy ||
                          !readyEngine ||
                          (settings?.engine === "edge" && !allowNetwork)
                        }
                        onClick={previewVoice}
                      >
                        <Play size={16} />
                        {t.voicePreview}
                      </button>
                      <label>
                        {t.pace} <strong>{settings?.pace || 1}×</strong>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.05"
                          value={settings?.pace || 1}
                          onChange={(e) =>
                            updateSettings("pace", Number(e.target.value))
                          }
                        />
                        <span className="small muted">{t.paceHint}</span>
                      </label>
                      <div className="field-row">
                        <label>
                          {t.output}
                          <select
                            value={settings?.format || "m4b"}
                            onChange={(e) =>
                              updateSettings("format", e.target.value)
                            }
                          >
                            <option value="m4b">M4B</option>
                            <option value="mp3">MP3</option>
                          </select>
                        </label>
                      </div>
                      {dirty && (
                        <button
                          className="secondary full"
                          onClick={saveSettings}
                        >
                          <Check size={17} />
                          {t.save}
                        </button>
                      )}
                    </fieldset>
                    {dirty && (
                      <p className="small muted" role="status">
                        {t.unsaved}
                      </p>
                    )}
                    {settings?.engine === "edge" && (
                      <div className="online-note">
                        <p className="small">
                          {guestLibrary
                            ? t.guestPrivacy
                            : hosted
                              ? t.hostedPrivacy
                              : t.onlineNotice}
                        </p>
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={allowNetwork}
                            onChange={(e) => setAllowNetwork(e.target.checked)}
                          />
                          <span>{t.onlineConsent}</span>
                        </label>
                      </div>
                    )}
                    <details className="casting-options">
                      <summary>{t.cast}</summary>
                      <Casting
                        project={project}
                        voices={voiceOptions}
                        busy={busy || dirty}
                        t={t}
                        onChange={changeCasting}
                      />
                    </details>
                    <div className="render-section">
                      <div className="progress-caption">
                        <span>{t.wholeBook}</span>
                        <strong>
                          {project.progress.complete}/{project.progress.total}
                        </strong>
                      </div>
                      <p className="small muted">{t.progress}</p>
                      <progress
                        value={project.progress.complete}
                        max={project.progress.total || 1}
                        aria-label={t.progress}
                      />
                      <button
                        className="primary full"
                        disabled={busy || !readyEngine}
                        onClick={() => beginListening(chapter)}
                      >
                        {busy ? (
                          <LoaderCircle className="spin" size={19} />
                        ) : (
                          <AudioLines size={19} />
                        )}{" "}
                        {busy
                          ? t.working
                          : project.status === "paused"
                            ? t.resumePreparation
                            : t.render}
                      </button>
                      {busy &&
                        canListenDuringJob &&
                        project.status !== "assembling" && (
                          <button
                            className="secondary full"
                            disabled={project.listening?.pausing || pending}
                            onClick={() => runJob("pause")}
                          >
                            {project.listening?.pausing
                              ? t.pausingPreparation
                              : t.pausePreparation}
                          </button>
                        )}
                      {project.output && !busy && (
                        <a
                          className="secondary full"
                          href={apiURL(project.output)}
                          download
                        >
                          <Download size={18} />
                          {t.download}
                        </a>
                      )}
                      {project.bundle && !busy && (
                        <a
                          className="secondary full"
                          href={apiURL(project.bundle)}
                          download
                        >
                          <Download size={18} />
                          {t.downloadBundle}
                        </a>
                      )}
                      {!busy && project.status === "failed" && (
                        <button
                          className="secondary full"
                          onClick={() => runJob("resume")}
                        >
                          {t.resume}
                        </button>
                      )}
                      <p className="small muted">
                        {busy
                          ? t.backgroundHint
                          : guestLibrary
                            ? t.guestEngineHint
                            : t.engineHint}
                      </p>
                      {busy &&
                        project.status === "synthesizing" &&
                        project.progress.current_chapter != null && (
                          <p className="preparing-chapter">
                            {t.preparingChapter}{" "}
                            {project.progress.current_chapter + 1}
                          </p>
                        )}
                      <p className="small muted">{t.forwardHint}</p>
                    </div>
                  </aside>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <div className="toast-stack">
        {undo.map((receipt) => (
          <UndoDeletion
            key={receipt.id}
            receipt={receipt}
            t={t}
            onRestore={restored}
            onExpire={expired}
          />
        ))}
      </div>
      {help && (
        <Modal title={t.keyboardHelp} t={t} onClose={() => setHelp(false)}>
          <p>{t.shortcutsHint}</p>
        </Modal>
      )}
      {auth && (
        <Modal title={t.hostedAccess} t={t} onClose={() => setAuth(false)}>
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setAuthError("");
              setAccessToken(token);
              try {
                await api("/api/projects");
                setAuth(false);
                setToken("");
                refresh();
              } catch (e) {
                setAuthError(e.message);
              }
            }}
          >
            <p>{t.hostedNotice}</p>
            <label>
              {t.accessToken}
              <input
                type="password"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <p role="alert">{authError}</p>
            <button className="primary">{t.unlock}</button>
          </form>
        </Modal>
      )}
      {deleting && (
        <DeleteBook
          project={deleting}
          t={t}
          Modal={Modal}
          onClose={() => setDeleting(null)}
          onDeleted={deleted}
          onStopping={stopDeleted}
        />
      )}
      {upload && (
        <UploadDialog
          initialFile={uploadFile}
          locale={locale}
          t={t}
          onClose={() => setUpload(false)}
          onCreated={(p) => {
            setProjects((all) => [p, ...all]);
            setActiveId(p.id);
            setUpload(false);
          }}
        />
      )}
      {listenConsent !== null && (
        <Modal
          title={t.onlineListening}
          t={t}
          onClose={() => setListenConsent(null)}
        >
          <p>{t.onlineListeningNotice}</p>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => setListenConsent(null)}
            >
              {t.cancel}
            </button>
            <button
              className="primary"
              onClick={() => {
                const next = listenConsent;
                setListenConsent(null);
                setAllowNetwork(true);
                beginListening(next.chapter, true, next.sentence);
              }}
            >
              {t.allowAndListen}
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <SentenceEditor
          row={editor}
          t={t}
          busy={busy}
          onClose={() => setEditor(null)}
          speakers={project?.speakers}
          onSave={saveSentence}
        />
      )}
    </>
  );
}
