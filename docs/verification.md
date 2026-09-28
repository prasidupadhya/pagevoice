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
