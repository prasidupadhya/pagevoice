import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Sun,
  Moon,
  Languages,
  Download,
  Upload,
  Trash2,
  HardDrive,
  Wifi,
  WifiOff,
  ShieldCheck,
  Plus,
  X,
  Check,
} from "lucide-react";
import en from "./locales/en";
import es from "./locales/es";
import { useReader } from "./offline/useReader";
import { bytes, downloadBlob } from "./offline/format";
import Shelf from "./ui/Shelf";
import Modal from "./ui/Modal";
const Reader = lazy(() => import("./ui/Reader"));
const ModelDialog = lazy(() => import("./ui/ModelDialog"));
export default function App() {
  const api = useReader();
  const [locale, setLocale] = useState("en"),
    [theme, setTheme] = useState("sepia"),
    [selected, setSelected] = useState(null),
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
      (locale === "es" ? es : en)[key] || key,
    );
  const notify = (message) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  const book = api.books.find((b) => b.id === selected);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        theme === "dark"
          ? "#151f25"
          : theme === "light"
            ? "#faf8f3"
            : "#eee5d4",
      );
    if (!api.loading) {
      api.refs.current.store.preference("theme", theme);
      api.refs.current.store.preference("locale", locale);
    }
  }, [theme, locale]);
  useEffect(() => {
    if (api.loading) return;
    Promise.all(
      ["theme", "locale"].map((k) => api.refs.current.store.preference(k)),
    ).then(([th, lang]) => {
      setTheme(
        th ||
          (matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "sepia"),
      );
      setLocale(lang || (navigator.language.startsWith("es") ? "es" : "en"));
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
  const perform = async (fn) => {
    try {
      await fn();
    } catch (e) {
      api.setError(
        e.name === "QuotaExceededError" ? "quotaExceeded" : e.message,
      );
    }
  };
  const addFiles = (files) => {
    setUploadOpen(false);
    api.upload(Array.from(files), keep);
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
  return (
    <div
      className={`app-shell ${book ? "has-reader" : ""}`}
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
        if (!api.progress) addFiles(e.dataTransfer.files);
      }}
    >
      <a className="skip-link" href="#main-content">
        {t("read")}
      </a>
      <header className="masthead">
        <button className="brand" onClick={() => setSelected(null)}>
          <span className="brand-symbol">
            <BookOpen size={24} strokeWidth={1.5} />
          </span>
          <span>
            PageVoice<small>{t("tagline")}</small>
          </span>
        </button>
        <nav aria-label={t("help")}>
          <span
            className={`connection ${online ? "" : "is-offline"}`}
            title={t(online ? "online" : "offline")}
          >
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{t(online ? "online" : "offline")}</span>
          </span>
          <button
            className="tools-button"
            aria-label={t("models")}
            onClick={() => setTools(true)}
            disabled={api.loading}
          >
            <Download size={17} />
            <span>{t("models")}</span>
          </button>
          <button
            className="icon-button"
            aria-label={`${t("interface")} · ${locale.toUpperCase()}`}
            title={t("interface")}
            onClick={() => setLocale(locale === "en" ? "es" : "en")}
          >
            <Languages size={18} />
            <small>{locale.toUpperCase()}</small>
          </button>
          <button
            className="icon-button"
            aria-label={`${t("theme")} · ${t(theme)}`}
            title={t("theme")}
            onClick={() =>
              setTheme(
                theme === "light"
                  ? "sepia"
                  : theme === "sepia"
                    ? "dark"
                    : "light",
              )
            }
          >
            {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button
            className="icon-button credits-button"
            onClick={() => setCredits(true)}
            aria-label={t("credits")}
            title={t("credits")}
          >
            <ShieldCheck size={19} />
          </button>
        </nav>
      </header>
      <input
        className="sr-only"
        ref={picker}
        type="file"
        accept=".pdf,.epub"
        multiple
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
        onChange={(e) =>
          perform(async () => {
            await api.refs.current.store.importBackup(e.target.files[0]);
            api.sync();
            notify(t("imported"));
            e.target.value = "";
          })
        }
        aria-label={t("importBackup")}
      />
      {api.error && (
        <div className="error-banner" role="alert">
          <div>
            <strong>{t("errorTitle")}</strong>
            <p>{t(api.error)}</p>
            {!en[api.error] && (
              <details>
                <summary>{t("details")}</summary>
                <code>{api.error}</code>
              </details>
            )}
          </div>
          <div className="button-row">
            {["modelNotCached", "ocrRequired", "scannedPdf"].includes(
              api.error,
            ) && <button onClick={() => setTools(true)}>{t("models")}</button>}
            {[
              "ocrRequired",
              "scannedPdf",
              "processingError",
              "downloadFailed",
            ].includes(api.error) && (
              <button onClick={api.retryUpload}>{t("retry")}</button>
            )}
            <button
              className="icon-button"
              aria-label={t("dismiss")}
              onClick={() => api.setError(null)}
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {api.progress && (
        <section className="import-progress" aria-live="polite">
          <div>
            <strong>{api.progress.name}</strong>
            <p>
              {t(api.progress.stage)} · {api.progress.current} /{" "}
              {api.progress.total}
            </p>
            {api.progress.large && <small>{t("largeFile")}</small>}
          </div>
          <progress
            value={api.progress.current + (api.progress.fraction || 0)}
            max={api.progress.total}
            aria-label={t(api.progress.stage)}
          />
          <button onClick={api.cancelUpload}>{t("cancel")}</button>
        </section>
      )}
      <div id="main-content" tabIndex={-1}>
        {api.loading ? (
          <div className="shelf-skeleton" aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        ) : book ? (
          <Suspense
            fallback={
              <div className="shelf-skeleton" aria-busy="true">
                <span />
              </div>
            }
          >
            <Reader
              key={book.id}
              book={book}
              api={api}
              t={t}
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
              onOpen={setSelected}
              onDelete={askDelete}
              onAdd={() => setUploadOpen(true)}
            />
            <footer className="library-footer">
              <div className="privacy-note">
                <ShieldCheck size={17} />
                <span>{t("privacy")}</span>
              </div>
              <div className="storage-line">
                <span>
                  <HardDrive size={15} />
                  {t("storageUsed", {
                    used: bytes(storage.usage),
                    quota: bytes(storage.quota),
                  })}
                </span>
                <div className="storage-track">
                  <span
                    style={{
                      width: `${Math.min(100, ((storage.usage || 0) / Math.max(1, storage.quota)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="footer-actions">
                <button
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
                  <Download size={15} />
                  {t("backup")}
                </button>
                <button onClick={() => backupPicker.current.click()}>
                  <Upload size={15} />
                  {t("importBackup")}
                </button>
                <button
                  onClick={() => setClear(true)}
                  disabled={!api.books.length}
                >
                  <Trash2 size={15} />
                  {t("clear")}
                </button>
                {installPrompt && (
                  <button
                    onClick={async () => {
                      await installPrompt.prompt();
                      setInstallPrompt(null);
                    }}
                  >
                    <Plus size={15} />
                    {t("install")}
                  </button>
                )}
                <button
                  className="text-button"
                  onClick={() => setCredits(true)}
                >
                  {t("credits")}
                </button>
              </div>
              <small className="muted">
                {t("storageNote")}{" "}
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
              </small>
            </footer>
          </main>
        )}
      </div>
      {dragging && (
        <div className="drop-overlay">
          <BookOpen size={40} />
          <h2>{t("drop")}</h2>
          <p>{t("formats")}</p>
        </div>
      )}
      {(toast || undo || updateApp) && (
        <div className="toast-stack" aria-live="polite">
          {undo && (
            <div className="toast undo-toast">
              <span>{t("removed")}</span>
              <button
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
              <Check size={16} />
              <span>{toast}</span>
              <button
                className="icon-button"
                aria-label={t("dismiss")}
                onClick={() => setToast(null)}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {updateApp && (
            <div className="toast">
              <span>{t("update")}</span>
              <button onClick={updateApp}>{t("reload")}</button>
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
            <BookOpen size={32} />
            <strong>{t("drop")}</strong>
            <span>{t("choose")}</span>
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
            onClose={() => setTools(false)}
            onError={api.setError}
          />
        </Suspense>
      )}
      {credits && (
        <Modal
          title={t("creditsTitle")}
          closeLabel={t("close")}
          onClose={() => setCredits(false)}
          className="credits-modal"
        >
          <p>{t("creditsIntro")}</p>
          <h3>{t("modelLicense")}</h3>
          <p className="muted">{t("creditsNames")}</p>
          <a
            className="credits-link"
            href="/licenses/credits.html"
            target="_blank"
            rel="noreferrer"
          >
            {t("licenses")} <BookOpen size={16} />
          </a>
          <h3>{t("limits")}</h3>
          <p>{t("limitsBody")}</p>
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
          <div className="button-row">
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
            <button onClick={() => setDeleteBook(null)}>{t("cancel")}</button>
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
          <div className="button-row">
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
            <button onClick={() => setClear(false)}>{t("cancel")}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
