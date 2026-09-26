# PageVoice

Turn English or Spanish PDFs and EPUBs into chaptered M4B or MP3 audiobooks.
**Your library, extraction, book analysis and exports are local. Narration uses
Microsoft Edge's online speech service and sends the narration text to Microsoft.**
Internet is required to generate new speech; saved audio plays offline.

XTTSv2 and voice cloning have been removed. Edge is the only narration engine
shown in the website. There are no accounts, API keys or automatic model downloads.

## Setup

Tested with Python **3.10.12**, Node **22.13.1**, npm **10.9.2**, FFmpeg/ffprobe
**8.1** and macOS arm64. Python 3.10–3.13 and Node22.12+ are declared supported;
other operating systems have not received the same real-audio verification.
Dependencies are pinned in `pyproject.toml`, `requirements-core.lock` and
`web/package-lock.json`.

Install Python, Node and FFmpeg first. On macOS, `brew install ffmpeg tesseract
tesseract-lang` supplies audio tools and English/Spanish OCR data. Then:

```sh
bash scripts/setup.sh
```

Start the local app:

```sh
PAGEVOICE_PORT=8766 .venv/bin/pagevoice-server
```

Open **http://127.0.0.1:8766/**. `.env.example` documents environment variables;
export them in your shell—PageVoice does not automatically load `.env` files.
The server binds to localhost. Port8765 is the default if no override is given.

## Use the reader

1. Upload a PDF or EPUB (maximum100MB) and choose the book's language. Interface
   language is independent; English/Spanish and light/dark themes are available.
2. Review **Explore your book**. It shows section types, source anchors, evidence,
   excerpts and uncertain boundaries. Correct a section's title/type or choose
   the section from which listening should start. Corrections preserve sentence
   audio but invalidate the final export because its chapter metadata changed.
3. Select a voice and narration pace (0.5–2×). Explicitly check the Microsoft
   network-consent box before previewing or generating speech. Save changed settings.
4. Choose a chapter and press **Create audiobook** or **Listen from here**. The
   click arms playback. Listening starts after20 consecutive sentences are ready,
   or all remaining sentences when fewer than20 remain. If the browser blocks
   audio, use **Tap to enable audio**.
5. Preparation continues while you listen. The selected chapter and subsequent
   chapters take priority; earlier sections finish afterward for the complete
   export. Pausing listening does not pause preparation. Both controls are available.
6. Edit/regenerate a single sentence, or download the completed M4B/MP3. M4B
   includes chapter metadata. MP3 chapter display depends on the player.

### Existing books and older audio

New code does **not** rewrite already generated audio. Use **Reanalyze into a new
project** for older books: it reparses the stored source with the current sentence
and chapter rules and prepares a separate project. Existing audio, edits and
original uploads remain intact. Select Edge and enable network consent when ready
to generate the improved copy. Old XTTS projects remain readable and can be
reanalyzed; XTTS cannot synthesize or be selected in current settings.

## Voices

Eleven Edge voices are offered, filtered to the book's language:

| Language | Female voices | Male voices |
|---|---|---|
| English (US) | Aria, Jenny | Guy, Christopher |
| British English | Sonia, Libby | Ryan, Thomas |
| Spanish | Elvira, Ximena (Spain) | Álvaro (Spain) |

The catalogue was checked against the live service. It currently exposes only one
male Spain voice, so we do not substitute a Mexican voice to invent a second choice.
Microsoft does not publish reliable young/old age labels for these voices; the
app uses names, gender and region instead of inventing ages. Voice quality is
subjective; audition the voice with **Preview this voice**. No cloned voices or
unverified alternative neural models are offered.

## Why sentence flow changed

The previous220-character synthesis window cut long sentences mid-thought.
Normal sentences now go to Edge in one request. Requests exceeding3500 UTF-8 bytes
split at clause punctuation where possible, otherwise at a whole-word boundary.
Only near-silent padding at artificial joins is trimmed; interior speech and
explicit pauses are preserved. Edge's external padding is capped at40ms before
speech and220ms after speech. Pace adjustment preserves pitch.

Our English/Spanish splitter handles sentences within quotation marks, missing
spaces after periods, decimals, common abbreviations, initials, URLs and numbered
lists. It never splits a word to meet a model character limit. Headings are chapter
metadata rather than fragments attached to the opening sentence. Editors accept
up to10,000 characters per sentence. Unusually long single words/URLs beyond the
service request budget require an edit instead of silent truncation.

Inline controls remain supported: `[pause:1.5]` adds1.5seconds of silence;
`[voice:en-US-ChristopherNeural]Text.[/voice]` switches to a valid voice. Voice names
can also refer to casting assignments. Speaker detection is a reviewable heuristic,
not reliable automatic character identification.

## Book analysis and the `rag/` folder

This is an **offline retrieval and structure-analysis system**, not an LLM chatbot.
It does not claim semantic understanding or generate unsupported answers.

- EPUB3 navigation, EPUB2 NCX, fragment anchors, headings and EPUB section semantics
  supply structure. Front/back matter stays available; it is never silently deleted.
- PDF nested bookmarks and heading lines supply boundaries. Without reliable
  headings, pages remain continuous so a page break cannot split a sentence.
  OCR uses local Tesseract only when needed. Repeated margins/page numbers are
  suppressed conservatively and recorded in `source_pages.removed_margins` with
  review warnings. Original page-cache text is retained.
- Analysis distinguishes document evidence, inferred decisions and manual reviews.
  Unknown sections remain unclassified. Users can correct titles/types and start
  position; arbitrary chapter splitting/merging is not implemented.
- Each project has a SQLite FTS5 index in `sessions/<id>/rag/book.sqlite`.
  Search removes English/Spanish stopwords, tries all important terms first, then
  labels partial matches. Results include neighbouring sentences, chapter/sentence
  citations and a source anchor. Search can be restricted to a section.
- An index fingerprint refreshes retrieval after edits. Search stays local and
  does not send book passages to an AI service. It is lexical retrieval, not
  embeddings: synonyms and paraphrases may not match.

See [the module](rag/README.md), [TTS research](docs/tts-research.md) and
[API reference](docs/api.md), and [recorded verification](docs/quality-verification.md).

## CLI and recovery

```sh
.venv/bin/pagevoice doctor
.venv/bin/pagevoice inspect book.epub --language es
.venv/bin/pagevoice convert book.epub --engine edge --language es --allow-network
.venv/bin/pagevoice resume sessions/<id> --allow-network
.venv/bin/pagevoice regen sessions/<id> 0000-00001 --text "Una frase corregida." --allow-network
```

Use `--format mp3` or `--voice es-ES-AlvaroNeural` as needed. `PAGEVOICE_DATA` or
`--data-dir` selects the library root. Completed sentence WAVs are immutable
checksum-verified generations; interrupted jobs resume and reuse valid audio.
Only one server may own a library's job queue. The macOS `say` adapter remains a
legacy CLI/test diagnostic to read old projects; it is not offered in the website
or recommended as an audiobook voice.

Folders: `uploads/`, `sessions/`, `outputs/`, `voices/` (old recordings only),
`jobs/` and `logs/`. Existing consent-based recordings are preserved, but new
profile upload returns410 because cloning is no longer supported.

## Verification

```sh
.venv/bin/python -m pytest -q
npm --prefix web test
npm --prefix web run build
# Explicit online diagnostic; sends only original EN/ES test prose:
.venv/bin/python scripts/check-edge-quality.py --allow-network
```

Tests cover native/scanned PDFs, EPUB text preservation, sentence boundaries,
retrieval/review, audio joins, metadata, crash recovery, sentence regeneration,
network consent and20-sentence playback. Real Edge checks verify requests and
WAV output; silence measurements are not a substitute for subjective listening
or a word-accuracy benchmark. Historical phase reports describe earlier versions.

## Known limits

Edge is an online service used through `edge-tts`; availability, voice inventory
and service behaviour can change. There is no offline neural fallback. OCR cannot
perfectly recover damaged scans or arbitrary multi-column layouts. Abbreviations,
hyphenation, running headers and chapter classification can be ambiguous and need
review. DRM/encrypted books are unsupported. Very large books need disk space for
per-sentence WAVs and final assembly. No product can promise perfect narration of
every document; the app exposes source evidence and corrections rather than hiding
these limits.


“Listen from here” is clickable before online consent and after changing settings.
It requests explicit Microsoft permission when needed, saves pending settings,
then prepares audio from the selected chapter. Playback begins at20 consecutive
ready sentences (or all remaining sentences when fewer remain), while the worker
continues preparing the audiobook. Existing Mexican voice selections migrate to
Spain's default when settings are next saved; existing audio is preserved on disk.
