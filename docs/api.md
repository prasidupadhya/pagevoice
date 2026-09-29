# Local API

Install with `./scripts/setup.sh`; run `.venv/bin/pagevoice-server`.
Default address: http://127.0.0.1:8765. Override with `PAGEVOICE_PORT=8766` if
occupied. Bind is loopback only. The app rejects foreign Host/Origin and
cross-site fetch requests. No accounts are required. Edge narration sends text to Microsoft and requires Internet access.
Use a single server process per data directory; a persistent worker lock
prevents two queues from modifying the same local data.

| Method and path | Purpose |
| --- | --- |
| GET /api/health | Supported languages and health |
| GET /api/hardware | Local acceleration/tool detection |
| GET /api/engines | Edge catalogue and eleven built-in voices |
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
XTTS and cloning are removed. Legacy projects/audio remain readable; reanalyze a
copy and select Edge to prepare new audio. See [quality verification](quality-verification.md)
for current checks and limitations.

## Voices, casting and compatible speech

- `GET /api/voices`: archived local profiles, retained for compatibility.
- `POST /api/voices`: returns410; cloning uploads are removed.
- `POST /api/projects/{id}/speakers/detect`: suggest sentence speakers while preserving
  existing manual assignments. Dialogue without a name becomes `Dialogue`.
- `PATCH /api/projects/{id}/casting`: merge `{"cast":{"Mira":"Daniel"},
  "tags":{"0000-00001":"Mira"}}`. Tags refer to stable sentence IDs. Busy projects
  reject edits. Engine changes clear voice assignments but retain speaker tags.
- `GET /v1/models`: Edge and the legacy macOS `say` diagnostic; the website exposes only Edge.
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
  -d '{"model":"edge","voice":"es-ES-ElviraNeural","allow_network":true,"language":"es","input":"Hola, bienvenidos.","response_format":"mp3"}' \
  --output greeting.mp3
```

The request shape was checked against the official [OpenAI speech API reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create).
This is a compatible local subset, not an implementation of OpenAI model names,
style instructions, custom voice objects, or streaming speech events.

## Progressive listening

`POST /api/projects/{id}/listen`, JSON `{"chapter":2,"allow_network":false}`,
prioritizes the zero-based chapter and schedules the whole book. When a render,
listening, or regeneration job is already active, it updates priority without
creating another job. A completed audiobook needs no new job. Earlier chapters
are prepared after the forward section, preserving a complete export in original
book order. Priority persists separately from the locked synthesis manifest.

`POST /api/projects/{id}/pause` pauses background preparation at a sentence
boundary. Paused job/session status is `paused`; completed WAVs remain available.
Calling `/listen` or `/resume` clears the pause and starts the remaining work.

Project/SSE data includes `listening` (chapter, buffer=20, pausing), per-chapter
`ready`, `total`, `contiguous_ready`, and `progress.current_chapter`. Ready sentences
have versioned WAV URLs and remain accessible while synthesis is running.
The client enforces a 20-consecutive-sentence initial buffer and plays only forward.
See [progressive listening verification](progressive-listening.md).

## Source-grounded book analysis

- `GET /api/projects/{id}/analysis?q=...`: optional zero-based `chapter` filter, structure evidence, suggested start,
  review flags and up to eight cited local FTS5 search passages. Query length ≤500.
- `POST /api/projects/{id}/reanalyze`: creates a separately prepared project from
  the checksum-verified stored source. Keeps original audio, edits and project.
- `PATCH /api/projects/{id}/settings`: adds `pace` (0.5–2.0, default1); changes
  invalidate affected audio. The audio fingerprint includes non-default pace.
- Regeneration text limit is now10,000 characters. Natural sentences stay intact;
  model-sized word windows are synthesized and joined internally.
- Sentence/chapter source anchors and section classification live in the project's
  `analysis`; retrieval storage is `sessions/{id}/rag/book.sqlite`.

- `PATCH /api/projects/{id}/analysis`: `{ "chapter":0, "title":"Chapter One",
  "kind":"chapter", "start_here":true }`. Kind is `chapter`, `front_matter`,
  `back_matter` or `unclassified`. Saves manual evidence and optionally sets listening
  priority; retains sentence WAVs but invalidates exports containing old chapter titles.
  Busy projects return409. This does not split or merge chapter boundaries.
- Analysis version2 returns classification confidence/reasons, source excerpts,
  cited search context and explicit partial-match labels. Retrieval is local FTS5,
  not generative AI. New projects use narration version2; old cached audio is unchanged.

## Book removal (Phase 1)

- `GET /api/projects/{id}/deletion`: owned paths, byte count, generated-audio flag,
  source-sharing flag. Count is measured at request time; active work can add data.
- `DELETE /api/projects/{id}`:202 after safe-boundary cancellation and durable moves
  into `trash/<id>/files/`. Response includes `expires` (Unix seconds), actual moved
  `bytes`, title and state. Repeated deletion and ordinary reads return404. The
  request may wait for in-flight extraction/synthesis/encoding to release its lock.
- `POST /api/trash/{id}/restore`: restores during the eight-second Undo window;
  resumed jobs remain paused and never automatically send text online. Returns the
  restored project. Expired undo returns400; purged/missing returns404.
- CLI: `pagevoice delete sessions/<id>` uses the same trash protocol and waits for
  purge. If the server owns the worker, CLI lets it finish cancellation; otherwise
  CLI temporarily acquires worker ownership for cleanup.

Deletion markers are written before moving files. Startup finishes interrupted
moves/restores/purges before loading queued jobs. The worker checks deletion at
sentence boundaries; the global worker-owner lock remains held so other projects
can safely continue. Project session/synthesis locks release before moving data.
Jobs are located by their recorded project ID, not filename. Uploads are removed
only when no live or trashed sibling references the source name. Per-project logs
are owned; deployment-wide `logs/server.log` is not. SSE emits `deleted` then closes.

## Hosted transport

Default local requests remain same-origin and unauthenticated on loopback. Hosted
mode requires `Authorization: Bearer <PAGEVOICE_ACCESS_TOKEN>` for all routes
except `/api/health` and valid signed media GETs. Health includes `hosted: boolean`.
Exact configured origins receive CORS headers; wildcards are rejected. OPTIONS is
available to allowed origins without a token. See [deployment](deployment.md).

Returned audio/download URLs may contain `expires` and `signature`. Preserve their
query strings and resolve relative URLs against `VITE_API_BASE_URL`. They authorize
only GET of that exact media path, expire after approximately one hour and never
contain the deployment secret. SSE uses the bearer header, not a query token.
401 means authentication is required, 413 is a body limit, 429 is a rate limit and
507 indicates upload admission exceeded the storage quota. Background quota
failures appear in the normal job error field and can be resumed after freeing space.

## Local analysis additions

`GET /api/projects/{id}/analysis?q=...` also accepts `chapter`,
`kind=chapter|front_matter|back_matter|unclassified`,
`match_type=exact|phrase|stem|partial|fuzzy|semantic`, `limit=1..50` (default 8),
`mode=lexical|hybrid` (default lexical). Queries: max 500 characters. Hits add
`match_type`, `matched_terms`, `score`, `explanation`, `source_anchor` and context
coordinates. Section records add `subkind`, `confidence_level`, `signals`, `flags`.
Existing fields remain. Hybrid never downloads; unavailable model falls back.
Explicit phrase/NEAR/required/excluded/prefix operators keep lexical constraints.

- `GET /api/projects/{id}/analysis/index`: missing/stale/building/ready/failed/corrupt,
  schema/fingerprint/size when present, optional semantic-model status.
- `POST /api/projects/{id}/analysis/index`: 202 background rebuild (at most two
  concurrent builds); index writes and deletion coordinate through project locks.
- `GET .../analysis/summaries?chapter=0`: verbatim sentences with citations and
  estimated reading time, labelled extractive.
- `GET .../analysis/entities?limit=50`: heuristic names/keywords with chapter counts
  and source citations. No trained NER or factual inference.
- `GET .../analysis/quotes?q=...&limit=50`: matching verbatim quote candidates.
- `GET .../analysis/repetitions?limit=50`: repeated normalized passages/citations.
- `GET .../analysis/qa?q=...&chapter=0`: supporting passages or explicit no-evidence
  status; `answer` is null, never generated prose.

Feature limits max 100; unknown feature/filter and invalid chapter return 422.
