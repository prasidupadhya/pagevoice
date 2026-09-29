# Local book analysis and retrieval

Original implementation. Offline lexical analysis is the default: no external
inference, no embeddings by default, no network requests and no generated claims.
Optional local semantic search requires a separate explicit model installation.

`analyze(book)` preserves manual reviews > EPUB semantic roles > structural/title
inference. Every section includes source, excerpt, reasons, weighted signals,
kind, optional subkind, confidence level and review flags. Unknown remains
unclassified. Duplicate titles, numbering gaps, unusual sizes, TOC-like body text
and detected running headers are reviewable; nothing deletes front/back matter.
The first narrative section is suggested for listening. Confidence levels describe
heuristic evidence strength, not probabilities guaranteed on unseen books.

`search(folder, book, query, chapter=None, kind=None, match_type=None, limit=8,
mode='lexical')` uses transactionally refreshed SQLite FTS5 with WAL. English and
Spanish Snowball stemming, accent normalization (ñ remains distinct), stopwords,
weighted BM25, phrase/proximity constraints and deterministic context-window
merging are local. Exact/phrase results rank above stems, partial evidence, then
fuzzy typo fallback. Each hit explains its terms, score components, correction,
match type and stable chapter/sentence/source citation. Explicit operators:
`"blue lantern"`, `NEAR(blue lantern, 3)`, `+lantern -river`, `lanter*`.
Input is tokenized and quoted; raw input is never interpolated into SQL/FTS.
Queries are limited to 500 characters/24 terms, results to 50. SQL work is bounded
by a 250 ms deadline; vocabulary candidates are bounded. No-answer and stopword
queries abstain. Stemming/typos do not invent synonyms.

Content/schema fingerprints detect edits; changed sentences are indexed
incrementally. Schema migrations are transactional; corrupt indexes rebuild from
stored text. Stable IDs survive reindexing and text edits at the same coordinates
(not arbitrary chapter restructuring). Background lexical rebuilds use bounded
workers and coordinate with deletion; listening does not wait for those builds.
A search of a stale index can synchronously refresh it before returning evidence.

`features.py` offers verbatim extractive summaries, heuristic capitalized-name and
keyword indexes, quote/repetition finding, reading-time estimates and extractive
Q&A. Q&A returns supporting source passages or “no supporting passage found”; it
never composes an answer. Heuristic names and section classifications need review.

## Optional local semantic search

Install the optional runtime, then explicitly download the pinned model:

```sh
.venv/bin/pip install '.[semantic]'
.venv/bin/pagevoice rag-model install
.venv/bin/pagevoice rag-model status
```

`PAGEVOICE_RAG_MODEL_DIR` selects storage. `model.json` pins model revision, sizes
and SHA-256 for ONNX/tokenizer/config/model card. Only `rag-model install` downloads;
search never does. No API keys/accounts are needed. The model is multilingual
MiniLM, about 479 MB. First hybrid use verifies hashes and loads CPU ONNX. Batched
SQLite vectors are resumable and invalidate on text or full-model-manifest changes.
Hybrid uses cosine similarity and reciprocal rank fusion; new semantic hits are
labelled. Explicit lexical operators retain lexical-only semantics. Missing model
or runtime falls back to lexical search. No cross-encoder reranker is included.

Model-install checksum failures, resumability and vector invalidation are tested
with controlled fixtures. The real 470 MB ONNX model has **not been downloaded or
benchmarked in this verification run**; semantic quality is not part of the
reported default lexical improvement. Classification can still be wrong.

Run `pagevoice rag-eval --baseline rag/eval/after.json` for the 112-query regression
suite. See [measured results and corpus limits](../docs/rag-eval.md).
