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
