# PocketBase guest library verification

Verified on 2026-09-29/30 for PR [#34](https://github.com/prasidupadhya/pagevoice/pull/34).
The implementation was tested with a real local PocketBase 0.40.4 process and
PageVoice worker. The public server infrastructure has not been provisioned.

## Automated checks

| Command | Actual result |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 141 passed in 65.91 s; one existing Starlette/httpx deprecation warning |
| `npm --prefix web test -- --run` | 86 passed across 19 files |
| `npm --prefix web run build` | Passed with Vite 8.3.0 |
| `npm --prefix web run lint` | Passed |
| `npm --prefix web run format:check` | Passed |
| `.venv/bin/python -m ruff check pagevoice tests/test_hosting.py` | Passed |
| `npm --prefix web audit --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | Passed |

GitHub Actions also passed its Python 3.12 tests, Ruff, mypy, RAG evaluation,
Python dependency audit, and Node 22 web checks on commit `3888166`.
Vercel's GitHub integration reported **Deployment has completed** for that commit.
The preview URL requires Vercel login, so the hosted page itself could not be
inspected. This confirms a successful Vercel frontend build/deployment, not a
working hosted PocketBase/worker pair.

## Real local integration checks

- Applied `pb_migrations/1760000000_guest_libraries.js` with the PocketBase 0.40.4
  binary. Guest registration, password authentication and auth-refresh returned 200.
- Created two separate guests. The first saw its one metadata record; the second
  saw none. Cross-guest metadata read, update and delete returned 404. Changing a
  record's owner was rejected.
- Used the collaborative browser against the built Vite frontend, real
  PocketBase and FastAPI processes. Uploaded an original short EPUB through the
  UI: two chapters and four sentences appeared, and its metadata was saved in
  PocketBase. Uploaded a native-text PDF: its heading and four sentences appeared.
- Refreshed the page: the guest's books remained. Deleted the EPUB using its
  confirmation dialog and restored it through the eight-second Undo toast.
- Explicitly enabled Edge narration for the original sample EPUB. All four
  sentences prepared and the reader entered its listening state. The completed
  M4B download returned HTTP 200, `audio/mp4`, and 106,730 bytes.
- Created another real guest without replacing the browser's first identity.
  Its PageVoice list returned 200 with zero projects; requesting the first
  guest's project returned 404.
- Restarted the worker against the same data folder. The original guest still
  saw the completed project, four prepared sentences and an available output.
- Rebuilt with explicit origins and loaded the built page with its generated
  CSP. Both books were visible with no app error alerts. At 375 CSS pixels the
  dark reader had no horizontal overflow (`scrollWidth = clientWidth = 375`).

## Remaining deployment work

Docker image builds were not run: this machine had no running Docker daemon or
Compose plugin. The local native-process integration does not verify containers.
`vercel build` was not run locally because no authenticated/linked CLI project
was available; the real GitHub-triggered Vercel deployment passed instead.

Public upload, narration and persistent libraries require the operator to host
PocketBase and PageVoice with durable volumes and HTTPS, then set both
`VITE_API_BASE_URL` and `VITE_POCKETBASE_URL` and redeploy. No production origins
or host access were supplied. The application shows setup guidance when that
configuration is absent. Follow [deployment.md](deployment.md) and its live smoke
checklist; do not describe the public app as fully functional until that passes.

Guest identity remains tied to a browser profile. Clearing its local storage
loses access, and there is no recovery or cross-device sign-in flow. Narration
still needs explicit Microsoft consent. Audio and source files reside on the
worker volume; PocketBase holds identity and book metadata.
