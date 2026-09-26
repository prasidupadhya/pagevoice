# Quality verification — 26 September 2026

Environment: macOS arm64, Python3.10.12, Node22.13.1, FFmpeg8.1,
edge-tts7.2.3. These are observed results, not universal quality guarantees.

| Check | Actual result |
|---|---|
| `.venv/bin/python -m pytest -q` | 72 passed; one Starlette/httpx deprecation warning |
| `npm --prefix web test` | 22 passed across five test files |
| `npm --prefix web run build` | Vite production build passed,1885 modules |
| Editable install and `pip check` | Installed successfully; no broken requirements |
| `scripts/check-edge-quality.py --allow-network` | Eight real voices, one request per297/332-character sample; no silence detected at −45dB for≥0.4s after padding correction |
| Real Edge EPUB→M4B | Four synthesized sentences, two chapters,8.232seconds,105878bytes; title/artist/chapter metadata and full FFmpeg decode checked |
| Headless Chrome AudioContext integration | Held at19ready sentences; started at20; four decoded clips scheduled contiguously; pause/resume passed at44100Hz |
| Running HTTP server | Only Edge in engine catalogue; existing projects readable; detached regular-file logging |
| Real stored Spanish EPUB reanalysis | Separate copy prepared locally;1084 sentences; first narrative chapter correctly selected after prologue and note-key section; original audio retained |

The browser check uses real cached speech with a simulated19→20 readiness update,
not a claim that a fresh20-sentence Edge batch completed in a particular time.
React tests separately exercise live progress events and chapter changes. No new
screenshot-based visual audit or subjective listening panel was performed.

The initial eight-voice diagnostic found0.82–0.91s trailing silence; the updated
Edge adapter caps outer near-silence at40ms leading/220ms trailing. Natural interior
pauses are preserved. Artificial long-request joins have separate guarded trimming.

During implementation, the new PDF regression exposed a footer-filter ordering
bug after a repeated header was removed. Fixed it and reran the full suite.
No remaining test failures were observed. The non-failing Starlette warning is
recorded instead of changing unrelated pinned dependencies.

## Practical limitations

- This is a local library with **online** Edge synthesis, not offline neural TTS.
- Source analysis is evidence-based lexical retrieval and conservative rules,
  not an LLM capable of interpreting every book. Ambiguous classifications are
  marked for review; chapter titles/types/start can be corrected.
- Unmarked footnote symbols embedded directly in prose can remain in extraction.
  OCR, abbreviations and complex layouts can still need sentence edits.
- Existing audio keeps its original pronunciation and segmentation. Reanalyze a
  copy and render it to apply the new pipeline; old projects are not overwritten.
- Voice ages are not verified by provider metadata. Gender and region are shown;
  no synthetic young/old labels are invented.
- Silence detection and successful decoding do not prove perfect pronunciation,
  absence of every dropped word, or preferred subjective naturalness.

## Follow-up: clickable listening and Spain voices

The listening action no longer silently disables itself for missing network
permission or unsaved settings. Clicking asks for explicit permission when needed,
saves pending settings, and arms automatic playback during background preparation.
The UI regression covers migrating an old Mexican voice, consent, settings PATCH,
listening POST and the19→20-sentence progress transition. All22 UI tests pass.

The live catalogue now used is four American English voices and three Spanish
Spain voices (Elvira, Ximena, Álvaro). Microsoft exposed no second male Spain voice
in the catalogue queried for this change. All seven synthesized original test prose
successfully. Ximena's sample had a0.43s terminal silence diagnostic at−45dB;
this is not an interior sentence interruption or a claim of zero natural pauses.

Follow-up full regression:73 Python tests passed (same non-failing Starlette
warning),22 frontend tests passed, and the production build passed.
