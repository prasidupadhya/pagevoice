# Automatic reader verification

Verified locally on 2026-09-30: macOS ARM64, Node 22.13.1, Python 3.10.12.
CI uses Python 3.12. See the [findings and design plan](automatic-reader-plan.md)
for the pre-implementation review and reference availability.

## Changes

1. Offline EN/ES detection samples body sections before sentence splitting,
   compares EPUB metadata, reports evidence, and selects the matching default
   voice. Automatic server OCR tries eng+spa. Explicit API/CLI overrides remain.
2. Structure analysis narrows biography headings, recognizes numbered chapters,
   resets numbering at part boundaries and skips short part dividers when
   suggesting a listening start. Partial stem hits remain labelled and below
   stronger matches. Classifier revisions invalidate existing indexes while
   preserving citations.
3. Upload asks for the book rather than its language. Detection evidence, OCR
   and casting use disclosures; the server voice catalogue uses one select.
   Both readers share paper/ink/green tokens, quiet motion and reduced-motion
   rules. The Microsoft option starts checked, with a visible notice and opt-out.
   Upload alone never starts synthesis; the API still requires allow_network.
4. Fixed the queued-project race that selected an English voice before Spanish
   analysis finished. Reanalysis also corrects a legacy cross-language voice.

The Vercel header failure was repaired in PR #34 by replacing vercel.mjs with
static vercel.json. A new regression test checks every header has a string value.
The exact-origin CSP is additionally generated in the frontend HTML at build time.

## Commands and results

| Command | Actual result |
| --- | --- |
| `.venv/bin/python -m pytest -q` | 157 passed, 68.89s; one existing Starlette/httpx deprecation warning |
| `npm --prefix web test` | 114 passed across 21 files, 3.95s |
| `npm --prefix web run lint` | Passed, zero warnings |
| `npm --prefix web run format:check` | All files passed |
| `npm --prefix web run build` | Passed, 1906 modules, 421ms; both reader and PDF workers bundled |
| `npm audit --prefix web --audit-level=low` | Zero vulnerabilities |
| `.venv/bin/ruff check pagevoice rag tests` | All checks passed |
| `.venv/bin/mypy --ignore-missing-imports rag/structure.py rag/query.py rag/lexical.py rag/features.py pagevoice/trash.py pagevoice/security.py` | Passed, six CI-targeted modules |
| `.venv/bin/pagevoice rag-eval --output docs/eval/automatic-reader-after.json --baseline rag/eval/after.json` | Passed regression gate, numbers below |
| `git diff --check` | Passed |

An extra broad `mypy pagevoice rag` check found 26 errors in five modules outside
the established CI typing scope. Whole-repository typing is not claimed clean.
Local `vercel build` was not run: CLI credentials were rejected previously, and
the user requested deployable files without a local login. PR deployment/check
results are recorded in GitHub; a Vercel frontend is not an Edge worker host.

## Measured analysis and retrieval

Identical fixed-gold corpus: 112 queries, 100 answerable. Full results:
[before](eval/automatic-reader-before.json), [after](eval/automatic-reader-after.json).

| Metric | Before | After |
| --- | ---: | ---: |
| Fixed-gold classification accuracy / macro-F1 | 1.000 / 1.000 | 1.000 / 1.000 |
| Independent structure challenge | 4/14 (28.6%) | 14/14 (100%) |
| Recall@1 / @5 / @10 | .930 / .940 / .950 | .930 / .940 / .950 |
| MRR | .936667 | .936667 |
| nDCG@10 | .939871 | .939871 |
| No-answer precision / recall | 1.000 / 1.000 | 1.000 / 1.000 |
| Search p50 / p95 | 1.317 / 2.304 ms | 1.499 / 2.792 ms |
| Index build | .288 s | .293 s |
| Index bytes | 1,462,272 | 1,462,272 |

No measured recall/MRR improvement is claimed. Structural edge cases improve,
and partial inflected-word evidence is covered by targeted tests. These small
fixtures do not establish accuracy or speed on arbitrary production books.
Confidence levels express heuristic evidence, not calibrated probabilities.

## Production-build smoke checks

Served web/dist with Vite preview on port 5432; a separate build used
VITE_API_BASE_URL=http://localhost:18765 against a real local PageVoice worker.

- Browser EPUB: 2017-byte Spanish fixture imported through the bundled worker;
  two sections/four sentences, Español detected and Elvira selected. No alert.
- Browser native PDF: 2525-byte Spanish fixture imported successfully through
  bundled PDF workers; Español detected without a language tag. Removal returned
  to the empty library and displayed Undo. The browser connection was lost before
  manual restoration completed; automated delete/Undo/cleanup tests pass.
- A fresh browser tab showed an empty library. A refresh attempt with a loaded
  book encountered the unload warning; the manual refresh flow was not completed.
- API upload: Spanish detection, matching voice, no upload-time synthesis.
  Accentless search `Maria` returned two cited María passages.
- API listening: real Edge Ximena audio prepared four sentences, then the player
  entered playback and advanced into chapter two without an alert. Short books
  start after all remaining sentences; the existing 19-to-20 buffer integration
  test verifies the longer-book threshold.
- FFprobe checked the generated M4B: AAC audio, two chapters, 9.14 seconds,
  114,598 bytes. Default Elvira selection is separately verified by tests;
  this completed audio smoke used Ximena.

## Design delivery checks

**Direction:** book text and listening lead; settings are secondary, typography
is self-hosted, the accent is restrained green. References informed hierarchy,
native controls, factual copy and purpose-driven motion. Designeer and Rare UI
returned HTTP 429; their unseen guidance was not guessed.

**Functional states:** tested automatic imports, queued-to-ready voice selection,
checked consent without upload synthesis, source search, actual audio, export,
removal and automated Undo. Existing keyboard, focus-dialog and cleanup tests
remain green. Full public-host provisioning is outside these local checks.

**Visual craft:** before screenshots reproduce main dca11a6 locally. After
screenshots show the final production build. Both themes at 375/768/1440 px and
900 px height are in [screenshots/automatic-reader](screenshots/automatic-reader).
Populated reader captures show checked consent and no horizontal overflow at all
six combinations. The empty mobile rail collapses to prioritize upload.

**Limits:** no complete WCAG or Lighthouse audit was run. Existing controls and
motion preferences are preserved; screenshots are evidence of layout, not proof
of flawless accessibility. Very short, mixed-language or unsupported untagged
books can need review; the detector supports EN/ES, not universal identification.
Low evidence stays visible. The lexical system does not invent summaries or
semantic claims. Browser mode still uses device voices; exact Edge audio and
persistent isolated guest libraries require the configured server/PocketBase.

## Request checklist

| Requirement | State / evidence |
| --- | --- |
| Vercel header has value | Done: static config on main plus regression test |
| Automatically detect EN/ES on upload | Done for API/browser EPUB/native PDF and server OCR flow; heuristic limits above |
| Improve book analysis | Done: 14-case structural gain, conservative fallback, stale index repair |
| Improve retrieval | Partial: partial stem fallback added; fixed-gold recall/MRR unchanged |
| Microsoft option initially checked | Done: visible notice/opt-out; user click still starts network synthesis |
| Smooth light/dark EN/ES reader | Done within this change; six responsive reader screenshots and green frontend checks |
| Apply requested references | Done where accessible; two HTTP 429 sources unavailable |
| Fully provisioned public Edge service | Not verified/provisioned here; requires persistent backend and PocketBase origins |
| Live flawless UI / WCAG / Lighthouse guarantee | Not claimed; local smoke checks and measured limits documented |
