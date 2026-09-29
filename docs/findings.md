# Phase 0 — audit before implementation

Audit base: `5cd56a6` (28 September 2026). Application code is unchanged at this
checkpoint. Read all 75 tracked files: README, every docs markdown, Python modules,
rag module/docs, scripts, frontend source/tests/configuration, test fixtures and
Python tests, environment/dependency manifests. Parsed all159 npm lock entries.
Generated/vendor dependencies, private library files and Git internals are not
application source and were excluded. No AGENTS.md or hosting configuration exists.

## Architecture and lifecycle

Upload → suffix/100MiB check → unique copied source and manifest → durable prepare
job → EPUB/PDF extraction (OCR per page) → structure analysis and FTS index → ready.
Listening records a selected chapter; a single worker synthesizes that chapter and
later chapters before earlier ones. A committed sentence has immutable PCM, a
settings fingerprint and SHA256. Resume verifies each chunk and reuses it. FFmpeg
assembles in original chapter order and adds metadata. Edits regenerate one take.

`Jobs` uses an in-process queue/RLock plus a persistent `.worker.lock` for one
worker per data root. Job JSON is durable before enqueue. Startup requeues queued
and running records. `.synthesis.lock` serializes jobs and direct speech requests;
per-session `.lock` excludes concurrent manifest writers. Pause is checked at
sentence boundaries through `listening.json`; no deletion/cancellation state exists.
The worker-owner lock is global and must stay held while other books are active;
deleting a book must release its session/synthesis locks, not permit a second worker.

`uploads/` holds unique source copies; `sessions/<id>/` contains manifest, chunks,
page OCR cache, previews, assembly files and `rag/book.sqlite`. `outputs/` contains
exports. `voices/` retains old consented references. `jobs/<job-id>.json` is keyed
by job ID, NOT project ID. `logs/server.log` is a deployment-wide access log,
not owned by one book. Deletion must remove project-specific records/logs while
retaining shared logs and any source referenced by another live/trashed project.
Reanalysis currently copies the upload instead of sharing it; deletion still needs
to support legacy/manual shared-source manifests correctly.

SSE sends a whole project snapshot or heartbeat every0.5s. Browser EventSource
reconnects; ready audio is fetched individually and four decoded buffers are
scheduled using Web Audio. Playback waits for20 contiguous ready rows. Snapshots
serialize every sentence and fingerprint each row on the async event loop.

## Ranked findings (baseline file/line anchors)

| Rank | Finding | Evidence and consequence |
|---|---|---|
| P0 | No project deletion lifecycle | `pagevoice/api.py:221`, `jobs.py:30,73`: raw directory deletion races the worker and startup can resurrect stale jobs. No trash, undo, cancellation or SSE termination. |
| P0 hosted | No hosted authentication/quota/rate limits | `api.py:80,232`: loopback security is deliberate but cannot be exposed publicly unchanged. Upload size is checked after multipart spooling; suffix alone is accepted. |
| P1 privacy | Preselected network consent | `web/src/App.jsx:66`: `useState(true)` conflicts with the new explicit-consent requirement; README also contains contradictory instructions. |
| P1 deployment | Hard-coded same-origin requests/assets | `web/src/api.js:4`, `App.jsx:93,163,198`, `BookAnalysis.jsx:12`, `listener.js:15`: REST, SSE, preview, audio and download need one direct-backend URL/auth strategy. |
| P1 correctness | Shared source and untrusted manifest paths | `pipeline.py:107,226`, `api.py:156`: `source_name` is joined without canonical validation; uploads are duplicated during reanalysis. New destructive code must reject symlinks/traversal, not trust recorded paths. |
| P1 performance | Synchronous whole-book SSE work | `api.py:112–149,399`: repeated full snapshots/hash work can block event delivery and scales with every connected client. |
| P1 retrieval | No measured relevance contract | `rag/__init__.py:73`: no labelled corpus, metrics, typo/stem/phrase support or no-answer calibration. Current max8 results cannot measure recall@10 directly. |
| P1 retrieval | Index repair and concurrency gaps | `rag/__init__.py:60`: full delete/reinsert on any change, no WAL, corrupt-index recovery, deletion coordination or background rebuild. Book fingerprint serialization happens on every search. |
| P2 structure | Heuristics are not calibrated | `rag/__init__.py:24–50`: titles can override navigation, all navigation implies chapter, headings outside a narrow pattern stay unknown. No numbering/size/duplicate flags. `fold` conflates ñ/n. |
| P2 security | Parser resource bounds incomplete | `book.py:69` caps declared ZIP total but not entry count/ratio; `pdf.py:55` has no page/text/time budget. XML is hardened and OCR pixels capped, but adversarial PDFs can consume worker resources. |
| P2 reliability | Retry set incomplete | `engines.py:71`: retries no-audio/timeout but not transient connection/429/5xx errors; parsing/encoding not cancellable mid-operation. |
| P2 UI | Main listening action below initial viewport | Six screenshots show expanded analysis pushes player below1000px even for a four-sentence book. At768px the language globe stacks above EN. Several secondary labels are11–13px. |
| P2 UI | Long DOM and no navigation persistence | `App.jsx:196`: all sentences rendered, no sleep timer/bookmark/listening position; no upload cancellation/progress or delete. Focus restoration relies on browser default. |
| P2 maintenance | Dead or misleading surface | `voices.py` profile registration/reference retained but new route only returns410; `api.py:214–219`; unused cloning/GPU/model strings/icons/CSS in UI. `say` still public in settings/speech/models, required by many macOS smoke tests. Legacy XTTS manifest readability should remain while obsolete public routes can go. |
| P2 dependency | Test-only pytest advisory | Audit reports PYSEC-2026-1845 twice for pytest8.3.5 (same advisory/aliases); fix version9.0.3. No npm vulnerabilities reported. Runtime lock has no other reported findings. |
| P2 tooling | No CI/lint/types/license/contribution guide | All checks currently operator-driven. Legacy phase docs describe obsolete XTTS setup and should be clearly archival. |

## Baseline verification and dependency health

- `.venv/bin/python -m pytest -q`: **76 passed**, one Starlette/httpx deprecation
  warning,63.62s. Includes actual macOS speech, FFmpeg and English/Spanish Tesseract.
- `npm --prefix web test`: **22 passed**, five files,2.42s.
- `npm --prefix web run build`: passed;1885 modules; JS277.59kB (87.09kB gzip).
- `npm --prefix web audit --json`: **0 vulnerabilities**. Raw report in `audits/`.
- `pip-audit` absent from app venv; installed only in isolated `/tmp/pagevoice-audit-tools`.
  `/tmp/pagevoice-audit-tools/bin/pip-audit -r requirements-core.lock --no-deps
  --disable-pip --format json`: reports two entries for the same pytest advisory.
  Raw report in `audits/pip-baseline.json`; advisory presence is not an exploit proof.
- Docker and Vercel CLIs are not on PATH at baseline. Live deployment credentials
  have not been verified. Container/live deployment cannot be claimed from tests.

## Screenshot baseline

Captured and visually inspected `screenshots/before/{light,dark}-{375,768,1440}.png`
using real headless Chrome, viewport height1000, isolated profile and QA library
containing only our original “The Quiet Harbour” EPUB. No private book text is in
screenshots. All six had scrollWidth equal to viewport width. Both themes render;
player visibility, hierarchy, typography and control density need work. This is
not yet a WCAG contrast/Lighthouse audit.

## Coverage gaps and phase plan

Phase1 tests need cancellation during render, trash undo/expiry/restart, shared
source ownership, traversal/symlinks, SSE closure and index deletion. Phase2 needs
config rejection, exact CORS, auth on SSE/media, body/quota limits, direct URLs,
container runtime and Vercel build/deployed smoke. Phase3 must create the labelled
eval and freeze baseline before algorithms change. Current retrieval assertions
are examples, not a benchmark. Phase4 needs browser keyboard/contrast/motion/
responsive tests and measured Lighthouse. Phase5 needs parser fuzz/resource tests,
chapter edits, tooling/security checks and honest coverage matrix.

Assumption: “one branch” means one new branch `production-quality` for this entire
request, with Phase0 audit commit and one implementation commit per Phase1–5. This
new instruction supersedes the old branch/commit budget. No per-phase squash merge
will lose the phase history. User data stays in the existing local library; tests,
deletions and screenshots use disposable QA data.
