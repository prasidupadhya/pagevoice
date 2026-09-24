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
The browser interface is served from `web/dist` when built.

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

## Voices, casting and compatible speech

- `GET /api/voices`: consent-based local profiles.
- `POST /api/voices`: multipart `file`, `name`, `language` (en/es), `consent=true`;
  validates duration 5–15 seconds, size up to 20 MB, stores normalized PCM + checksum.
- `POST /api/projects/{id}/speakers/detect`: suggest sentence speakers while preserving
  existing manual assignments. Dialogue without a name becomes `Dialogue`.
- `PATCH /api/projects/{id}/casting`: merge `{"cast":{"Mira":"Daniel"},
  "tags":{"0000-00001":"Mira"}}`. Tags refer to stable sentence IDs. Busy projects
  reject edits. Engine changes clear voice assignments but retain speaker tags.
- `GET /v1/models`: local engine IDs; use `/api/engines` for install/model readiness.
- `POST /v1/audio/speech`: `model`, `input` (1–4096 characters), `voice`, optional
  `response_format` (mp3 default, wav, pcm, flac, aac, opus), `speed` (0.25–4),
  `language` (en default or es), `allow_network` (false default).
  `stream_format` supports only `audio`; nonempty `instructions` are rejected.
  PCM is signed 16-bit little-endian mono at 24 kHz. Opus is returned in Ogg.
  Voice names come from the local catalogue, not OpenAI's voice names.
  Returns the completed binary response, with an appropriate Content-Type.
  Shared synthesis locking serializes jobs and speech; concurrent speech gets 409.

```sh
curl http://127.0.0.1:8765/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"say","voice":"Monica","language":"es","input":"Hola, bienvenidos.","response_format":"mp3"}' \
  --output greeting.mp3
```

The request shape was checked against the official [OpenAI speech API reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create).
This is a compatible local subset, not an implementation of OpenAI model names,
style instructions, custom voice objects, or streaming speech events.
