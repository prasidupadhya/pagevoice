// Placeholder with the same grid as the real shelf, so content does not jump in.
export default function ShelfSkeleton({ t }) {
  return (
    <section className="library-shelf skeleton-shelf" aria-busy="true">
      <p className="sr-only">{t("loadingLibrary")}</p>
      <div className="shelf-heading" aria-hidden="true">
        <span className="skeleton-line skeleton-title" />
      </div>
      <div className="shelf-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="shelf-book skeleton-book" key={i}>
            <span className="skeleton-cover" />
            <span className="skeleton-line" />
            <span className="skeleton-line short" />
          </div>
        ))}
      </div>
    </section>
  );
}
