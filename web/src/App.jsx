import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Download,
  Upload,
  Trash2,
  HardDrive,
  WifiOff,
  ShieldCheck,
  Plus,
  X,
  Check,
  AlertCircle,
  FileUp,
  LoaderCircle,
} from "lucide-react";
import en from "./locales/en";
import es from "./locales/es";
import { useReader } from "./offline/useReader";
import { bytes, downloadBlob } from "./offline/format";
import Shelf from "./ui/Shelf";
import Modal from "./ui/Modal";
import DisplayMenu from "./ui/DisplayMenu";
import { TEXT_SIZES, THEMES, WIDTHS } from "./ui/prefs";
const Reader = lazy(() => import("./ui/Reader"));
const ModelDialog = lazy(() => import("./ui/ModelDialog"));
const THEME_COLORS = { dark: "#151f25", light: "#faf8f3", sepia: "#eee5d4" };
const DEFAULT_PREFS = {
  theme: null,
  locale: "en",
  textSize: 20,
  width: "medium",
  rate: 1,
};
const validPref = {
  theme: (v) => THEMES.includes(v),
  locale: (v) => ["en", "es"].includes(v),
  textSize: (v) => TEXT_SIZES.includes(v),
  width: (v) => WIDTHS.includes(v),
  rate: (v) => typeof v === "number" && v >= 0.5 && v <= 2,
};

export default function App() {
  const api = useReader();
  const [prefs, setPrefs] = useState(DEFAULT_PREFS),
    [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(false),
    [tools, setTools] = useState(false),
    [credits, setCredits] = useState(false),
    [deleteBook, setDeleteBook] = useState(null),
    [typed, setTyped] = useState(""),
    [clear, setClear] = useState(false),
    [toast, setToast] = useState(null),
    [undo, setUndo] = useState(null),
    [keep, setKeep] = useState(true),
    [uploadOpen, setUploadOpen] = useState(false),
    [dragging, setDragging] = useState(false),
    [storage, setStorage] = useState({ usage: 0, quota: 0 }),
    [online, setOnline] = useState(navigator.onLine),
    [installPrompt, setInstallPrompt] = useState(null),
    [updateApp, setUpdateApp] = useState(null);
  const picker = useRef(null),
    backupPicker = useRef(null),
    toastTimer = useRef(null);
  const t = (key, params = {}) =>
    Object.entries(params).reduce(
      (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
      (prefs.locale === "es" ? es : en)[key] || key,
    );
  const notify = (message, action = null) => {
    clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = setTimeout(() => setToast(null), action ? 8000 : 5000);
  };
  const setPref = (key, value) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    if (!api.loading)
      api.refs.current.store.preference(key, value).catch(() => {});
  };
  const book = api.books.find((b) => b.id === selected);
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme) root.dataset.theme = prefs.theme;
    root.lang = prefs.locale;
    // Once a theme is chosen it overrides both system-scheme theme colours.
    if (prefs.theme)
      for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
        meta.setAttribute("content", THEME_COLORS[prefs.theme]);
  }, [prefs.theme, prefs.locale]);
  useEffect(() => {
    if (api.loading) return;
    const store = api.refs.current.store;
    Promise.all(
      Object.keys(DEFAULT_PREFS).map(async (k) => [
        k,
        await store.preference(k).catch(() => undefined),
      ]),
    ).then((saved) => {
      const next = { ...DEFAULT_PREFS };
      for (const [k, v] of saved) if (validPref[k](v)) next[k] = v;
      next.theme ||= matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "sepia";
      if (!validPref.locale(saved.find(([k]) => k === "locale")[1]))
        next.locale = navigator.language.startsWith("es") ? "es" : "en";
      api.refs.current.player.setRate(next.rate);
      setPrefs(next);
    });
  }, [api.loading]);
  useEffect(() => {
    if (!api.loading)
      api.refs.current.store
        .estimate()
        .then(setStorage)
        .catch(() => {});
  }, [api.books, api.loading, tools]);
  useEffect(() => {
    const status = () => setOnline(navigator.onLine),
      install = (e) => {
        e.preventDefault();
        setInstallPrompt(e);
      };
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    window.addEventListener("beforeinstallprompt", install);
    if ("serviceWorker" in navigator)
      import("virtual:pwa-register")
        .then(({ registerSW }) => {
          const update = registerSW({
            onNeedRefresh: () => setUpdateApp(() => () => update(true)),
          });
        })
        .catch(() => {});
    return () => {
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
      window.removeEventListener("beforeinstallprompt", install);
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (!book) setFocus(false);
  }, [book]);
  const perform = async (fn) => {
    try {
      await fn();
    } catch (e) {
      api.setError(
        e.name === "QuotaExceededError" ? "quotaExceeded" : e.message,
      );
    }
  };
  const openBook = (id) => {
    setSelected(id);
    api.setError(null);
    api.update(id, { lastOpened: Date.now() }).catch(() => {});
  };
  const addFiles = async (files) => {
    setUploadOpen(false);
    const added = await api.upload(Array.from(files), keep);
    if (added.some((b) => b.storageFallback))
      notify(t("savedForSession"), {
        label: t("openNow"),
        run: () => openBook(added[0].id),
      });
    else if (added.length === 1)
      notify(t("added", { title: added[0].title }), {
        label: t("openNow"),
        run: () => openBook(added[0].id),
      });
    else if (added.length > 1) notify(t("addedMany", { n: added.length }));
  };
  const askDelete = (b) => {
    setDeleteBook(b);
    setTyped("");
  };
  const deleteBytes = deleteBook
    ? (deleteBook.sourceSize || 0) +
      (deleteBook.coverBlob?.size || 0) +
      Object.values(deleteBook.prepared).reduce((n, a) => n + a.bytes, 0)
    : 0;
  const progress = api.progress;
  const progressText = !progress
    ? ""
    : progress.stage === "ocr" && progress.total > 1
      ? t("ocrPage", progress)
      : progress.stage === "reading" &&
          progress.total > 1 &&
          /\.pdf$/iu.test(progress.name)
        ? t("readingPage", progress)
        : t(progress.stage);
  const knownError = api.error && en[api.error];
  return (
    <div
      className={`app-shell ${book ? "has-reader" : ""} ${focus ? "is-focus" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!api.progress && e.dataTransfer.files.length)
          addFiles(e.dataTransfer.files);
      }}
    >
      <a className="skip-link" href="#main-content">
        {t("skipToContent")}
      </a>
      <header className="masthead">
        <button
          className="brand"
          onClick={() => setSelected(null)}
          aria-label={`PageVoice · ${t("library")}`}
        >
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>PageVoice</span>
        </button>
        <nav className="masthead-actions" aria-label={t("appMenu")}>
          {!online && (
            <span className="offline-pill" role="status">
              <WifiOff size={14} aria-hidden="true" />
              {t("offline")}
            </span>
          )}
          <button
            className="ghost header-button"
            onClick={() => setTools(true)}
            disabled={api.loading}
            aria-label={t("models")}
          >
            <Download size={18} aria-hidden="true" />
            <span className="header-label">{t("models")}</span>
          </button>
          <DisplayMenu prefs={prefs} setPref={setPref} t={t} />
          <button
            className="ghost header-button"
            onClick={() => setCredits(true)}
            aria-label={t("privacyCredits")}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            <span className="header-label wide-only">{t("privacyShort")}</span>
          </button>
        </nav>
      </header>
      <input
        className="sr-only"
        ref={picker}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        multiple
        tabIndex={-1}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
        aria-label={t("choose")}
      />
      <input
        className="sr-only"
        ref={backupPicker}
        type="file"
        accept=".zip"
        tabIndex={-1}
        onChange={(e) =>
          perform(async () => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            await api.refs.current.store.importBackup(file);
            api.sync();
            notify(t("imported"));
          })
        }
        aria-label={t("importBackup")}
      />
      {api.error && (
        <div className="banner error-banner" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <div className="banner-body">
            <strong>{t("errorTitle")}</strong>
            <p>
              {api.errorFile && (
                <span className="error-file">{api.errorFile}: </span>
              )}
              {knownError ? t(api.error) : t("unexpectedError")}
            </p>
            {!knownError && (
              <details>
                <summary>{t("details")}</summary>
                <code>{api.error}</code>
              </details>
            )}
          </div>
          <div className="button-row">
            {["modelNotCached", "ocrRequired", "scannedPdf"].includes(
              api.error,
            ) && (
              <button className="small" onClick={() => setTools(true)}>
                {t("models")}
              </button>
            )}
            {[
              "ocrRequired",
              "scannedPdf",
              "processingError",
              "downloadFailed",
            ].includes(api.error) && (
              <button className="small" onClick={api.retryUpload}>
                {t("retry")}
              </button>
            )}
            <button
              className="icon-button small"
              aria-label={t("dismiss")}
              onClick={() => api.setError(null)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {progress && (
        <section
          className="banner import-progress"
          aria-label={t("importing", { name: progress.name })}
        >
          <LoaderCircle className="spin" size={20} aria-hidden="true" />
          <div className="banner-body">
            <strong>
              {t("importing", { name: progress.name })}
              {progress.queue && (
                <span className="muted">
                  {" "}
                  · {t("importingQueue", progress.queue)}
                </span>
              )}
            </strong>
            <p aria-live="polite">{progressText}</p>
            <progress
              value={progress.current + (progress.fraction || 0)}
              max={progress.total}
              aria-label={progressText}
            />
            <small className="muted">
              {progress.large ? t("largeFile") : t("importLocal")}
            </small>
          </div>
          <button className="small" onClick={api.cancelUpload}>
            {t("cancel")}
          </button>
        </section>
      )}
      <div id="main-content" tabIndex={-1}>
        {api.loading ? (
          <div className="page-loading" aria-busy="true">
            <LoaderCircle className="spin" size={22} aria-hidden="true" />
            <span>{t("loadingLibrary")}</span>
          </div>
        ) : book ? (
          <Suspense
            fallback={
              <div className="page-loading" aria-busy="true">
                <LoaderCircle className="spin" size={22} aria-hidden="true" />
                <span>{t("openingBook")}</span>
              </div>
            }
          >
            <Reader
              key={book.id}
              book={book}
              api={api}
              t={t}
              prefs={prefs}
              setPref={setPref}
              focus={focus}
              setFocus={setFocus}
              toolsOpen={tools}
              onBack={() => setSelected(null)}
              onDelete={askDelete}
              onModels={() => setTools(true)}
              toast={notify}
            />
          </Suspense>
        ) : (
          <main className="shelf-room">
            <Shelf
              books={api.books}
              store={api.refs.current.store}
              t={t}
              locale={prefs.locale}
              busy={!!progress}
              onOpen={openBook}
              onDelete={askDelete}
              onAdd={() => setUploadOpen(true)}
            />
            <footer className="library-footer">
              <div className="storage-line">
                <span>
                  <HardDrive size={16} aria-hidden="true" />
                  {t("storageUsed", {
                    used: bytes(storage.usage),
                    quota: bytes(storage.quota),
                  })}
                </span>
                <div className="storage-track" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, ((storage.usage || 0) / Math.max(1, storage.quota)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="footer-actions">
                <button
                  className="ghost small"
                  onClick={() =>
                    perform(async () => {
                      downloadBlob(
                        await api.refs.current.store.backup(),
                        "pagevoice-library.zip",
                      );
                      notify(t("backupDone"));
                    })
                  }
                  disabled={!api.books.length}
                >
                  <Download size={16} aria-hidden="true" />
                  {t("backup")}
                </button>
                <button
                  className="ghost small"
                  onClick={() => backupPicker.current.click()}
                >
                  <Upload size={16} aria-hidden="true" />
                  {t("importBackup")}
                </button>
                <button
                  className="ghost small"
                  onClick={() => setClear(true)}
                  disabled={!api.books.length}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {t("clear")}
                </button>
                {installPrompt && (
                  <button
                    className="ghost small"
                    onClick={async () => {
                      await installPrompt.prompt();
                      setInstallPrompt(null);
                    }}
                  >
                    <Plus size={16} aria-hidden="true" />
                    {t("install")}
                  </button>
                )}
              </div>
              <p className="fine-print">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  {t("privacy")} {t("storageNote")}{" "}
                  <button
                    className="text-button"
                    onClick={() =>
                      perform(async () =>
                        notify(
                          t(
                            (await navigator.storage?.persist?.())
                              ? "protected"
                              : "notProtected",
                          ),
                        ),
                      )
                    }
                  >
                    {t("requestPersistent")}
                  </button>
                </span>
              </p>
            </footer>
          </main>
        )}
      </div>
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <FileUp size={40} />
          <h2>{t("drop")}</h2>
          <p>{t("formats")}</p>
        </div>
      )}
      {(toast || undo || updateApp) && (
        <div className="toast-stack" aria-live="polite">
          {undo && (
            <div className="toast">
              <span>{t("removed")}</span>
              <button
                className="small"
                onClick={() =>
                  perform(async () => {
                    await api.undo(undo);
                    setUndo(null);
                  })
                }
              >
                {t("undo")}
              </button>
            </div>
          )}
          {toast && (
            <div className="toast">
              <Check size={16} aria-hidden="true" />
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  className="small primary"
                  onClick={() => {
                    toast.action.run();
                    setToast(null);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                className="icon-button small"
                aria-label={t("dismiss")}
                onClick={() => setToast(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {updateApp && (
            <div className="toast">
              <span>{t("update")}</span>
              <button className="small primary" onClick={updateApp}>
                {t("reload")}
              </button>
            </div>
          )}
        </div>
      )}
      {uploadOpen && (
        <Modal
          title={t("add")}
          onClose={() => setUploadOpen(false)}
          closeLabel={t("close")}
        >
          <button
            className="upload-well"
            onClick={() => picker.current.click()}
          >
            <FileUp size={32} aria-hidden="true" />
            <strong>{t("choose")}</strong>
            <span>{t("dropHint")}</span>
            <small>{t("formats")}</small>
          </button>
          <label className="keep-choice">
            <input
              type="checkbox"
              checked={keep && !api.refs.current.store.sessionOnly}
              disabled={api.refs.current.store.sessionOnly}
              onChange={(e) => setKeep(e.target.checked)}
            />
            <span>
              <strong>{t(keep ? "keep" : "session")}</strong>
              <small>{t(keep ? "keepHelp" : "sessionHelp")}</small>
            </span>
          </label>
          {api.refs.current.store.sessionOnly && (
            <p className="notice">{t("storageUnavailable")}</p>
          )}
        </Modal>
      )}
      {tools && (
        <Suspense fallback={null}>
          <ModelDialog
            t={t}
            assets={api.refs.current.assets}
            online={online}
            onClose={() => setTools(false)}
            onError={api.setError}
          />
        </Suspense>
      )}
      {credits && (
        <Modal
          title={t("privacyCredits")}
          closeLabel={t("close")}
          onClose={() => setCredits(false)}
          className="credits-modal"
        >
          <h3>{t("privacyStoredTitle")}</h3>
          <p>{t("privacyStored")}</p>
          <h3>{t("privacyNetworkTitle")}</h3>
          <p>{t("privacyNetwork")}</p>
          <p className="muted">{t("privacyDevice")}</p>
          <h3>{t("modelLicense")}</h3>
          <p className="muted">{t("creditsNames")}</p>
          <a
            className="credits-link"
            href="/licenses/credits.html"
            target="_blank"
            rel="noreferrer"
          >
            {t("licenses")}
          </a>
          <h3>{t("limits")}</h3>
          <p>{t("limitsBody")}</p>
          <p className="muted">
            <a
              href="https://github.com/prasidupadhya/pagevoice"
              target="_blank"
              rel="noreferrer"
            >
              {t("sourceCode")}
            </a>
          </p>
        </Modal>
      )}
      {deleteBook && (
        <Modal
          title={t("removeTitle", { title: deleteBook.title })}
          closeLabel={t("close")}
          onClose={() => setDeleteBook(null)}
        >
          <p>
            {t("removeBody", {
              n: Object.keys(deleteBook.prepared).length,
              size: bytes(deleteBytes),
            })}
          </p>
          {Object.keys(deleteBook.prepared).length > 0 && (
            <label>
              {t("typeTitle")}
              <input
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={deleteBook.title}
              />
            </label>
          )}
          <div className="button-row modal-actions">
            <button onClick={() => setDeleteBook(null)}>{t("cancel")}</button>
            <button
              className="danger"
              disabled={
                Object.keys(deleteBook.prepared).length > 0 &&
                typed !== deleteBook.title
              }
              onClick={() =>
                perform(async () => {
                  const id = deleteBook.id;
                  await api.remove(id);
                  setUndo(id);
                  setDeleteBook(null);
                  if (selected === id) setSelected(null);
                })
              }
            >
              {t("removeConfirm")}
            </button>
          </div>
        </Modal>
      )}
      {clear && (
        <Modal
          title={t("clearTitle")}
          closeLabel={t("close")}
          onClose={() => setClear(false)}
        >
          <p>{t("clearBody")}</p>
          <div className="button-row modal-actions">
            <button onClick={() => setClear(false)}>{t("cancel")}</button>
            <button
              className="danger"
              onClick={() =>
                perform(async () => {
                  api.stopPlayback();
                  api.refs.current.queue.dispose();
                  await api.refs.current.store.clear();
                  api.sync();
                  setSelected(null);
                  setClear(false);
                  setUndo(null);
                })
              }
            >
              {t("clear")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
