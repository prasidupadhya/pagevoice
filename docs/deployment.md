# Deploy PageVoice for private guest libraries

PageVoice needs three processes: a static React site on Vercel, PocketBase for browser-specific guest identity and library metadata, and the Python/FFmpeg worker for book files, OCR, sentence audio, and M4B/MP3. Vercel hosts only the static site. Book files and audio persist on the worker volume, **not** in PocketBase or Vercel. The two server processes can run on one VPS/container host, but need separate persistent volumes. Keep a single PageVoice worker per volume.

PocketBase creates a random guest identity silently on first visit. There is no signup screen or password for visitors to remember. Its secret is saved in that browser profile; clearing browser storage or changing devices loses the library. This offers browser-level separation, not recoverable human accounts. Do not use the legacy shared-token mode for a public site: everyone with that token sees the same books. PocketBase is [self-hosted and pre-1.0](https://pocketbase.io/docs/going-to-production/), so pin upgrades, back up its volume, and test migrations before upgrading.

## 1. Prepare a persistent host

Install Docker Compose and an HTTPS reverse proxy such as Caddy. Copy `.env.example` to `.env` on the host. Set the following values (replace all example domains with domains you control):

```dotenv
PAGEVOICE_MEDIA_SECRET=<unique random value of at least 32 characters>
PAGEVOICE_ALLOWED_HOSTS=api.example.com
PAGEVOICE_ALLOWED_ORIGINS=https://reader.example.com
PB_ALLOWED_ORIGINS=https://reader.example.com
```

Generate the media secret with `openssl rand -hex 32`; keep it out of Git and Vercel. `docker compose up --build -d` builds the pinned PocketBase 0.40.4 and Python images and starts both with separate named volumes. Compose binds ports 8765 and 8090 to **host loopback**. Use the example [Caddyfile](../deploy/Caddyfile.example) to terminate HTTPS for the API and PocketBase on separate domains. Point their DNS records at this host. Do not expose the raw Compose ports publicly. A host platform that offers HTTPS routing and durable volumes can replace Caddy/Compose, but must preserve the same origins, volumes, and single-worker rule.

Check `https://api.example.com/api/health` and `https://identity.example.com/api/health`. The PocketBase migration creates `guests` and owner-locked `books` collections automatically at startup. Its API rules enforce owner-only list/view/update/delete. The PageVoice API independently verifies the PocketBase token and owner for project, SSE, storage, delete, and restore routes. Short-lived signed URLs grant read-only access to one audio/media path; treat copied URLs as temporary download links.

Back up **both volumes together**. Do not run `docker compose down -v` unless you intend to destroy all libraries. Set host-level volume quotas/monitoring: the application's admission checks are not a hard filesystem quota. Default per-guest quota is 2 GiB (`PAGEVOICE_USER_QUOTA_MB`), total quota 10 GiB (`PAGEVOICE_DISK_QUOTA_MB`), and API limit 600 requests/IP/minute. PocketBase registration has a stricter limit. Public hosting can still incur CPU, storage, bandwidth, and Microsoft service costs.

## 2. Configure the Vercel static frontend

Import the **repository root** into Vercel with Node 22. `vercel.mjs` supplies `npm ci --prefix web`, `npm --prefix web run build`, output `web/dist`, SPA rewrites, immutable hashed assets, and a CSP limited to the configured origins. Set these Production environment variables, then redeploy:

```dotenv
VITE_API_BASE_URL=https://api.example.com
VITE_POCKETBASE_URL=https://identity.example.com
```

They are public origins, **not secrets**. Set them for Preview only if the preview URL is also explicitly allowed by `PAGEVOICE_ALLOWED_ORIGINS` and `PB_ALLOWED_ORIGINS`; a staging backend/volume is safer. No Vercel function, database, Blob account, or backend rewrite is used. Browser upload, SSE, and audio transfer go directly to the API host. `vercel.mjs` derives the exact `connect-src` and `media-src` CSP entries at build time. Neither origin may be an arbitrary HTTP URL; HTTP is accepted only for loopback development.

Without both origins, a public frontend shows setup guidance rather than a misleading temporary library. Local development without them still offers the in-memory device-voice reader. Existing private token-mode API setups remain supported separately; they do not offer visitor isolation.

## 3. Verify on the real domains

- Open the site in a fresh browser profile. It should create a private guest identity without asking the visitor to sign up.
- Upload a small EPUB and PDF. Confirm chapter analysis, search, and owner-only library contents after refresh.
- Explicitly consent to online narration, choose an Edge voice, listen after the buffer fills, and download an M4B/MP3. Edge text leaves the worker for Microsoft only after this consent.
- Open a second isolated browser profile. It must start empty and receive 404 for the first profile's project IDs, even if the first profile's ID is known.
- Delete, Undo, refresh, and restart both containers. Verify restored and retained books, and verify permanently deleted books stay gone.
- Inspect browser Network/CSP/CORS errors and the two persistent volumes. Test failure messages for expired identity, a full quota, and Edge service failure.

`npx --yes vercel@60.1.3 build --prod` requires a linked and authenticated Vercel project. A local Vite build proves bundling, not a live deployment, HTTPS, DNS, reverse proxy, or persistent-volume behavior. Do not claim the public site works until the real domains pass the checklist above.

## Environment reference

| Variable | Where | Meaning |
| --- | --- | --- |
| `PAGEVOICE_DATA` | worker | Durable data root, `/data` in Docker |
| `PAGEVOICE_HOSTED` | worker | `1` enables hosted restrictions |
| `PAGEVOICE_AUTH_MODE` | worker | `pocketbase` for private guests; `token` is legacy shared library |
| `PAGEVOICE_POCKETBASE_URL` | worker | Internal PocketBase origin (`http://pocketbase:8090` in Compose) |
| `PAGEVOICE_POCKETBASE_AUTH_COLLECTION` | worker | `guests` |
| `PAGEVOICE_MEDIA_SECRET` | worker | Secret used to sign read-only media URLs, 32+ characters |
| `PAGEVOICE_ALLOWED_HOSTS` | worker | Exact API hostname(s), no wildcards |
| `PAGEVOICE_ALLOWED_ORIGINS` | worker | Exact frontend origin(s), no wildcards |
| `PB_ALLOWED_ORIGINS` | PocketBase | Exact frontend origin(s) for browser CORS |
| `PAGEVOICE_TRUSTED_PROXIES` | worker | Exact proxy IPs/CIDRs; empty ignores forwarded headers |
| `PAGEVOICE_DISK_QUOTA_MB` | worker | Total admission quota, default 10240 |
| `PAGEVOICE_USER_QUOTA_MB` | worker | Per-guest admission quota, default 2048 |
| `PAGEVOICE_RATE_LIMIT` | worker | Hosted API requests/IP/minute, default 600 |
| `VITE_API_BASE_URL` | Vercel | Public HTTPS API origin |
| `VITE_POCKETBASE_URL` | Vercel | Public HTTPS PocketBase origin |
| `PAGEVOICE_ACCESS_TOKEN` | legacy worker only | Shared-token secret; never expose in Vite variables |

Edge TTS through `edge-tts` is an **unofficial** use of Microsoft's online service. Its availability, voices, and terms may change, especially for public hosting. Set no Microsoft or PocketBase superuser credential in browser variables.
