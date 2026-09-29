# Deploy the reader on Vercel, the worker on a persistent host

PageVoice's default mode remains local and account-free. Hosted mode is a **private,
single-library deployment**, protected by one shared access token. Anyone with that
token can read, narrate and delete all books in that deployment. It is not a
multi-tenant public service. Use a separate backend and volume per household/team.

## Why two services

Verified against current official documentation on 2026-09-28:
[Vercel Function limits](https://vercel.com/docs/functions/limitations),
[static project configuration](https://vercel.com/docs/project-configuration/vercel-json),
and [`vercel build`](https://vercel.com/docs/cli/build).
Functions have a 4.5 MB request/response limit. PageVoice accepts books up to 100 MB,
uses SQLite, FFmpeg, OCR and a durable queue, and needs persistent writable storage.
The Vercel deployment therefore contains only static frontend assets. Uploads, SSE,
sentence audio and final downloads go **directly from the browser to the backend**.
No Vercel Function or rewrite proxies book content.

## Local container setup

Requirements: Docker with Compose, Node 22 (tested locally with 22.13.1).
The backend image uses Python 3.12.12, FFmpeg and Tesseract with English/Spanish data.

```sh
docker compose up --build -d
npm ci --prefix web
npm --prefix web run dev
```

Open http://127.0.0.1:5173. Vite proxies API requests to port 8765 during development.
The named `books` volume survives container replacement. `docker compose down`
keeps it; **do not use `down -v` if you want to retain books**. Container processes
run as UID/GID 10001. No model is downloaded at build or runtime.
Only one worker/container may use a given data volume. Keep replicas at one.

## Vercel frontend with a backend on your computer

This option deploys only the static UI. Every person using it needs PageVoice
running on the same computer as their browser; books, analysis and audio stay in that
computer's Docker volume. It does not make your local library available to other
computers. For a shared or always-on library, use the persistent-backend setup below.

1. In Vercel **Project → Settings → Environment Variables**, set
   `VITE_API_BASE_URL` to `http://127.0.0.1:8765` for Production (and Preview only if
   you intend to use preview URLs). Redeploy so Vite bakes the value into the UI.
   The deployed Vercel build must include the CSP change that permits this loopback
   API address.
2. Identify the stable public origin of the deployed frontend, for example
   `https://pagevoice.example.com` (scheme and hostname only, no trailing slash).
   In this repository, copy `.env.example` to `.env` and set
   `PAGEVOICE_ALLOWED_ORIGINS` to the exact frontend origin plus the two local dev
   origins if you still use Vite, e.g.
   `https://pagevoice.example.com,http://localhost:5173,http://127.0.0.1:5173`.
   Do not use a wildcard or a per-deployment preview URL as a broad allowlist.
3. On the computer that will hold the books, run `docker compose up --build -d` from
   this repository. Confirm `http://127.0.0.1:8765/api/health` returns a response
   whose `status` field is `ok`.
4. Open the stable HTTPS Vercel site in Chrome 142 or later on that same computer.
   If Chrome asks to let the site access your local network, allow it. Chrome gates
   public-site requests to localhost behind this permission; if denied, use the site
   permission controls to allow local network access, then reload. See [Chrome's
   Local Network Access guidance](https://developer.chrome.com/blog/local-network-access).
   Other browsers may expose a similar permission or apply different local-network
   rules.

The localhost listener is bound to `127.0.0.1` and is not exposed to the internet.
The Vercel CSP permits HTTP only to this loopback address and port; it does not permit
arbitrary HTTP backends. Use an HTTPS backend URL for a remotely hosted service.
Because this setup uses your browser to connect from a public HTTPS page to a local
HTTP API, browser local-network permission and the exact CORS origin are required.
The deployment cannot work for a visitor whose own computer does not run PageVoice.

## Persistent backend (Render, Railway, Fly.io or a VPS)

1. Build the repository's `Dockerfile`; set service port 8765 and health path
   `/api/health`. Allocate a persistent volume at `/data`, writable by UID 10001.
   For a VPS bind mount, create and chown that directory before running the image.
2. Set `PAGEVOICE_HOSTED=1`, `PAGEVOICE_HOST=0.0.0.0`, `PAGEVOICE_DATA=/data`.
   Generate a long random token locally (`openssl rand -hex 32`) and store it as a
   backend **secret** named `PAGEVOICE_ACCESS_TOKEN`. Do not commit it or put it in
   a frontend build variable.
3. Set `PAGEVOICE_ALLOWED_HOSTS=books.example.com` and
   `PAGEVOICE_ALLOWED_ORIGINS=https://reader.example.com`. These are exact
   allowlists, not wildcards. Preview deployments need their own explicit origin;
   a separate staging backend/volume is preferable to access to production books.
4. Terminate HTTPS at the host's reverse proxy. Forward requests and streaming
   responses without buffering. Allow upload bodies of at least 101 MiB and long
   SSE connections; keep-alive timeouts must exceed the heartbeat interval.
   Never expose an unauthenticated local-mode backend to the public internet.
5. If the proxy supplies client IPs, set `PAGEVOICE_TRUSTED_PROXIES` to its actual
   IPs/CIDRs and ensure the container cannot be reached while bypassing that proxy.
   Empty (default) ignores forwarded headers. `*` is rejected. Without trusted
   forwarding, clients behind one proxy share its rate bucket.
6. Set a disk quota below the volume capacity, leaving space for system operation.
   The application checks usage before upload, sentence generation and assembly;
   these are conservative admission checks, not an OS-level hard filesystem quota.
   Use the host's volume quota as the final hard bound. Trash counts until purged.
7. Disable query-string logging at the proxy. App access logging is disabled.
   Media links carry expiring, path-scoped read capabilities (about one hour).
   Treat a copied link like a temporary download invitation. Rotating the shared
   token invalidates outstanding links; restart the backend after changing it.
8. Back up `/data` when idle/stopped, including sessions, uploads, jobs and trash.
   Restore the whole volume together. A deployment with an empty volume is a new
   isolated library. Existing volumes must never be mounted in multiple writers.

## Vercel frontend

1. Import this GitHub repository in Vercel. Use the **repository root**, framework
   "Other", Node **22.x**. `vercel.json` supplies install/build/output settings.
2. For a persistent remote backend, set the public build variable
   `VITE_API_BASE_URL=https://books.example.com`. For a local backend on each
   visitor's computer, use `http://127.0.0.1:8765` and follow the section above. No
   trailing slash is necessary. **Never add the backend token to Vercel.**
3. Deploy. Set the stable frontend domain in the backend origin allowlist.
   The included CSP permits HTTPS backend connections/media and the local loopback
   backend at `127.0.0.1:8765`; for a fixed remote deployment, narrow its `connect-src`
   and `media-src` `https:` entries to the backend origin. Hashed assets cache for one
   year; the HTML entry point is revalidated.
4. Open the frontend and enter the access token in the private-library dialog.
   It is kept only in tab memory, not localStorage, cookies or URLs. Reloading asks
   again. Authenticated SSE uses fetch with an Authorization header. Browser audio
   controls and downloads use the backend-issued signed media URLs, avoiding
   third-party-cookie dependencies.
5. For CLI verification, authenticate and link the real project first:

   ```sh
   npx --yes vercel@60.1.3 login
   npx --yes vercel@60.1.3 link
   npx --yes vercel@60.1.3 pull --yes --environment=production
   npx --yes vercel@60.1.3 build --prod
   ```

   A local build does not prove a live deployment, DNS, TLS, CORS or provider volume
   configuration. See [verification](verification.md) for exactly what was run.

## Environment reference

These variables are exported by the shell/container/platform. `.env.example` is a
reference; the Python application does not implicitly read `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PAGEVOICE_DATA` | `.`; image `/data` | Dedicated persistent library root |
| `PAGEVOICE_HOST` | `127.0.0.1`; image `0.0.0.0` | Bind address |
| `PAGEVOICE_PORT` | `8765` | HTTP port |
| `PAGEVOICE_HOSTED` | `0` | `1` requires hosted access controls |
| `PAGEVOICE_ACCESS_TOKEN` | empty | Hosted secret, at least 32 characters |
| `PAGEVOICE_ALLOWED_HOSTS` | localhost,127.0.0.1,::1,testserver | Hostnames without scheme/port; explicitly required when hosted |
| `PAGEVOICE_ALLOWED_ORIGINS` | empty | Exact comma-separated frontend origins; empty permits loopback origins locally only |
| `PAGEVOICE_TRUSTED_PROXIES` | empty | Explicit proxy IPs/CIDRs; no wildcard |
| `PAGEVOICE_DISK_QUOTA_MB` | `10240` | Admission quota in MiB, including trash |
| `PAGEVOICE_RATE_LIMIT` | `600` | Hosted requests per IP per minute |
| `VITE_API_BASE_URL` | empty | Public build-time backend origin; empty means same-origin |

## Deployment smoke checklist

Run against the actual HTTPS frontend/backend pair, using a short non-sensitive book:

- [ ] Health is OK; requests with an unlisted Host/Origin are rejected.
- [ ] Library API without a token is 401; correct token opens the library.
- [ ] Upload an EPUB and PDF; verify analysis and language selection.
- [ ] Invalid/oversized uploads are rejected with visible errors.
- [ ] Consent starts unchecked; no narration starts without an explicit action.
- [ ] After consent, Listen from here buffers 20 consecutive prepared sentences
      (or the remaining book if shorter), plays and continues preparation.
- [ ] SSE reconnects; switching chapters changes priority; playback audio is direct
      from the backend origin. Verify browser Network panel.
- [ ] M4B/MP3 download works, including Range requests/seeking.
- [ ] Delete stops playback and preparation; Undo restores within eight seconds.
- [ ] Restart the container: data remains, deleted projects do not return.
- [ ] Quota and rate-limit errors remain readable across CORS.

Edge TTS through `edge-tts` is an **unofficial** use of Microsoft's online service.
Availability, voices and service terms can change; public hosting may raise terms
and capacity issues. PageVoice makes no service-availability guarantee. Narration
text leaves the backend for Microsoft **only with explicit consent**. In hosted
mode book files/analysis/audio reside on your selected server, not the reader's device.
The default local mode keeps them on the user's computer.

The optional Vercel Blob/external-worker redesign is not implemented in this phase.

Optional semantic model: `docker build --build-arg PAGEVOICE_BAKE_RAG_MODEL=1 -t
pagevoice-semantic .` explicitly installs the optional ONNX runtime and downloads
SHA-256-pinned model files into `/opt/pagevoice-model`. The default build argument
is 0: no model download. This increases image size substantially and has not been
verified with the real model in this run. Runtime override: `PAGEVOICE_RAG_MODEL_DIR`.
