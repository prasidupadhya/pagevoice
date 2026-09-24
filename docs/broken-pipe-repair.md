# Broken-pipe repair — 2026-09-24

## Cause and reproduction

The pipeline used `print(..., flush=True)` for session and chunk progress.
The web server inherited its launcher's stdout pipe. After that pipe's reader
closed, printing raised `BrokenPipeError`, aborting an upload or narration job
although the audio engine itself could continue. Earlier tests kept the terminal
connected and did not cover that lifecycle.

A regression launches the real API in a subprocess, closes the parent's read end
of stdout, and performs upload → prepare → preview → render → download → sentence
regeneration. Before the fix, upload returned HTTP 500 and the test failed.
After the fix it passes with both deterministic test audio and real macOS speech.

## Repair

- Pipeline progress uses logging, with terminal output configured only by the CLI.
  The API relies on its durable session state and SSE; it does not print progress.
  CLI progress now goes to stderr; JSON inspection remains on stdout.
- Failed jobs retain a traceback in their local job record for diagnosis.
- Uvicorn's graceful shutdown has a five-second timeout so an open SSE connection
  cannot hold an old server alive indefinitely. The regression keeps SSE open
  while terminating the production entry point and verifies bounded exit.
- The running server was relaunched detached with stdout/stderr directed to
  `logs/server.log`, a regular file, rather than a transient tool-output pipe.
  Logs are excluded from Git. Normal foreground `scripts/start.sh` still works.

## Executed checks

```text
Before repair:
pytest tests/test_detached_server.py
1 failed: upload returned 500 after stdout reader closed

After progress repair:
pytest -q
45 passed, 1 warning

After adding bounded shutdown, with SSE deliberately left open:
pytest -q tests/test_detached_server.py
2 passed, 1 warning in 18.54s

npm --prefix web test
8 passed

npm --prefix web run build
built successfully in 268ms

git diff --check
(no errors)
```

The warning is the existing Starlette/httpx TestClient deprecation warning.
The added subprocess tests cover the actual server entry point, worker, persistence,
FFmpeg, HTTP responses, real closed OS pipe, and shutdown lifecycle.

## Recovered library state

Both previews that reported `[Errno 32] Broken pipe` were retried through the API,
then their complete audiobooks were rendered and downloaded successfully:

| Language | Preview bytes | M4B download bytes |
| --- | ---: | ---: |
| English | 82,020 | 104,702 |
| Spanish | 89,706 | 143,944 |

Their current project/job states no longer report the pipe error. Three interrupted
uploads were also prepared successfully, each with 12 chapters. Existing voices,
book text and settings were preserved; no library entries were deleted.

The local app is served at `http://127.0.0.1:8766/`. The original engine-verification
limits still apply: XTTS weights/license setup and actual neural cloning are pending;
this repair does not claim to verify them or online Edge synthesis.
