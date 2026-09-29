import React from "react";
import { apiURL } from "./api";
export function BookCover({ book, large = false }) {
  let hash = 0;
  for (const c of book.title || "") hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className={`book-cover ${large ? "large" : ""}`}
      style={{ "--cover-hue": hash % 360 }}
      aria-hidden="true"
    >
      {book.cover ? (
        <img src={apiURL(book.cover)} alt="" loading="lazy" />
      ) : (
        <>
          <span className="cover-title">{book.title}</span>
          <span className="cover-language">{book.language?.toUpperCase()}</span>
        </>
      )}
      <span
        className="ribbon"
        style={{
          height: `${Math.max(8, Math.min(92, (100 * (book.progress?.complete || 0)) / (book.progress?.total || 1)))}%`,
        }}
      />
    </span>
  );
}
