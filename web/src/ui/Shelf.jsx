import { useMemo, useState } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  Search,
  ArrowUpDown,
  ArrowUpRight,
} from "lucide-react";
import { progressOf } from "../offline/format";
function BookCover({ book, store }) {
  const url = store.coverURL(book);
  const seed = [...book.title].reduce((n, c) => n + c.codePointAt(0), 0) % 55;
  return url ? (
    <img className="cover-art" src={url} alt="" loading="lazy" />
  ) : (
    <div className="type-cover" style={{ "--cover-hue": seed }}>
      <span className="cover-mark">PV</span>
      <span className="cover-title">{book.title}</span>
      <span className="cover-author">{book.author}</span>
      <span className="cover-language">
        {book.language.toUpperCase()} · {book.format.toUpperCase()}
      </span>
    </div>
  );
}
export default function Shelf({ books, store, t, onOpen, onDelete, onAdd }) {
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent");
  const visible = useMemo(
    () =>
      books
        .filter((b) =>
          `${b.title} ${b.author}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title)
            : sort === "progress"
              ? progressOf(b) - progressOf(a)
              : b.created - a.created,
        ),
    [books, query, sort],
  );
  if (!books.length)
    return (
      <section className="empty-room">
        <div className="empty-art" aria-hidden="true">
          <span className="drawn-book book-a" />
          <span className="drawn-book book-b" />
          <span className="drawn-book book-c" />
          <span className="shelf-line" />
        </div>
        <p className="eyebrow">{t("private")}</p>
        <h1>{t("empty")}</h1>
        <p className="empty-copy">{t("emptyBody")}</p>
        <button className="primary" onClick={onAdd}>
          <Plus size={18} />
          {t("add")}
        </button>
        <p className="fine-print">{t("emptyNote")}</p>
      </section>
    );
  return (
    <section className="library-shelf">
      <div className="shelf-heading">
        <div>
          <p className="eyebrow">{t("private")}</p>
          <h1>
            {t("library")}
            <span>
              {t(books.length === 1 ? "shelfOne" : "shelfCount", {
                n: books.length,
              })}
            </span>
          </h1>
        </div>
        <button className="primary" onClick={onAdd}>
          <Plus size={18} />
          {t("add")}
        </button>
      </div>
      <div className="shelf-filters">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">{t("filterBooks")}</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("filterBooks")}
          />
        </label>
        <label className="sort-field">
          <ArrowUpDown size={16} />
          <span className="sr-only">{t("sort")}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">{t("recent")}</option>
            <option value="title">{t("titleSort")}</option>
            <option value="progress">{t("progressSort")}</option>
          </select>
        </label>
      </div>
      {!visible.length && <p>{t("noBooks")}</p>}
      <div className="shelf-grid">
        {visible.map((book) => {
          const percent = progressOf(book);
          return (
            <article
              className="shelf-book"
              key={book.id}
              data-book={book.title}
            >
              <button
                className="book-open"
                onClick={() => onOpen(book.id)}
                aria-label={`${t("open")} · ${book.title}`}
              >
                <div className="cover-wrap">
                  <BookCover book={book} store={store} />
                  <span
                    className="ribbon"
                    style={{ "--read-progress": `${percent}%` }}
                  >
                    {percent}%
                  </span>
                </div>
                <div className="book-details">
                  <h2>{book.title}</h2>
                  <p>{book.author || book.format.toUpperCase()}</p>
                  <span className="book-meta">
                    {book.language.toUpperCase()}
                    <span>·</span>
                    {book.chapters.length} {t("chapters").toLowerCase()}
                    <ArrowUpRight size={16} />
                  </span>
                </div>
              </button>
              <div className="book-bottom">
                <span className="status">
                  <BookOpen size={13} />
                  {book.keep ? t("keep") : t("session")}
                </span>
                <button
                  className="icon-button"
                  aria-label={`${t("remove")} · ${book.title}`}
                  onClick={() => onDelete(book)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
