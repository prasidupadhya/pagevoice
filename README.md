# PageVoice

A local-first PDF/EPUB → audiobook application, implemented from scratch.

## Development plan

Work stops for review after each phase:

1. EPUB → chaptered M4B CLI, engine registry, local smoke test.
2. PDF + OCR, crash recovery, sentence regeneration.
3. FastAPI upload, queue, progress (SSE), download.
4. React/Vite/Tailwind accessible reader UI, previews and consent-based voice cloning.
5. Character detection and voice casting.
6. Optional engines and an OpenAI-compatible speech endpoint.

`main` starts with this README only. Four feature branches cover the project:
`feat/pipeline` (1–2), `feat/api` (3), `feat/reader-ui` (4), and
`feat/voices-engines` (5–6). Maximum four commits per feature branch;
reviewed changes land through pull requests later. Do not create extra branches.

## Architecture

Parse → clean → chapters → sentences → optional speakers → audio chunks → FFmpeg.
Python CLI first, then FastAPI and React. Local `uploads/`, `voices/`,
`outputs/`, `sessions/`; no accounts. XTTSv2 via maintained `coqui-tts`
is the default engine; Edge is an optional online draft engine. Voice cloning
requires the speaker's consent. Model downloads require initial internet access.

## Implementation policy

Reference READMEs are inspiration only; no reference implementation is copied,
cloned, vendored, or wrapped. Standard PyPI/npm dependencies are allowed.
Design guidance will be read before phase 4. Every claimed working feature
must have a recorded verification run.
