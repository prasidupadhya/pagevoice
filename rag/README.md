# Local book analysis and retrieval

Original, offline Python implementation. No external inference, embeddings,
network access or generated factual claims.

`analyze(book)` classifies sections using manual reviews, EPUB semantic roles,
section titles, document navigation/bookmarks and conservative fallback rules.
Every decision exposes its reason, source, confidence category and opening excerpt.
Manual reviews and document roles outrank title guesses. Unknown boundaries stay
unclassified; source text is retained. The first narrative section is suggested
for listening. The UI can correct titles, roles and listening start.

`search(folder, book, query, chapter=None)` maintains a transactionally refreshed
SQLite FTS5 index. Unicode accents are normalized. English/Spanish stopwords are
removed; complete keyword matches rank ahead of explicitly labelled partial
matches. Each hit includes neighbouring sentences and stable chapter/sentence/source
citations; overlapping context windows are deduplicated. Empty/stopword-only
queries return no evidence. A chapter filter limits retrieval scope.

The index is the retrieval foundation of RAG, not a generative assistant. It does
not infer answers from unrelated passages or claim synonym/semantic search.
Classification can be wrong; the correction UI and review flags are intentional.
A content/version fingerprint invalidates stale indexes after text/structure edits.
