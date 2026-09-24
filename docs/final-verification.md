# Final local verification — 2026-09-24

Latest [progressive listening verification](progressive-listening.md):
48 backend tests, 17 UI tests, real browser audio-engine and timed HTTP checks.

Subsequent [broken-pipe repair](broken-pipe-repair.md) adds detached-server and
shutdown regressions: 45 backend tests and 8 UI tests pass.

Environment: macOS arm64, Python 3.10.12, Node 22.13.1, npm 10.9.2,
FFmpeg/ffprobe 8.1, Tesseract 5.5.0 with eng/spa, PyTorch 2.8.0.
`pagevoice doctor` detected MPS. This detects availability; XTTS on MPS is not verified.

## Commands and real results

```text
.venv/bin/pytest -q
43 passed, 1 warning

.venv/bin/pytest -q tests/test_languages.py
3 passed

npm --prefix web test
Test Files  2 passed (2)
Tests       8 passed (8)

npm --prefix web run build
✓ built in 296ms
index HTML: 0.51 kB; CSS: 19.73 kB; JS: 261.14 kB (82.21 kB gzip)

.venv/bin/pip check
No broken requirements found.

git diff --check
(no errors)
```

The three-language-module follow-up tests verify only supported en/es codes,
real Spanish synthesis and M4B `spa` stream metadata, and Spanish scanned-PDF OCR.
The full suite also covers English speech, EPUB/PDF chapter assembly, file checksums,
interruption/restart recovery, sentence edits and idempotent job replay, API boundaries,
cloning consent/duration/reference integrity, bilingual dialogue suggestions,
voice markup/pause sample counts, unaffected-chunk reuse, and six speech formats.
Real-audio tests use installed macOS voices. Fast unit tests use an explicitly
synthetic CountingEngine; synthetic output is never presented as neural speech.

Vitest/jsdom exercises English/Spanish/theme controls, uploads, cloning consent,
sentence editing, dictionary parity, WebMCP's read-only contract, keyboard-compatible
casting selects, and voice drops. Production assets are served without remote fonts.
Live browser visual QA and live WebMCP calls were not performed.

## Real HTTP run

A local HTTP client used the production FastAPI server at `127.0.0.1:8766`:

```text
Detected: ['Daniel', 'Mira', 'Narrator']
First render: {'reused': 0, 'synthesized': 4}
Recast render: {'reused': 3, 'synthesized': 1}
Spanish speech endpoint: 200 8781 bytes
Project: 18cb58c9c60f4e63b1a3acc0af5800c1
Production HTML: 200
```

The original test EPUB was uploaded, parsed, cast with real system voices, rendered,
downloaded, then recast and rendered again. `ffprobe` found two chapters at
0–4.353 and 4.353–7.954 seconds, title `The Quiet Harbour`, author `PageVoice`.
Output on this machine: `outputs/18cb58c9c60f4e63b1a3acc0af5800c1.m4b`.
The speech request generated `outputs/spanish-speech.mp3` using Monica.
Fixtures and private generated audio are intentionally excluded from Git.
Earlier real Spanish HTTP/SSE/download checks are recorded in [API notes](api.md).

The Spanish mixed-PDF fixture contains one native page and one scanned page.
Both rendered pages were visually inspected: accents were legible and no text
was clipped. Tesseract recovered “María abrió el libro” from the scanned page.

## Errors found and fixed

- The new sentence editor adds a speaker argument; its component test was updated
  to assert both text and speaker.
- A pause-length test originally omitted the fake engine's text-length samples;
  corrected the expected count to 40,812 (including exactly 36,000 silent samples).
- Missing cloned profile files now return an actionable 400 rather than a 500.
- M4B language is explicitly stored on the audio stream as `eng`/`spa`; a real
  Spanish render verifies `spa`. Some containers do not preserve a global language tag.
- Starlette emits one non-failing deprecation warning about httpx TestClient.

## Honest limits

XTTS dependencies import, but its model weights/license have not been installed/
accepted by the operator. Neural synthesis, built-in XTTS speech, and actual cloned
speech are therefore **not** claimed as end-to-end verified. The consent/reference
workflow and adapter implementation are present. Online Edge synthesis was not run.
GPT-SoVITS is intentionally deferred from v1 as allowed by the project brief.
Only macOS real speech was exercised; Linux/Windows ML setup needs separate validation.

## Git delivery

The original README-only main was preserved as the starting point. Four feature
branches (five branches including main), with at most four unique feature commits:

| Branch | Unique feature commits | PR |
| --- | --- | --- |
| feat/pipeline | 3 | [#1](https://github.com/prasidupadhya/pagevoice/pull/1) |
| feat/api | 1 | [#2](https://github.com/prasidupadhya/pagevoice/pull/2) |
| feat/reader-ui | 2 (+1 merge from main; 3 branch commits total) | [#3](https://github.com/prasidupadhya/pagevoice/pull/3), progressive listening PR |
| feat/voices-engines | 2 (+1 merge from main; 3 branch commits total) | [#4](https://github.com/prasidupadhya/pagevoice/pull/4), repair PR |

Finished branches are pushed and squash-merged through their PRs.
