# Local API

Install with `./scripts/setup.sh`; run `.venv/bin/pagevoice-server`.
Default address: http://127.0.0.1:8765. Override with `PAGEVOICE_PORT=8766` if
occupied. Bind is loopback only. The app rejects foreign Host/Origin and
cross-site fetch requests. No accounts or cloud service is required.
Use a single server process per data directory; a persistent worker lock
prevents two queues from modifying the same local data.

| Method and path | Purpose |
| --- | --- |
| GET /api/health | Supported languages and health |
| GET /api/hardware | Local acceleration/tool detection |
| GET /api/engines | Engine catalogue, built-in voices, model readiness |
| GET /api/projects | Saved projects |
| POST /api/projects | Multipart PDF/EPUB upload; language en/es, OCR auto/always/never |
| GET /api/projects/{id} | Chapters, sentences, progress, current output |
| PATCH /api/projects/{id}/settings | Engine, voice, device, M4B/MP3 settings |
| POST /api/projects/{id}/preview | Render one chapter, JSON chapter index |
| POST /api/projects/{id}/render | Render remaining chunks and export |
| POST /api/projects/{id}/resume | Recover parsing/rendering |
| POST /api/projects/{id}/regen | Regenerate sentence_id with optional text |
| GET /api/projects/{id}/events | SSE progress snapshots and heartbeats |
| GET /api/projects/{id}/download | Download current completed audiobook |
| GET /api/projects/{id}/previews/{chapter} | Chapter MP3 playback |
| GET /api/projects/{id}/sentences/{sentence_id}/audio | Current sentence WAV |

Render requests take `{ "allow_network": false }`; Edge requires explicit true.
Language selection is limited to English/Spanish and does not translate the book.
The browser interface will be served from `web/dist` when built.

The queue writes `jobs/<id>.json` before executing. Jobs that were queued/running
are requeued at startup. Only one job per project may be queued/running. Regeneration
requests carry an idempotency token so replay does not repeatedly request new takes.
Chapter previews reuse the same sentence chunks as full renders. SSE reconnects
receive the latest complete snapshot; no volatile event replay buffer is needed.

Uploads are capped at 100 MB after multipart parsing. This is a trusted local app,
not an Internet-facing upload service. Stop the server before editing state files.
The UI never automatically accepts XTTS model terms. Use `pagevoice setup-xtts`
interactively to install the model after reviewing its prompt. XTTS synthesis
requests without cached model files fail promptly with setup instructions.

## Verified

- 22 pipeline/language tests passed after API refactoring.
- 4 API tests passed: prepare→preview→render→regen→download, rejected inputs and
  origins, durable queue recovery, and idempotent regeneration replay.
- A real server on port 8766 received a Spanish EPUB over HTTP, emitted an SSE
  snapshot, synthesized four chunks using Monica, and downloaded 143944 bytes
  of M4B audio. The normal 8765 port was occupied; no unrelated process was stopped.
- FastAPI 0.141.1, Uvicorn 0.53.0, python-multipart 0.0.32, Pydantic 2.13.5,
  httpx 0.28.1. TestClient reports a non-failing httpx deprecation warning.
