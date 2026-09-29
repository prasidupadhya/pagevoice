# Local RAG evaluation

## Protocol and baseline (before algorithm changes)

Executed `.venv/bin/pagevoice rag-eval --output rag/eval/baseline.json` against the
unchanged `rag/__init__.py` at commit `00fa958`. The harness and gold were written
first. Gold is hand-authored against the stored source passages, never generated
from retrieval results. There are **112 queries: 100 answerable and 12 negative**,
covering exact/phrase, inflection, accents, typos, multi-term, syntax, paraphrase,
stopword-only and no-answer inputs. Categories and individual ranks are retained.

Corpus: four complete short public-domain works/collections, two EN and two ES:
Oscar Wilde's *The Happy Prince and Other Tales*, Beatrix Potter's *The Tale of
Peter Rabbit*, and Bécquer's *Los ojos verdes* and *El beso*. The local evaluation
editions cover nested-TOC EPUB, no-TOC EPUB, native/bookmarked PDF and image-only
scanned PDF. Sources and SHA-256 file hashes are in `rag/eval/manifest.json`.
The scan is **generated from a clean typeset edition**, not a damaged historical
scan. The two Bécquer legends come from the same source edition; they are not
independent publishers. English editorial footnotes from that edition are excluded.

Added acknowledgments/index/bibliography pages are explicitly authored test front/
back matter, not text attributed to the original authors. The prefatory passage
in *Los ojos verdes* is the author's; its “Prólogo” heading is editorial. The four
parsed books supply 21 labelled sections; 29 separately labelled structural rule
cases cover unknowns, manual precedence and EPUB-role precedence (50 total).
This is a development/regression corpus, **not a held-out claim about all books**.

The harness uses frozen parser output for stable gold sentence coordinates and to
isolate retrieval/classification from OCR-version changes. EPUB/PDF input files and
regeneration code are included; `python -m rag.eval.build_fixtures` regenerates
containers and parsed snapshots using installed local OCR. It never downloads data.
Review/re-label changed parser boundaries explicitly; never regenerate expected
answers from search. Existing parsing/OCR tests remain a separate test layer.

A hit is relevant if its returned context window contains a gold chapter/sentence
pair. This rule is identical before and after changes. MRR uses the first relevant
window; binary nDCG@10 normalizes against the labelled relevant pairs. Baseline
retrieval returns at most eight hits; recall@10 reflects that real limitation.
No-answer precision is correct negative abstentions / all abstentions;
no-answer recall is correct negative abstentions / all negative queries. Latency
includes stale-index checks and excludes initial build; index size includes SQLite
sidecars. Times are wall-clock on this machine and are not portable guarantees.

| Metric | Baseline |
| --- | ---: |
| Classification accuracy | 0.880000 |
| Macro-F1 (four kinds) | 0.864025 |
| Recall@1 | 0.730000 |
| Recall@5 | 0.820000 |
| Recall@10 | 0.820000 |
| MRR | 0.770000 |
| nDCG@10 | 0.782856 |
| No-answer precision | 0.500000 |
| No-answer recall | 1.000000 |
| Search p50 / p95 | 0.524 / 1.070 ms |
| Combined index build | 0.0160 s |
| Combined index size | 495,616 bytes |

Per-kind precision/recall/F1, confusion counts, confidence reliability (observed
accuracy per confidence category), per-query ranks, category breakdowns and build
sizes/times are in the checked-in baseline JSON. Confidence categories are
heuristic evidence strength, **not calibrated probabilities**. The reliability
table measures their observed accuracy on this corpus; it does not establish
calibration for unseen books. Regression tolerance is 0.005 absolute for quality
metrics; performance is measured separately to avoid flaky host-dependent CI.

## Sources and rights

Narrative texts were transcribed from these public-domain source editions:

- [Wilde, Project Gutenberg 902](https://www.gutenberg.org/files/902/902-h/902-h.htm)
- [Potter, Project Gutenberg 14838](https://www.gutenberg.org/cache/epub/14838/pg14838-images.html)
- [Bécquer, Project Gutenberg 10814](https://www.gutenberg.org/files/10814/10814-h/10814-h.htm)

Only the narrative texts are redistributed, with normalized whitespace and removed
edition footnote markers; Gutenberg branding/site code is not included. Source
spellings/transcription defects are retained. These works were published before
1929 and their authors died in 1900, 1943 and 1870 respectively. Fixture packaging,
editorial test pages, queries and labels are original PageVoice evaluation data.

## Phase 3 results

Command: `.venv/bin/pagevoice rag-eval --output rag/eval/after.json --baseline rag/eval/baseline.json`.
All quality metrics meet or exceed baseline. These are development-corpus results,
not proof of perfect analysis. Detailed ranks and reliability are in `after.json`.

| Metric | Before | After |
| --- | ---: | ---: |
| Classification accuracy | .880000 | 1.000000 |
| Macro-F1 | .864025 | 1.000000 |
| Recall@1 | .73 | .93 |
| Recall@5 | .82 | .94 |
| Recall@10 | .82 | .95 |
| MRR | .770000 | .936667 |
| nDCG@10 | .782856 | .939871 |
| No-answer precision / recall | .50 / 1.00 | 1.00 / 1.00 |
| Search p50 / p95 (ms) | .524 / 1.070 | 1.354 / 2.886 |
| Index build (s) | .0160 | .2920 |
| Index bytes | 495,616 | 1,462,272 |

**Tradeoff:** stemming, multiple ranking passes, explanatory metadata and retained
surface forms increase index size, build time and small-corpus latency. Therefore
the literal request that *every* metric improve is not met for time/space. Quality
improves; absolute performance targets are tested separately, not disguised as
regressions that disappeared. CI checks quality against the improved snapshot with
0.005 tolerance; it does not assert machine-dependent timings.

### Observed reliability after changes

| Level | Sections | Correct |
| --- | ---: | ---: |
| high | 32 | 100.0% |
| low | 4 | 100.0% |
| medium | 14 | 100.0% |

### 600-page performance check

Source: [Austen, Pride and Prejudice, Gutenberg 1342](https://www.gutenberg.org/ebooks/1342).
The complete source was reflowed into an actual **600-page native PDF**, with 60
artificial bookmarks to bound sections. This is not original-edition pagination
and does not measure OCR speed. 127,360 words / 6,224 parsed sentences.

Command: `.venv/bin/python -m rag.eval.benchmark /tmp/pv-austen.txt --output /tmp/pv-600-benchmark.json`.
macOS 26.6.2 arm64, Python 3.10.12: PDF parse **5.932 s**, lexical build **0.646 s**,
index **4,726,784 bytes**; 100 queries: p50 **11.966 ms**, p95 **14.667 ms**.
Both requested targets (<10 s build, <100 ms p95) pass on this fixture/machine.
Raw results and source SHA-256: `rag/eval/benchmark-600.json`. The benchmark command
requires a local source text and never downloads it. Peak memory was not measured.
