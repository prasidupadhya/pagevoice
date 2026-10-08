# Static offline reader: verification

Baseline recorded on 2026-10-05; public-site verification repeated on 2026-10-06.
The website is replaced by a static browser PWA; the
`pagevoice/` and `rag/` Python implementations are unchanged. The hosting-policy
test was updated to check the new, narrowly allowed static model CDN origins.
The initial audit and implementation plan is in [static-reader-plan.md](static-reader-plan.md).

## Commands and results

Verified environment: macOS ARM64, Apple M3 Pro, 18 GiB RAM, Node 22.13.1,
npm 10.9.2, Chromium 153. These are desktop measurements, not phone measurements.

| Command, from the repository root | Actual result |
| --- | --- |
| `npm ci --prefix web` | Pinned dependency installation completed |
| `npm --prefix web test` | 101 tests passed in 13 files |
| `npm --prefix web run lint` | Passed; zero warnings |
| `npm --prefix web run format:check` | Passed |
| `.venv/bin/ruff check pagevoice rag tests` | Passed |
| `npm --prefix web run build` | Production assets and service worker generated |
| `npm audit --prefix web --audit-level=low` | 0 vulnerabilities |
| `node web/scripts/cache-e2e-models.mjs` | Downloaded/hash-verified real test model assets; explicit test setup only |
| `npm --prefix web run test:e2e` | 6 browser tests passed; real inference, no speech mocks |
| `PAGEVOICE_TEST_BASE_URL=https://pagevoice-sepia.vercel.app npm --prefix web run test:e2e` | 6 passed on the public site on October 6 (then at a Vercel preview address); 219.5 seconds |
| `.venv/bin/python -m pytest -q` | 157 passed, one existing Starlette/httpx deprecation warning |
| `npx --yes vercel@60.1.3 build --yes` | Passed; `.vercel/output` contains static files, no functions |

The browser suite takes about three minutes with the model files already
downloaded. First-time model downloads take longer. Test fixtures are small and
do not establish large-book robustness. The manual GitHub workflow
`browser-evidence.yml` provides the same real-model suite; its remote run is not
part of the local results above.

The local baseline is [playwright-summary.json](verification/static/playwright-summary.json):
6 expected, 0 unexpected, 0 skipped, 0 flaky, 194.6 seconds.
The repeat against the public site is
[public-playwright-20261006.json](verification/static/public-playwright-20261006.json):
6 expected, 0 unexpected, 0 skipped, 0 flaky, 219.5 seconds. Today's Python repeat
passed 157 tests in 63.30 seconds with the same existing warning. Today's frontend
repeat passed all 101 unit tests, lint, formatting and production build.

The first October 6 dependency-audit repeat reported seven findings from two
advisories added to the audit response: [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
and [sprintf-js](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). The final lockfile
pins source-map-js 1.2.2 and replaces ONNX Node's global-agent dependency with
4.1.3, removing the obsolete roarr/sprintf-js chain. Transformer/Kokoro/browser
runtime versions are retained. A clean `npm ci`, Node proxy bootstrap/ONNX import,
frontend checks and audit are rerun after this change; the final audit reports
zero vulnerabilities. [Audit evidence](verification/static/npm-audit-20261006.json).
All 89 emitted production files are byte-identical to the public-site-tested
build after these tooling/Node-only dependency updates; the recorded live speech
and Lighthouse results still apply. [Build comparison](verification/static/build-comparison-20261006.json).

`PAGEVOICE_TEST_BASE_URL` is only a test-runner override. It does not configure
the app, require a backend or create a production environment variable. Tests
load the actual deployed app and its workers. The test harness serves some small
CDN assets from previously downloaded, SHA-256-verified files; large model
requests continue to the CDN. Inference is real. Offline phases block the network
after the app has cached those files. These tests do not promise CDN availability.

A real Vercel preview was published with
`npx --yes vercel@60.1.3 deploy --prebuilt --yes`. Authenticated `vercel curl`
checks returned HTML and Piper WASM with HTTP 200, the intended CSP/content types,
and the WASM's expected SHA-256. The collaborative browser redirected to Vercel's
preview-protection login, so this is a hosted-file/header check rather than a
public browser flow. [Preview evidence](verification/static/vercel-preview.json).
The preview was subsequently promoted. That earlier Vercel address is historical; the current site is `https://www.pagevoice.tech/`.
The full public browser suite above now verifies the production reader, cached
service worker, OCR, speech, exports and removal, rather than just hosted files.

### What the browser tests actually exercised

- EPUB3 upload, automatic EN detection, real Kokoro WASM synthesis, positive RMS
  and plausible duration, sentence highlighting, keyword search and MP3 ZIP.
- Native-text PDF parsing through the production bundled pdf.js worker; Spanish
  EPUB upload and real Piper synthesis. Unit tests also cover EPUB2/NCX parsing.
- Persistent source/analysis/audio after refresh; playing cached audio offline;
  changing the Kokoro voice and generating **new** speech with the network blocked.
- Scanned-PDF OCR through real Tesseract English/Spanish data, then another OCR
  upload with the network blocked. This checks the less commonly used LSTM runtime
  as well as the language cache.
- A later-chapter listening start with a 20-sentence contiguous buffer. Playback
  was first observed at 21 prepared sentences in the recorded poll; no earlier
  chapter audio was prepared at that point. Chapter 4 continued preparing. Removing
  the rendering book left zero owned audio records after the undo window.
- Removal and Undo, model switching, real Supertonic Spanish output, optional
  embeddings and NER, and an actual FFmpeg-WASM M4B export.
- Requests were checked for `/api` and non-GET transfers: none. The core test
  reported no page errors. Inference reads pinned cached files; no book text is
  included in model download requests.

[Buffer evidence](verification/static/progressive-buffer.json),
[audio evidence](verification/static/desktop-audio.json),
[optional-model evidence](verification/static/local-model-benchmark.json).
October 6 repeats are in [public-audio-20261006.json](verification/static/public-audio-20261006.json),
[public-models-20261006.json](verification/static/public-models-20261006.json) and
[public-buffer-20261006.json](verification/static/public-buffer-20261006.json).
Cache/storage unit tests additionally cover SHA mismatch, rejected POST requests,
range resume, shared-runtime/model removal, session-only data, crash recovery,
cross-tab removal, in-flight deletion, backup validation and object-URL cleanup.
Playback unit tests cover waiting, pause/resume races, ordered preparation and
engine changes. Parser tests cover abbreviations, initials, decimals, URLs, quotes,
missing spaces, numbered lists and EN/ES sentence boundaries.

## Measured speech runtime and output

RTF = synthesis wall time / generated audio duration; lower is faster. Downloads
are excluded. The first utterance includes cold adapter/model initialization.
Warm values below exclude it and are weighted by generated duration. These are
short fixtures at pace 1, not naturalness, pronunciation or word-accuracy scores.

| Engine / device | First-utterance RTF | Warm RTF | Signal evidence |
| --- | ---: | ---: | --- |
| Kokoro q8, WASM CPU | 2.42 | 2.68 | 12.03 s total; RMS 0.061–0.068 |
| Piper DaveFX, WASM CPU | 0.68 | 0.20 | 6.36 s total; RMS 0.152–0.172 |
| Supertonic 2, WASM CPU | 0.58 | 0.46 | 9.45 s total; RMS 0.038–0.055 |
| Piper Sharvard, speaker 1 then 2 | 0.94 | 0.23 | RMS 0.074 and 0.102 |
| Kokoro fp32, native WebGPU | 1.99 | 0.16 | Same 3.825 s utterance twice; RMS 0.073 |

The Supertonic comparison used the same three Spanish sentences as Piper. It did
not show a runtime advantage, and no listening-panel or pronunciation evaluation
was performed. Piper remains the Spanish default. Supertonic is experimental and
its upstream is archived. Kokoro's English phonemizer is not exposed for Spanish.

Native hardware measurements are in
[native-webgpu-sharvard.json](verification/static/native-webgpu-sharvard.json).
Headless Chromium did not stand in for hardware WebGPU. No mid-range phone was
available. CPU Kokoro was slower than real time here: the app displays measured
RTF and a rough remaining-time estimate rather than assuming immediate playback.
CPU is the conservative default. WebGPU is an explicit compute choice because
its model download is larger; a GPU initialization failure asks the user to choose
CPU rather than silently downloading a second model.

The exported English MP3 decoded with FFmpeg: **6.984 s**, RMS **0.06087**, 111,744
bytes. The ZIP also contained metadata and sentence citations. `ffprobe` found
real AAC audio and a chapter table in the M4B: **9.482 s**, chapter 0–9.453 s,
title/artist/generated-speech metadata. This small one-chapter test does not
establish multi-hour M4B reliability.
[Export evidence](verification/static/export-audio.json).

## Local analysis and retrieval

Document roles outrank navigation/bookmarks, language-aware title rules and
conservative inference. Unknown sections remain unclassified. Each section
exposes its reason, source, confidence and excerpt, with manual title/kind/start
corrections. Language detection and dialogue attribution are heuristic and
reviewable. NER is optional and labelled inferred; its news-domain model is not a
validated fiction character resolver.

Lexical search is local, accent-insensitive and removes EN/ES stopwords. Exact
matches precede labelled partial matches, with neighbouring context and stable
chapter/sentence citations. Optional multilingual embeddings use sentence-sized
windows, deterministic long-sentence overlap and a 0.45 cosine threshold. Weak
similarity is not returned as evidence of an answer.

The recorded three-sentence Spanish fixture gave cosine 0.4248 for “el sonido del
mar” and 0.3010 for “costa y océano”; both remain below that threshold. An unrelated
query gave 0.0655. The exact “olas” query returns lexical evidence. NER identified
María with separate citations at sentences 0 and 2. Warm embedding query times
were 14–19 ms on this fixture; the first query including model initialization was
833 ms. These checks are **not** a recall/MRR evaluation or a long-book benchmark.
The older Python RAG evaluation numbers do not measure this browser implementation.

## Bundle, downloads, PWA and security

Production build: entry JavaScript **426.0 kB / 134.3 kB gzip**, Reader chunk
**53.8 / 15.3 kB**, CSS **34.2 / 8.1 kB**. The service worker precaches 66 app-shell
files, about **6.25 MiB**. Large runtimes are static, lazy-loaded separately; all
published files total about **161 MB**, including emitted and self-hosted runtime
variants. Model weights are not part of the build. Offline readiness costs more
shell caching than a minimal online reader.

| Explicit optional download, cold cache | Decimal MB including runtime |
| --- | ---: |
| Kokoro CPU / WebGPU | 118.2 / 362.5 |
| Piper DaveFX / Sharvard | 96.3 / 109.8 |
| Supertonic 2 | 278.2 |
| EN + ES OCR | 25.4 |
| Multilingual embeddings / NER | 157.0 / 203.1 |
| FFmpeg | 32.3 |

Shared runtime files reduce later downloads. Pause retains partial files in OPFS;
resumption uses ranges when supported and safely restarts that file otherwise.
Weights have pinned revisions, byte lengths and SHA-256 checks. The manifest and
192/512 px icons ship locally; the service worker and blocked-network flows were
tested. The browser's native install prompt and an installed-app launch were not
manually tested on every platform. Lighthouse 12 has no PWA score category; none
is invented here.

All inference uses workers. ONNX and FFmpeg run single-threaded, so COOP/COEP are
not needed. Vercel's CSP allows the site's assets, blob media/workers, WASM and
specific static CDN origins; it has no general HTTPS wildcard. Fonts are
self-hosted. Camera and microphone are denied. Device speech is a clearly labelled
fallback whose cloud/offline behavior belongs to the browser/OS; it has no export.

## UI and accessibility evidence

Lighthouse **12.6.1** audited the built site at `http://127.0.0.1:4182/`:

| Audit | Mobile simulation | Desktop |
| --- | ---: | ---: |
| Performance | 97 | 100 |
| Accessibility | 100 | 100 |
| Best Practices | 100 | 100 |
| SEO | 100 | 100 |

Mobile simulated LCP was 2.415 s, TBT 0 ms. Desktop LCP was 0.569 s. These measure
the empty shelf, excluding neural-model downloads/inference. Results:
[mobile](verification/static/lighthouse-mobile-final.json),
[desktop](verification/static/lighthouse-desktop-final.json).

Axe found **zero violations in 24 audited public-site screens** on October 6:
empty shelf and reader in light, sepia and dark at 360, 375, 768 and 1440 px.
No horizontal overflow was found. The reader test explicitly waits for its lazy
chunk and actual sentence text before auditing.
Tests exercised keyboard drawer/help dismissal and focus restoration, interface
language switching and reduced-motion mode. Automated audits do not establish
complete WCAG conformance or real screen-reader usability.
[Axe evidence](verification/static/accessibility.json).

[Before/after screenshots](screenshots/static) contain the previous backend gate
and 25 new shelf/reader images. [Design notes](static-design.md) describe the paper
themes, ink readiness, typography, focus and motion rules.

## Requirement checklist

| Requirement | Status and evidence / limit |
| --- | --- |
| Static Vercel; no backend/API/accounts/Edge/PocketBase | Done in web code, production build and browser request assertions; Python power mode remains separate |
| Cached models, offline processing, installable PWA | Done: pinned caches, manifest/SW, offline OCR and new speech; platform install UX remains unverified |
| Persistent/session-only library, remove, clear, meter, backup, saved position/audio | Done: IDB/OPFS and unit/browser tests; browser quota/eviction remains a risk |
| EPUB chapters/cover/metadata and PDF continuous text/margin suppression | Done on fixtures; complex multi-column documents and very large books not stress-tested |
| Worker OCR EN/ES, progress/cancel | Done; scanned fixture also passes offline; OCR accuracy is unmeasured |
| Kokoro EN WebGPU/WASM; Piper ES; Supertonic comparison | Done with actual non-silent inference and RTF; GPU selection/failure fallback is manual; Supertonic experimental; no Kokoro ES path exposed |
| Device-speech last resort, honest limits | Done; intentionally no export or guaranteed offline behavior |
| Voice preview/pace/casting/pauses/changed-sentence regeneration | Done with cached previews, signature-based invalidation and unit coverage; cold preview requires the explicit download first |
| Buffered playback, sentence/chapter seek/highlight, media session, RTF | Done; 20-sentence and chapter-order browser test, player unit tests; native OS media controls not manually tested on every OS |
| Section correction, character/dialogue heuristics, NER, lexical/hybrid search | Done, citations and inference labels retained; no large labelled fiction-retrieval/NER quality evaluation |
| Optional WebGPU LLM summaries | Not implemented: optional feature skipped; no generated claims |
| Chapter MP3 ZIP and best-effort M4B | Done with real encoded/decoded output; 256 MB WAV export limit, multi-hour M4B unverified |
| Remove old web connection errors and server clients | Done; no API client or backend-error screen remains |
| Reading-first shelf/reader, three themes, self-host fonts, EN/ES | Done; screenshots and unit/browser tests |
| Download progress/pause/resume/cache/offline/error states | Done; asset and integration tests; resumability depends on CDN range support |
| Accessibility, keyboard, reduced motion, responsive | Done for automated checks/recorded widths; real screen-reader and Safari/iOS testing not completed |
| Playwright acceptance, unit tests, Lighthouse, sizes, desktop RTF | Done; stored evidence above |
| Mid-range phone RTF and speech-quality comparison | Not done: no phone available; no quality benchmark performed |
| Licenses checked and exposed offline | Done: pinned model cards, corpus attribution and shipped full notices; see credits and `web/LICENSES/` |

## Commit changelog

1. `5b382d2`: static reader foundation, persistent private library, local parsing,
   model caching/worker engines, progressive playback, analysis, exports and PWA.
2. `600f3ab`: production OCR runtime, buffering/playback races, deletion and
   storage safety, real browser acceptance fixtures.
3. `1f13eb6`: retain manual casting, discard obsolete audio after edits/settings
   changes, keep shared assets when removing a model, and publish measured
   evidence, credits/deployment guidance and screenshots. The two original
   unmerged follow-up commits were consolidated without changing their final tree.
4. October 6 verification commit: add a reusable public-site test target, audit
   the actual reader at 360/375/768/1440 px in all themes, and record the six-test
   public acceptance run. Pin the two security dependency updates found by
   today's audit. This retains the four-commit limit on the branch.

## Known limits and deployment scope

Local Chromium tests and Vercel's static build pass. The public production site
was loaded and tested on October 6, including the blocked-network core flow.
The PR/merge status is reported separately. No backend URL or Vercel environment
variable is required.

Offline models need a substantial first download. CPU English may prepare slower
than playback. Tab suspension or closing stops preparation; reopening retains
completed persistent chunks. Storage can be evicted, and people sharing a browser
profile share its library. Use the backup export for durable copies. Memory limits
vary; imports cap expanded ZIP data at 512 MB, audio exports at 256 MB loaded WAVs,
and optional analysis at 12,000 passages. Large-file limits are guards, not proof
of 100 MB or 600-page performance. OCR, language, section and speaker inference
require review for some books. DRM/encrypted and unsupported-language books are
rejected. Device speech may use an OS cloud service. No paid or online TTS engine
is used for generated/downloadable audio.

Licenses differ from the original MIT app: Kokoro/embedding models are Apache-2.0;
Piper models' repository is MIT with CC0/CC-BY corpus attribution; its eSpeak
phonemizer is GPL-3.0; NER is AFL-3.0; Supertonic 2 is OpenRAIL-M; OCR is Apache-2.0;
FFmpeg and MP3 runtime components have GPL/LGPL notices; fonts are SIL OFL. The
credits screen links exact source/model revisions and includes full runtime notices.
