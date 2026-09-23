# Phase 2 verification

Verified locally on macOS arm64, Python 3.10.12, Node 22.13.1 (unused), FFmpeg 8.1.
New dependencies: pypdf 6.19.0, pypdfium2 5.13.0, Pillow 12.3.0,
filelock 4.0.1, ReportLab 5.0.1 (test fixtures). Tesseract 5.5.0 was already
installed with `eng`, `osd`, and `snum` data. Poppler 26.09.0 was installed for
fixture visual QA; production OCR uses PDFium. Python dependencies are pinned
in pyproject.toml and both lock files.

## Real results

```text
.venv/bin/pip install -e '.[test]'
# exit 0
.venv/bin/pip check
No broken requirements found.
.venv/bin/pytest -q
19 passed in 23.60s
```

After adding a valid-WAV checksum-tampering case, a **fresh temporary virtual
environment** was created, installed with the updated core lock and `.[test]`,
checked with `pip check`, and used to run the full suite:

```text
No broken requirements found.
20 passed in 25.67s
```

The clean environment had no XTTS/PyTorch installation. This confirms the
core PDF/OCR/recovery path does not depend on the optional neural stack.
The one-command `./scripts/setup.sh` also completed successfully with the new
lock. After the final session-start logging adjustment, the real process-kill
and CLI resume/regeneration test passed again: `1 passed in 9.77s`.
No new test failures were observed during phase 2 development.

## Coverage that matters

- Native PDF extraction preserves metadata and bookmark chapter order without OCR.
- The mixed PDF contains native text on page 1 and **no extractable text** on page 2.
  Real Tesseract recovered page 2, including `Mira carried the lantern`.
- A second extraction uses the saved page cache. A simulated interruption on page 2
  resumes parsing without reprocessing the completed page 1.
- Heading-based chapter fallback works without bookmarks. Encrypted PDFs, disabled
  OCR on textless pages, and missing OCR language data produce actionable errors.
- A **real child CLI process** runs PDF OCR and macOS speech; the test sends SIGKILL
  after its first completed chunk. A new CLI process resumes it. Previously saved
  chunk filenames, SHA-256 hashes, and nanosecond modification times stay unchanged.
- The same real session is regenerated through the CLI with replacement text.
  Exactly one chunk is synthesized; all other committed chunks remain unchanged.
  FFmpeg decodes the final M4B, and FFprobe confirms both chapters.
- Additional failure tests cover malformed WAVs, deleted chunks, changed PCM with
  a valid WAV header, settings changes, assembly failure, persisted regeneration
  intent after an engine failure, and repeated regeneration with unchanged text.
- A completed resume requires no TTS engine. Phase 1 manifest migration reuses
  validated audio. Concurrent writers are refused without modifying session state.
- Original phase 1 EPUB→M4B/MP3 smoke tests still pass.

## Persistent sample and exact commands

```sh
.venv/bin/python tests/pdf_sample.py
.venv/bin/pagevoice inspect outputs/fixtures/mixed-scan.pdf
.venv/bin/pagevoice convert outputs/fixtures/mixed-scan.pdf --engine say
```

Observed extraction: page 1 `native`, 99 characters; page 2 `ocr`, 105 characters.
Title `The Paper Lantern`, author `PageVoice`, two chapters and six speech chunks.

```text
Session: sessions/b31bfcde130949228812048c4adc51f6
Output: outputs/b31bfcde130949228812048c4adc51f6.m4b
Chapters: 2; duration: 10.532000 seconds
Reused: 0; synthesized: 6
```

```sh
.venv/bin/pagevoice resume sessions/b31bfcde130949228812048c4adc51f6
.venv/bin/pagevoice regen sessions/b31bfcde130949228812048c4adc51f6 0000-00001 \
  --text "The lantern shone across the water."
```

```text
# resume
Chapters: 2; duration: 10.532000 seconds
Reused: 6; synthesized: 0
# regen
Chapters: 2; duration: 11.275000 seconds
Reused: 5; synthesized: 1
Verified: unchanged chunks retained filenames, hashes, and modification times.
```

FFprobe confirmed the edited sample:

| Chapter | Start | End |
| --- | --- | --- |
| Chapter One | 0.000000 | 5.963000 |
| Chapter Two | 5.963000 | 11.275000 |

Output size: 154069 bytes; title `The Paper Lantern`; artist `PageVoice`.
The two original fixtures were rendered with Poppler using `pdftoppm -scale-to 1100
-png`, and all four resulting page images were visually inspected. Text is legible,
properly spaced, and unclipped. Audio has not had a human listening review.

## Limits and checkpoint

Simple single-column layouts and English OCR are verified. Multi-column reading
order, noisy/rotated scans, other OCR languages, CUDA/ROCm hardware, and XTTS/Edge
synthesis are not verified. Auto OCR is a low-text heuristic, not a scan classifier;
use `--ocr always` when a substantial native text layer masks scanned content.
Empty recognition is reported per page, but cannot reliably distinguish a blank
page from failed OCR. PDF bookmark destinations are rounded to page starts.

Crash recovery is verified for process termination. No claim is made about
power-loss recovery or shared/network filesystems. Existing outputs remain on disk
while a rebuild is pending; consult `output_current` in the manifest. Old and
orphaned chunk generations are retained, so long editing sessions use extra disk.
Resume re-encodes the final output even when no speech needs regeneration.

Main remains README-only. No new branches were created; this phase adds one
feature commit, bringing `feat/pipeline` to two unique commits out of four allowed.
PR/merge and phase 3 have not started.

## Primary implementation references

- [pypdf text extraction](https://pypdf.readthedocs.io/en/stable/user/extract-text.html)
- [PDFium Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
- [Tesseract CLI](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)

No reference audiobook repository code was copied or fetched for this phase.

## Final pipeline scope update

The user subsequently authorized completion and PR merges for all remaining
phases, and restricted the product to English/Spanish. Other language codes are
now rejected throughout parsing, sentence splitting and recovery. Spanish uses
Monica locally and Elvira for optional Edge. English/Spanish narration tests run
real macOS voices. Spanish Tesseract data was installed from the official
`tesseract-ocr/tessdata_fast` 4.1.0 `spa.traineddata` resource.
