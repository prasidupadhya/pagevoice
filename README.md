# PageVoice

Turn English and Spanish EPUBs and PDFs into chaptered audiobooks on your computer.
An original Python pipeline and React reader, with no accounts or required cloud service.
The interface supports **English / Español** and **light / dark** themes.

## Start locally

Prerequisites: **Python 3.10–3.13**, **Node 22.12+**, npm, and FFmpeg/ffprobe.
Verified here: Python **3.10.12**, Node **22.13.1**, npm **10.9.2**, FFmpeg **8.1**,
Tesseract **5.5.0**, macOS arm64. On macOS, `brew install ffmpeg tesseract tesseract-lang`
installs media/OCR tools and Spanish OCR data. Check `tesseract --list-langs` for
`eng` and `spa`. Native-text PDFs do not need Tesseract.

```sh
./scripts/start.sh
```

On first launch this runs the pinned Python/npm setup and builds the interface.
Open **http://127.0.0.1:8765**. To use another port:

```sh
PAGEVOICE_PORT=8766 ./scripts/start.sh
```

For setup without starting the server, run `./scripts/setup.sh`.
Override the Python executable with `PYTHON=python3.11`. Initial installation needs
internet; installed macOS voices and cached XTTS models synthesize offline.
On this Mac, choose **Built-in local voice** and save settings for an immediate
local preview. XTTS is the default engine and needs the separate setup below.
Linux/Windows require XTTS; the built-in `say` engine is macOS-only.

## Reader workflow

1. Drop an EPUB/PDF, select **English or Spanish**, and review extracted chapters.
2. Choose an installed engine and voice, then save settings. Select a chapter and
   **Listen from here**: playback starts with 20 ready sentences while the rest
   prepares in the background. Chapter 3 gets priority before chapter 4; earlier
   chapters are completed afterward for the full export.
3. Pause listening independently, or **Pause preparation** to change voices and edit
   sentences. Completed chunks are saved and reused.
4. Optionally find dialogue, correct a sentence's speaker in its editor, and assign
   voices in the casting board using selects or drag-and-drop.
5. Create and download a chaptered **M4B** or **MP3**, with title/author/language metadata.

Voice cloning requires an unchecked-by-default consent checkbox and a **5–15 second**
clean, single-speaker recording. Profiles stay locally in `voices/`; only XTTS uses them.
Duration, consent, language and reference checksums are validated. Recording quality
and the speaker's identity are reviewed by you; they are not automatically inferred.

English/Spanish selection controls parsing, sentence splitting, OCR and narration.
It does not translate a book or automatically prove its language.
Other language codes are rejected.

## Engines and models

| Engine | Local | Setup / limits |
| --- | --- | --- |
| XTTSv2, via maintained `coqui-tts` | Yes, after model download | Default; built-in speaker and consent-based clones; GPU recommended |
| macOS `say` | Yes, with installed voices | Fast offline narration; English/Spanish system voice catalogue |
| `edge-tts` | No | Optional draft; explicit consent to send text to Microsoft on each job |

```sh
.venv/bin/pip install -e '.[xtts]'
.venv/bin/pagevoice setup-xtts
.venv/bin/pagevoice doctor
```

Review and accept XTTS's model terms in its interactive setup prompt if appropriate.
PageVoice never accepts these terms or starts model downloads in the background.
Model readiness is shown in the UI. CUDA, ROCm, MPS and CPU are detected through
PyTorch; actual XTTS/device compatibility needs a chapter benchmark. CPU synthesis
can be slow. Use CPU if your model encounters unsupported MPS operations.

Optional online draft: `.venv/bin/pip install -e '.[edge]'`.
GPT-SoVITS is **deferred from v1** because of its separate weights/setup requirements;
`pagevoice/engines.py` provides the adapter interface for future engines.

## CLI and recovery

```sh
.venv/bin/python tests/sample.py outputs/sample.epub
.venv/bin/pagevoice inspect outputs/sample.epub
.venv/bin/pagevoice convert outputs/sample.epub --engine say
.venv/bin/pagevoice convert book.pdf --engine say --language es --ocr auto
.venv/bin/pagevoice resume sessions/<id>
.venv/bin/pagevoice sentences sessions/<id>
.venv/bin/pagevoice regen sessions/<id> 0000-00001 --text "The lantern shone across the water."
```

Use `--format mp3` for MP3, `--voice` for a built-in name or `clone:<profile-id>`,
`--data-dir` for a library root, and `--allow-network` to opt into Edge.
Sentence IDs are zero-based chapter/sentence indexes. Text edits are limited to
220 characters; long source sentences are split automatically.

Supported inline controls: `[pause:1.5]` inserts silence in seconds (greater than
zero, at most 30); `[voice:Mira]Hello.[/voice]` uses Mira's casting assignment or
an engine voice name. Voice spans must be balanced and cannot nest. Controls are
parsed before synthesis; they are not read aloud. Names are case-sensitive.

Resume checks each WAV, SHA-256, text, revision, and effective voice before reusing
it. Only missing/stale chunks are synthesized; final export is rebuilt. Jobs and
sentence edits survive server restarts. File locks prevent concurrent writers.
Older pipeline fingerprints regenerate once for the new markup/casting behavior.
Previous/orphaned chunk generations are retained for recovery and consume disk space.

PDFs prefer embedded text; automatic OCR runs on pages with fewer than 24
alphanumeric characters. Use `--ocr always` for mixed pages that need full OCR, or
`--ocr never` for text-only extraction. `--ocr-language eng+spa` overrides OCR data.
PDF bookmarks or English/Spanish headings define chapters; otherwise pages do.
The reader flags pages with extraction warnings.

## API and development

FastAPI serves REST, SSE progress, and the built UI on loopback. A durable single
worker needs no Redis. [API documentation](docs/api.md) lists all routes.
The local **`POST /v1/audio/speech`** endpoint follows the OpenAI speech request/binary
response shape using local model IDs `say`, `xtts`, or `edge`; no OpenAI account,
API key, or service call is involved. MP3/WAV/PCM/FLAC/AAC/Opus and speed 0.25–4
are supported. It returns completed audio, not incremental SSE audio.

```sh
.venv/bin/pytest -q
npm --prefix web test
npm --prefix web run build
# Development UI, with a separately running local backend:
PAGEVOICE_PORT=8766 npm --prefix web run dev
```

Direct dependencies are pinned in `pyproject.toml` and `web/package.json`;
`requirements-core.lock` and `web/package-lock.json` pin the core environments.
`requirements-macos-py310.lock` records this Mac's optional ML environment.
Other accelerators may need platform-specific PyTorch wheels; those are not verified here.
`.env.example` documents shell variables; `.env` is not automatically loaded.

Local storage, excluded from Git: `uploads/`, `voices/`, `sessions/`, `outputs/`,
and durable `jobs/`. Keep the full library root together when moving it.
Do not expose the server to the Internet. Upload limits apply after multipart parsing.

## Verification and known limits

See [progressive listening and real timing results](docs/progressive-listening.md),
[broken-pipe repair and regression results](docs/broken-pipe-repair.md),
[final verification](docs/final-verification.md), [UI/design notes](docs/design.md),
and earlier [pipeline](docs/verification.md), [PDF/recovery](docs/phase2-verification.md)
and [UI](docs/ui-verification.md) checkpoints for actual commands and results.

- Real English/Spanish macOS speech, chaptered export, native/scanned PDFs,
  recovery, sentence regeneration and multiple voices were exercised locally.
- **XTTS neural synthesis/cloning and online Edge synthesis remain unverified.**
  XTTS awaits operator acceptance and installation of model weights; Edge is opt-in.
- Speaker detection uses editable dialogue heuristics. It does not resolve pronouns
  or infer characters reliably; attribution applies to the entire sentence.
- EPUB chapters follow spine documents; no DRM removal, cover artwork, footnote
  filtering or navigation-fragment splitting. PDF reading order is best for simple
  single-column layouts; review headers, tables, scanned text and blank-page warnings.
- Sentence synthesis can change prosody between chunks. No automatic audio-quality
  scoring or loudness mastering. MP3 chapter support depends on your player.
- Component interactions and production builds are tested; live browser visual QA
  and live WebMCP integration were not performed. No external fonts or analytics.

## Original implementation and branch discipline

[Reference READMEs](docs/references.md) informed concepts only; no reference code was
cloned, copied, vendored or wrapped. Standard library dependencies are used normally.
`main` began with only this README. Four feature branches cover the whole project:
`feat/pipeline`, `feat/api`, `feat/reader-ui`, `feat/voices-engines`.
Each stays within four unique feature commits and lands through a squash-merged PR.
