import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Search,
  FileUp,
  BookOpen,
  Headphones,
  X,
} from "lucide-react";
import { progressOf, relativeTime } from "../offline/format";

function BookCover({ book, store }) {
  const url = store.coverURL(book);
  const seed = [...book.title].reduce((n, c) => n + c.codePointAt(0), 0) % 55;
  return url ? (
    <img className="cover-art" src={url} alt="" loading="lazy" />
  ) : (
    <div
      className="type-cover"
      style={{ "--cover-hue": seed }}
      aria-hidden="true"
    >
      <span className="cover-title">{book.title}</span>
      {book.author && <span className="cover-author">{book.author}</span>}
    </div>
  );
}

function Progress({ book, t }) {
  const percent = progressOf(book),
    started = book.lastOpened || percent > 0;
  return (
    <div className="book-progress">
      <span className="progress-track" aria-hidden="true">
        <span style={{ width: `${started ? percent : 0}%` }} />
      </span>
      <span>{started ? t("bookProgress", { percent }) : t("notStarted")}</span>
    </div>
  );
}

const extentOf = (book, t) =>
  book.pageCount
    ? t(book.pageCount === 1 ? "pageOne" : "pages", { n: book.pageCount })
    : t(book.chapters.length === 1 ? "sectionOne" : "sectionsCount", {
        n: book.chapters.length,
      });

const SORTS = {
  opened: (a, b) => (b.lastOpened || b.created) - (a.lastOpened || a.created),
  added: (a, b) => b.created - a.created,
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) =>
    (a.author || "￿").localeCompare(b.author || "￿") ||
    a.title.localeCompare(b.title),
  progress: (a, b) => progressOf(b) - progressOf(a),
};

export default function Shelf({
  books,
  store,
  t,
  locale,
  busy,
  onOpen,
  onDelete,
  onAdd,
}) {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("opened");
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return books
      .filter((b) =>
        `${b.title} ${b.author || ""}`.toLocaleLowerCase().includes(q),
      )
      .sort(SORTS[sort]);
  }, [books, query, sort]);
  const recent = useMemo(
    () =>
      books
        .filter((b) => b.lastOpened)
        .sort((a, b) => b.lastOpened - a.lastOpened)[0],
    [books],
  );
  if (!books.length)
    return (
      <section className="empty-room" aria-labelledby="empty-title">
        <h1 id="empty-title">{t("empty")}</h1>
        <p className="empty-copy">{t("emptyBody")}</p>
        <button className="primary large" onClick={onAdd} disabled={busy}>
          <Plus size={18} aria-hidden="true" />
          {t("add")}
        </button>
        <p className="fine-print">{t("dropHint")}</p>
        <ol className="steps">
          <li>
            <FileUp size={20} aria-hidden="true" />
            <div>
              <h2>{t("step1")}</h2>
              <p>{t("step1Body")}</p>
            </div>
          </li>
          <li>
            <BookOpen size={20} aria-hidden="true" />
            <div>
              <h2>{t("step2")}</h2>
              <p>{t("step2Body")}</p>
            </div>
          </li>
          <li>
            <Headphones size={20} aria-hidden="true" />
            <div>
              <h2>{t("step3")}</h2>
              <p>{t("step3Body")}</p>
            </div>
          </li>
        </ol>
      </section>
    );
  return (
    <section className="library-shelf" aria-labelledby="library-title">
      <div className="shelf-heading">
        <h1 id="library-title">
          {t("library")}
          <span className="count">
            {t(books.length === 1 ? "shelfOne" : "shelfCount", {
              n: books.length,
            })}
          </span>
        </h1>
        <button className="primary" onClick={onAdd} disabled={busy}>
          <Plus size={18} aria-hidden="true" />
          {t("add")}
        </button>
      </div>
      {recent && !query && (
        <section className="continue" aria-labelledby="continue-title">
          <div className="continue-cover">
            <BookCover book={recent} store={store} />
          </div>
          <div className="continue-body">
            <h2 className="eyebrow" id="continue-title">
              {t("continueReading")}
            </h2>
            <p className="continue-title">{recent.title}</p>
            <p className="muted">
              {[recent.author, recent.chapters[recent.position.chapter]?.title]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <Progress book={recent} t={t} />
          </div>
          <button className="primary" onClick={() => onOpen(recent.id)}>
            <BookOpen size={18} aria-hidden="true" />
            {t("continue")}
            <span className="sr-only"> · {recent.title}</span>
          </button>
        </section>
      )}
      {books.length > 1 && (
        <div className="shelf-filters">
          <label className="search-field">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">{t("filterBooks")}</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("filterBooks")}
            />
          </label>
          <label className="sort-field">
            <span>{t("sort")}</span>
            <select
              aria-label={t("sort")}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="opened">{t("recentOpened")}</option>
              <option value="added">{t("recent")}</option>
              <option value="title">{t("titleSort")}</option>
              <option value="author">{t("authorSort")}</option>
              <option value="progress">{t("progressSort")}</option>
            </select>
          </label>
        </div>
      )}
      {!visible.length && (
        <div className="no-results" role="status">
          <p>{t("noBooks", { query: query.trim() })}</p>
          <button className="small" onClick={() => setQuery("")}>
            <X size={16} aria-hidden="true" />
            {t("clearSearch")}
          </button>
        </div>
      )}
      <ul className="shelf-grid" aria-label={t("library")}>
        {visible.map((book) => (
          <li className="shelf-book" key={book.id} data-book={book.title}>
            <button
              className="book-open"
              onClick={() => onOpen(book.id)}
              aria-label={`${t("open")} · ${book.title}`}
            >
              <span className="cover-wrap">
                <BookCover book={book} store={store} />
              </span>
            </button>
            <div className="book-details">
              <h2>{book.title}</h2>
              {book.author && <p className="book-author">{book.author}</p>}
              <p className="book-meta">
                <span className="format-tag">{book.format.toUpperCase()}</span>
                <span>{extentOf(book, t)}</span>
                {!book.keep && (
                  <span className="session-tag">{t("session")}</span>
                )}
              </p>
              <Progress book={book} t={t} />
              <div className="book-bottom">
                <small className="muted">
                  {book.lastOpened
                    ? t("lastOpened", {
                        time: relativeTime(book.lastOpened, locale),
                      })
                    : t("addedOn", {
                        time: relativeTime(book.created, locale),
                      })}
                </small>
                <button
                  className="icon-button small"
                  aria-label={`${t("remove")} · ${book.title}`}
                  title={t("remove")}
                  onClick={() => onDelete(book)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
