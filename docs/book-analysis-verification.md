# Book analysis and listening verification — 25 September 2026

## Changes exercised

- Conversion button now unlocks/arms progressive listening immediately. React integration test starts with19 ready sentences, sends an SSE update with20, and verifies four scheduled audio buffers.
- Suspended/nonsettling AudioContext resume exposes a recovery action after1.2seconds. Playback reset invalidates pending callbacks. Chapter priority and background preparation remain durable.
- Natural sentences are distinct from internal220-character word windows. Long sentences are synthesized into one persistent sentence WAV. No word is cut to satisfy a character budget.
- EPUB navigation/NCX and fragment/parent-section anchors name chapters. Prose at anchor destinations is preserved. Nested blocks, table cells, inline words and direct body text have text-preservation regressions.
- PDF nested bookmarks, Roman headings and mid-page chapter starts are supported; line-wrap hyphenation is repaired. Ambiguous boundaries remain reviewable.
- Local `rag/` package builds a transactional, fingerprinted FTS5 book index and returns source citations. Reanalysis creates a new project, preserving existing audio and edits.
- Eight curated macOS voices all produced valid PCM. Pitch-preserving pace is configurable from0.5–2×; voice preview uses the selected pace.

## Real runtime results

`PAGEVOICE_URL=http://127.0.0.1:8766/ node scripts/check-audio-browser.mjs`

```json
{"threshold":20,"scheduled":4,"sampleRate":44100,"decodedSeconds":2.8540816326530614,"pauseResume":true,"sourceLanguage":"en"}
```

Installed-server reanalysis of the supplied Spanish EPUB completed after repairing
the editable package installation. Its chapter map identifies Prólogo, Capítulo I,
Capítulo II, Capítulo III, notes, author material and credits. Suggested start index2
is Capítulo I. Search returned8 cited passages. The original project/audio remains
untouched; the prepared copy is `f385dc28391746aaa03d4048e4541a19`.

Real `/v1/audio/speech` request: macOS Monica, Spanish, speed1.5, WAV output:
**37,875 frames at24,000Hz**. Curated voice smoke output:

```text
Samantha                         30053 frames
Grandma (English (US))            39901 frames
Eddy (English (US))               39904 frames
Grandpa (English (US))            39904 frames
Monica                           43300 frames
Grandma (Spanish (Spain))         41437 frames
Eddy (Spanish (Spain))            41437 frames
Grandpa (Spanish (Spain))         41437 frames
```

## Errors found and resolved

The installed entry point initially could not import the newly added `rag`
package, although in-repo tests passed. Adding the package to setuptools discovery
and reinstalling the editable package fixed it. A subprocess regression now imports
`rag` outside the repository with isolated Python. An attempted non-isolated build
lacked `bdist_wheel`; the normal pinned isolated build succeeded. A restart used the
wrong port environment name once and failed to bind occupied8765; it was corrected
to `PAGEVOICE_PORT=8766`, leaving the unrelated service untouched.

The new API test initially omitted the required render JSON body and returned422;
its request was corrected. Existing220-character display tests were updated to
assert whole-sentence preservation, with separate synthesis-window coverage.
Starlette emits an httpx deprecation warning; tests pass with the pinned stack.

Environment: Python3.10.12, Node22.13.1, FFmpeg8.1, macOS arm64. UI production build,
Python suite, frontend suite and `pip check` are recorded in the PR.

## Scope of evidence

Browser verification covers actual audio decoding/scheduling and pause/resume;
React tests cover controls/SSE. No claim of pixel-perfect visual comparison or
human listening-quality evaluation. Neural XTTS synthesis/cloning remains
unverified without installed licensed weights. OCR and chapter inference cannot
guarantee perfect results for every layout. Retrieval is local source search, not
an LLM or embeddings model.

Final checks on the completed changes:

```text
.venv/bin/python -m pytest -q       56 passed, 1 deprecation warning (59.75s)
npm --prefix web test              19 passed
npm --prefix web run build         passed
.venv/bin/python -m pip check      No broken requirements found.
```
