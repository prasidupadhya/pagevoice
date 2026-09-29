# Production overhaul verification

Only executed checks are reported as passed. Work is on `production-quality`, one commit per phase.

## Phase 0

See [findings](findings.md), [audit reports](audits/), and six [before screenshots](screenshots/before/).
Baseline: Python 76 passed (63.62 s); frontend 22 passed; Vite build passed.

## Phase 1 — removal

Changes: durable deletion tombstone, restartable trash moves and purge, eight-second
server-backed Undo, shared-source retention, cancellation at a sentence boundary,
SSE termination, CLI deletion, ownership/size confirmation, typed confirmation for
generated audio, playback cleanup, keyboard dialog focus restoration and reduced-motion-aware shelf reflow.
Consent defaults to unchecked; restoration never starts narration automatically.

Executed:

- `.venv/bin/python -m pytest -q`: **84 passed**, one existing Starlette/httpx deprecation warning, **71.07 s**.
- `npm --prefix web test`: **24 passed**, six files, **2.27 s**.
- `npm --prefix web run build`: passed, **1886 modules**, JS **283.32 kB / 88.97 kB gzip**.

Deletion tests cover idle, rendering, queued/paused recovery, shared-source siblings,
double deletion, partially moved trash, traversal/symlink rejection, SSE closure,
RAG removal/restoration and real CLI removal of owned outputs/jobs/logs.
The CLI test waits through the actual eight-second purge window.
Frontend tests cover typed confirmation, shared-source messaging and server-backed Undo.
The existing 20-sentence progressive listening regression still passes.

Limits: an already running parse or FFmpeg assembly finishes before deletion can
move its files; cancellation is between sentences during synthesis. Confirmation
size is a snapshot; an in-flight sentence can add bytes before deletion completes.
Shared server logs are not project-owned and are retained. No real book was deleted.

## Phase 2 — deployable static reader and persistent worker

Changes: Vercel static build/SPA/security headers/asset caching, Node 22 declaration,
public `VITE_API_BASE_URL`, direct authenticated fetch/SSE/audio transports,
Python 3.12 non-root container and Compose volume, explicit hosts/origins/proxy
trust, hosted shared-token access, per-IP limits, path-scoped expiring media links,
body/container validation and quota admission with translated UI errors.
Hosted UI privacy copy describes server storage. Local consent remains explicit.
Search uses the deletion coordination lock, not the long-held synthesis lock.

Executed:

- `.venv/bin/python -m pytest -q`: **89 passed**, existing warning, **76.91 s**.
- `npm --prefix web test`: **28 passed**, seven files, **2.66 s**.
- `npm --prefix web run build`: passed, **1886 modules**, JS **287.18 kB / 90.34 kB gzip**.
- `VERCEL_TELEMETRY_DISABLED=1 npx --yes vercel@60.1.3 build`: **passed**;
  `.vercel/output` produced successfully. This used an explicitly local project
  settings fixture (Node 22, framework null and the same build/output commands as
  `vercel.json`), not credentials or a linked remote project. The initial attempt
  to discover a real project failed because the existing credentials were invalid.
  **No live deployment was performed, as requested by the user.**
- `docker --context colima-pagevoice-qa build -t pagevoice:phase2 .`: **passed**.
- `DOCKER_CONTEXT=colima-pagevoice-qa docker-compose config --quiet`: passed.
- Full suite inside that image, as UID 10001:
  `python -m pytest -q -c /app/pyproject.toml -p no:cacheprovider /checks`:
  **82 passed, 7 macOS-only tests skipped**, **35.39 s**; existing warning.
- Actual HTTP container smoke: health OK, short EPUB upload/analysis produced two
  chapters, project survived container restart, delete returned 202 and subsequent
  GET 404, Undo restored it. Docker healthcheck reported **healthy**.
- Container tools: **Python 3.12.12**, **FFmpeg 5.1.9**, Tesseract languages
  **eng/osd/spa**; process UID/GID **10001**.
- Regression explicitly verifies analysis/search remains available during a blocked
  synthesis sentence, then deletion completes when that sentence is released.

The first Linux test attempt exposed two existing macOS voice assumptions and one
working-directory-dependent test import. The API tests now use a mocked Edge
adapter with explicit consent; the actual audio assembly still runs FFmpeg.
macOS-only speech smoke checks still run on the host. No Microsoft narration
request was made by these container tests. VM image download failed twice before
succeeding with the curl downloader; this did not require an application workaround.

Deployment acceptance scope was clarified by the user: provide Vercel-deployable
frontend code and instructions; no live deployment or backend hosting is requested.
An actual Vercel domain, HTTPS backend integration and production provider storage
remain **not verified**. The frontend alone cannot parse/narrate books without a
reachable backend. See the deployment checklist before exposing a real library.

## Phase 3 — local retrieval and analysis

- `.venv/bin/python -m pytest -q`: **130 passed**, 76.03 s (existing Starlette/httpx
  deprecation). A final Roman-numbering regression addition was also run with
  `pytest -q tests/test_rag_overhaul.py`: **42 passed**, 1.65 s.
- `npm --prefix web test`: **28 passed**, 7 files, 2.43 s.
- `npm --prefix web run build`: passed, 1,886 modules; JS 287.18 kB / 90.34 kB gzip.
- `pagevoice rag-eval --output rag/eval/after.json --baseline rag/eval/baseline.json`:
  quality regression gate passed. Recall@5 .82 → .94; MRR .770 → .936667.
- 600-page reflowed native PDF: lexical index 0.646 s; search p95 14.667 ms.
  See [full protocol, results and tradeoffs](rag-eval.md).
- Tested query parser with 100 generated Unicode inputs, exact/phrase/stem/fuzzy
  filters, EN/ES accents, ñ distinction, transactional schema replacement, corrupt
  index rebuild, incremental updates, source features, background/deletion locks,
  installer checksum failures and optional-vector manifest invalidation.
- Optional real ONNX weights/inference were not downloaded/run. No semantic-quality
  claims. No held-out corpus or real damaged historical scan benchmark. Typography
  votes accept metadata but PDF font-size extraction is not yet wired into parsing.
- Vercel: user explicitly waived live deployment/authentication; frontend configuration
  and successful local `vercel build` from Phase 2 are the verified scope.

## Phase 4 — reader and analysis UI

- `.venv/bin/python -m pytest -q`: **134 passed**, 76.53 s, one upstream
  Starlette/httpx deprecation warning.
- `npm --prefix web test`: **33 passed**, 8 files, 2.89 s.
- `npm --prefix web run build`: passed; JS 321.93 kB / 101.42 kB gzip, analysis
  view split to 8.64 kB, three self-hosted font subsets.
- Browser screenshots of the same fictional QA project at 375/768/1440, in light
  and dark are saved under `docs/screenshots/after/`. All six DOM reports show
  `scrollWidth == viewport width`; screenshots were visually inspected.
- Lighthouse 13.5.0 against local built frontend + local FastAPI backend, simulated
  mobile profile: Performance **96**, Accessibility **100**, Best Practices **100**,
  SEO **100**. Measurements are audited with gzip enabled; this is a local reader,
  not the live Vercel domain. The compact scores are in `docs/audits/lighthouse-phase4.json`.
- Interaction tests cover per-project sentence priority, twenty decoded initial
  sentences before starting playback, bookmarks, reader text size, upload progress/
  cancellation, focusable source passages, UI translation and dialog operation.
- RareUI could not be retrieved; see the design notes for the exact lookup failure.

## Phase 5 — functional and repository hardening

- `.venv/bin/python -m pytest -q`: **138 passed**, 61.22 s. One upstream
  Starlette/httpx deprecation warning remains. Regression coverage now includes
  source-preserving chapter split/merge and a downloadable ZIP containing the
  audiobook, chapter map and sentence-level citations.
- `npm --prefix web test`: **35 passed**, eight files; lint and Prettier checks pass.
- `npm --prefix web run build`: passed; JS **322.77 kB / 101.69 kB gzip**,
  analysis view **9.61 kB / 3.06 kB gzip**.
- `.venv/bin/ruff check pagevoice rag tests`: passed. Scoped mypy check of the six
  actively maintained parser/retrieval/security modules: **no issues found**.
- Python and npm dependency audits: **zero known vulnerabilities**. Reports are
  checked in under `docs/audits/*-phase5.json`; pytest was updated from 8.3.5 to
  9.0.3 to resolve the baseline advisory.
- `pagevoice rag-eval --baseline rag/eval/after.json`: gate passed. This run:
  recall@5 **0.94**, MRR **0.9367**, classification accuracy/macro-F1 **1.0**,
  no-answer precision **1.0**, search p95 **7.44 ms**, index build **0.31 s**,
  index size **1.46 MB**. Timings vary by machine; the measured index is larger
  and slower to build than the original baseline. See [evaluation](rag-eval.md).
- `VERCEL_TELEMETRY_DISABLED=1 npx --yes vercel@60.1.3 build` could not run in
  this unlinked checkout: the CLI returned `project_settings_required`. The normal
  Vite production build passed. There is no Vercel domain or connected project in
  this workspace, and **no live deployment was attempted**.

## Acceptance checklist

| Requirement | Status | Evidence or remaining limit |
| --- | --- | --- |
| Project deletion, safe cancellation, trash recovery, shared uploads, CLI and undo | Done | Backend, restart and UI tests in the phase 1 suite. |
| Vercel frontend deployment files and separate persistent backend packaging | Done | `vercel.json`, Node 22 build, Docker/Compose and deployment guide. |
| Live Vercel domain and remote browser/backend workflow | Not run | User asked for Vercel frontend readiness, not a live deployment; project credentials/settings are not connected here. |
| Offline EN/ES book analysis and source-grounded lexical retrieval | Done | Fixed-gold corpus and regression gate; optional embeddings are off by default. |
| Retrieval/classifier quality equal or better on all recorded metrics | Partial | Recall and classification improved; build time and index size increased versus baseline. Measurements are corpus-specific. |
| 600-page native-PDF retrieval performance target | Done for that fixture | 0.646 s index build and 14.667 ms p95 search; this does not represent OCR or every PDF layout. |
| Extractive summaries, entities, quotes, repetition and cited Q&A | Done | Verbatim/evidence-only APIs and UI; no generated claims. |
| Responsive EN/ES light/dark UI, keyboard access, reduced motion, delete/undo and sentence listening | Done | Six before/after viewport screenshots, browser interactions and local Lighthouse 96/100/100/100. |
| Consent-gated Edge narration; resumable sentence audio and chaptered M4B/MP3 | Done | Consent, recovery, audio assembly, chapter metadata and 20-sentence buffer tests. Edge remains an online Microsoft service. |
| Chapter split/merge, sentence regeneration and audio + chapter + citation bundle | Done | API and UI edits preserve takes/anchors; API test opens and inspects the ZIP. |
| CI, pinned dependencies, dependency audit, security docs, license and contribution guide | Done | GitHub Actions workflow, Ruff, scoped mypy, ESLint, Prettier, Dependabot and zero-finding local audits. |
| Optional local ONNX semantic model verified on real inference | Not verified | Installation is explicit and hash-pinned, but model weights were not downloaded or exercised. |

The app remains a private local reader by default. Hosted mode is a single shared
library, not a multi-tenant service. See [known limits](../README.md#known-limits)
and [deployment guidance](deployment.md) before exposing a backend.
