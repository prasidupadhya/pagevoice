# PageVoice

PageVoice is an open-source web app for reading and listening to PDFs and EPUBs.
It runs in the browser, keeps your documents on your device, and keeps working offline
after you download a voice once.

| | |
| --- | --- |
| Website | <https://pagevoice.tech> (app at <https://pagevoice.tech/app/>) |
| Status | Open beta |
| Contact | [support@pagevoice.tech](mailto:support@pagevoice.tech) |
| Source code | This repository, MIT licensed (see [License](#license)) |

![The PageVoice reader with a chapter open, the contents list on the left and the audio player on the right](web/public/screenshots/reader-desktop.jpg)

## What PageVoice is

PageVoice turns a PDF or EPUB into something you can read and listen to. You import a
document, read it with sections, bookmarks and search, and play it with a local voice
that reads the text aloud, sentence by sentence. The sentence being spoken is
highlighted. The document, the reading position and the generated audio are stored in
your browser on your device.

## Who it is for

- People who want to listen to long documents, or to read and listen at the same time.
- Readers who do not want to upload a book or report to a cloud service to hear it.
- Students and researchers who need to find a passage again, with its section
  citation.
- Developers and reviewers who want to see how a document reader can run entirely in
  the browser.

## The problem

Long documents are tiring to read in one sitting, and listening is often the only
option for people who find reading difficult. Many text-to-speech services need the
whole document uploaded to a remote server. Many reading apps cannot read aloud at all.
PageVoice tries to do both in one place, without sending the document anywhere.

## What works today

- Import EPUB files and PDFs with a text layer. Scanned PDFs need an optional
  one-time OCR download.
- Read with contents, bookmarks, search within the book, themes, text size and line
  width, and focus mode.
- Listen with downloaded local voices: Kokoro for English and Piper for Spanish.
  Playback speed from 0.5× to 2×, a sleep timer, and the sentence being spoken is
  highlighted.
- Search the whole book by keyword. Each result shows its section and sentence.
- Keep a library in the browser, with reading progress, and back it up or restore it
  as a ZIP file.
- Export prepared audio as MP3 files, with metadata and citations. Export as an M4B
  audiobook is available but is best effort.
- Work offline after the app and voices are downloaded.

## Why local processing matters

PageVoice does the work on your device:

- Reading the file, detecting the language and sections, OCR, speech generation,
  search and storage all run in your browser.
- The website has no server that receives your documents, and no accounts.
- The only network downloads are fixed model and runtime files. Each file is checked
  against a pinned hash, and the page's content security policy blocks connections to
  other servers. Requests for these files contain no document text.

What this does not guarantee:

- The website itself is served by a hosting provider, which can log standard request
  details such as IP address and the pages requested. Document text never appears in
  those requests.
- If you choose your device's built-in speech, the operating system's speech service
  reads the text, and some systems use online services for that. The app labels this
  option where you choose it.
- Browser storage can be cleared by the browser or by you. Export a backup to keep a
  copy.

## How it works

1. **Import.** The browser reads the file in a background worker. It extracts the text,
   the sections, the language and, for EPUBs, the cover.
2. **Store.** The book is saved in the browser's IndexedDB. Generated audio is saved in
   the origin private file system when the browser supports it.
3. **Read and search.** The reader shows the text in sections. Search runs against an
   index built on your device.
4. **Listen.** After you download a voice once, a local speech model generates audio
   for each sentence. The player plays it in order, and prepares the next sentences
   ahead of you.
5. **Keep or export.** Positions and bookmarks are saved as you go. You can export the
   library or the audio.

## Limitations

- **Open beta.** Automated browser tests pass in Chromium, and most pass in Firefox. Safari (WebKit)
  support is partial: offline reloads and some large downloads are not verified there.
  See [static verification](docs/static-verification.md) for the detailed test record.
- **Speed.** Speech generated on a slow processor can take longer than the audio
  lasts. The app shows the measured speed while it prepares.
- **Accuracy.** Language detection, OCR, dialogue attribution and section detection
  can be wrong. The app shows these results so you can correct them.
- **Languages.** Narration is available in English and Spanish only.
- **Storage.** Books live in one browser on one device. There is no sync and no
  sharing. Export a backup to move your library.
- **No generated answers.** Search finds passages. PageVoice does not summarize or
  answer questions yet.

## Roadmap and Claude

PageVoice does not use Claude or any other language model in the current product.
There is no Claude API integration, no API key, and no model call in the code.

Claude is the intended model for a planned analysis layer: source-grounded questions
with citations, summaries of chapters and themes, connecting ideas across long books,
explanations and study help, and better text preparation before narration. That layer
would be optional and off by default. Any text sent to a model would be shown to you
first. The local features would keep working without it. The full plan, including the
privacy rules and the quality bar, is in [docs/roadmap.md](docs/roadmap.md).

---

## Technical documentation

## Repository layout

```
web/                      The product: static site and reader application (React, Vite)
  index.html              Public introduction page
  app/index.html          The reader application
  src/                    Application code (see Architecture)
  e2e/                    Browser tests (Playwright)
pagevoice/, rag/          Optional Python command-line and server tool ("power mode")
tests/                    Tests for the Python package (run by CI)
scripts/                  Setup and maintenance scripts for the Python package
docs/                     Documentation, including the roadmap and verification records
legacy/hosted-backend/    Archived Docker/PocketBase experiment. Not used by the website.
vercel.json               Static hosting configuration for the website
```

## Feature reference

**Reading**

- Library with covers, author, format, page or section count, reading progress and
  last-opened time; sort, filter and "Continue reading"
- Paper, light and night themes; text size (16–32 px) and line width settings
- Contents drawer, previous/next section, bookmarks, focus mode
- Find in book (`/` or `Ctrl`/`⌘ F`): case- and accent-insensitive, highlights every
  match, `Enter`/`Shift Enter` to step through results
- Reading position is saved while you scroll or listen

**Listening**

- Kokoro (English) and Piper DaveFX/Sharvard (Spain Spanish) run locally in a Web
  Worker after a one-time download; Supertonic 2 is an experimental comparison engine
- The sentence being spoken is highlighted and scrolled into view
- Play/pause, previous/next sentence, playback speed 0.5–2×, sleep timer, media keys
- Audio is prepared ahead of the listening position; the buffer size is adjustable
- Export prepared chapters as an MP3 ZIP (with metadata and citations) or, best
  effort, as an M4B via single-threaded FFmpeg WASM
- Device speech (`speechSynthesis`) is available as an explicit fallback

**Search and structure**

- Keyword search across the book with section citations, "Show in source" and
  "Listen from here"
- Detected sections (chapters, front and back matter) with confidence, reasons and
  manual correction
- Optional local meaning search (multilingual MiniLM embeddings) and character-name
  detection (multilingual NER), each an opt-in download
- No language model generates summaries or answers; every result is a passage from
  the document

**Accessibility**

- Keyboard operable throughout, with visible focus and documented shortcuts
  (`Space`, `/`, `J`/`K`, `←`/`→`, `F`, `Esc`, `?`)
- Semantic landmarks, labelled controls, tab/tabpanel semantics and live status
  regions; dialogs use native `<dialog>` with focus return
- The spoken sentence is marked by an inset bar and an icon as well as colour
- `prefers-reduced-motion` and `prefers-color-scheme` are respected
- Interface in English and Spanish, independent of the document's language

## Supported formats

| Format | Notes |
| --- | --- |
| EPUB 2 / 3 | Chapters, metadata and cover. DRM-protected or encrypted books are rejected. |
| PDF with a text layer | Sections from bookmarks and headings; repeated headers, footers and page numbers are removed and listed as review notes. |
| Scanned PDF | Needs the optional English + Spanish OCR download (Tesseract). Multi-column or damaged scans may not be reconstructed well. |

Files up to 100 MB. Language (English or Spanish) is detected automatically and can be
corrected in **Voice & cast**. Other languages are not supported for narration.

## Architecture

The reader is a static web application. There is no server-side processing.

```
web/
  index.html          Public introduction page (static HTML)
  app/index.html      The reader application (React)
  404.html            Not-found page
  src/App.jsx         App shell, library, import feedback, dialogs
  src/ui/             Reader, player, library, display menu, find-in-book
  src/browser/        Parsing (pdf.js, JSZip, xmldom), sentences, language
                      detection, section analysis, keyword search
  src/offline/        Storage, model assets, speech engines, playback, workers
  src/styles/         Design tokens shared by the app and the introduction page
```

- **React 19 + Vite 8.** The reader route is code-split; the startup bundle holds
  the library and shell only.
- **Web Workers** do all heavy work: `reader.worker` (parsing, OCR, analysis, search
  index), `engine.worker` (Kokoro via kokoro-js, Piper via piper-wasm, Supertonic via
  ONNX Runtime Web; WASM by default, WebGPU optional for Kokoro), `knowledge.worker`
  (Transformers.js embeddings and NER), `search.worker` and `export.worker` (lamejs,
  FFmpeg WASM).
- **Storage.** IndexedDB holds documents, analysis and preferences; generated
  sentence audio is stored in the origin private file system (OPFS) with an IndexedDB
  fallback. Model files are cached by the service worker after hash verification.
- **PWA.** `vite-plugin-pwa` precaches the app shell, fonts and runtimes, prompts
  before updating, and serves `/app/` offline.

## Privacy and network use

What the implementation does:

- Documents, reading positions, bookmarks and generated audio are stored in this
  browser's storage on this device. Session-only imports are kept in memory.
- The app has no server component, accounts or analytics. Its code makes no request
  containing document text; the browser test suite asserts there are no non-GET or
  `/api` requests.
- Network requests are: loading the static site, and fixed, SHA-256-verified model
  and language-data downloads from Hugging Face and jsDelivr when the user chooses to
  download them. The Content Security Policy restricts `connect-src` to those hosts.
- **Exception:** device speech uses the operating system's voices, and some platforms
  process that speech with online services outside PageVoice's control. It is labelled
  where it is chosen and is never selected automatically.
- Browser storage can be evicted. **Protect local storage** requests persistence, and
  the library can be exported as a ZIP backup.

## Offline engines and download sizes

Sizes are decimal MB for a cold cache, including that engine's runtime.

| Tool | First download | License / limitation |
| --- | ---: | --- |
| Kokoro English, WASM q8 | 118.2 MB | Apache-2.0 model; English phonemizer only |
| Kokoro English, WebGPU fp32 | 362.5 MB | Optional GPU path; browser/adapter support varies |
| Piper DaveFX, Spain Spanish | 96.3 MB | MIT repository, CC0 dataset; GPL phonemizer |
| Piper Sharvard, Spain Spanish, 2 speakers | 109.8 MB | MIT repository, CC-BY-3.0 corpus; GPL phonemizer |
| Supertonic 2, experimental EN/ES | 278.2 MB | OpenRAIL-M restrictions; archived upstream |
| English + Spanish OCR | 25.4 MB | Apache-2.0 |
| Multilingual meaning search | 157.0 MB | Apache-2.0; inferred similarity, not evidence of an answer |
| Multilingual NER | 203.1 MB | AFL-3.0; news-domain model, fiction accuracy unmeasured |
| FFmpeg M4B | 32.3 MB | GPL/LGPL components; memory-limited browser export |

Full credits and licenses are in **Privacy & credits** in the app,
[web/LICENSES](web/LICENSES) and `/licenses/credits.html`. The original PageVoice code
is MIT licensed; third-party runtime and model licenses differ.

## Browser requirements

A current Chrome, Edge, Firefox or Safari (Safari support is partial; see
[Limitations](#limitations)) with WebAssembly, Web Workers, IndexedDB
and ES modules. OPFS is used when available. WebGPU is optional (Kokoro GPU only).
Service workers, OPFS and WebGPU need HTTPS or `localhost`. Phones can run the voices,
but memory and storage quotas vary and preparation can be slower than real time;
the measured real-time factor is shown while preparing.

## Local development

Node **22.13.1** and npm **10.9.2** are the verified versions (see `.nvmrc`).

```sh
npm ci --prefix web
npm --prefix web run dev
```

- Introduction page: <http://127.0.0.1:5173/>
- App: <http://127.0.0.1:5173/app/>

The web app needs **no environment variables**. `.env.example` documents only the
optional Python power mode and the archived hosted backend.

## Production build

```sh
npm --prefix web run build     # outputs web/dist
npm --prefix web run preview   # serves it on http://127.0.0.1:4173
```

The build copies pinned npm runtimes into static files. It does not download model
weights.

## Deployment

`vercel.json` deploys the static build from the repository root (Node 22, install
`npm ci --prefix web`, build `npm --prefix web run build`, output `web/dist`). It sets
security headers (CSP, HSTS, `nosniff`, frame denial, permissions policy), long-term
caching for hashed assets, revalidation for HTML and the service worker, a rewrite
for `/app/*`, and serves `404.html` for unknown paths. To use the custom domain, add
`pagevoice.tech` in the Vercel project's domain settings and point DNS at Vercel; the
canonical URLs, sitemap, robots file and social metadata name `https://pagevoice.tech`.

**Known issue.** At the time of writing, `pagevoice.tech` redirects to
`https://www.pagevoice.tech`, so the canonical links point to an address that
redirects. Choose one primary host in the Vercel domain settings, make the other
redirect to it, and update the canonical links to match. See
[static deployment](docs/static-deployment.md).

The hosted backend that appears in older notes (Docker, PocketBase, Caddy) is archived
in [`legacy/hosted-backend`](legacy/hosted-backend/README.md). The website does not use it.

## Testing

```sh
npm --prefix web test            # unit and component tests (Vitest)
npm --prefix web run lint
npm --prefix web run format:check
npm --prefix web run build
# Browser tests. The first command downloads pinned model files for the
# speech tests; it is opt-in and not part of normal setup.
node web/scripts/cache-e2e-models.mjs
npm --prefix web run test:e2e
```

`web/scripts/capture-screenshots.mjs` regenerates the introduction-page screenshots
and social image from the real app (it downloads the Kokoro voice and plays real
narration). Earlier verification reports are in [docs](docs/static-verification.md).
No word-accuracy or subjective speech-quality benchmark has been performed.

## Limits

CPU narration may prepare slower than real time; browsers can suspend background
tabs, and a closed tab stops preparing. Exports cap loaded WAV data at 256 MB and
backup import caps uncompressed data at 512 MB. Optional analysis caps 12,000 passage
windows. OCR, dialogue attribution, language detection and section classification can
need correction. Highlighting follows sentences, not individual words.

## Optional Python power mode

The `pagevoice/` and `rag/` packages are a separate, optional local command-line tool
and API with FFmpeg, Tesseract and explicit-consent online Edge narration. The website
never calls them. They have their own tests, which CI runs. They are not the hosted
service and are not deployed with the website.

```sh
bash scripts/setup.sh
.venv/bin/pagevoice inspect book.epub --language es
.venv/bin/pagevoice convert book.epub --engine edge --language es --allow-network
.venv/bin/python -m pytest -q
```

See [Python power mode](docs/python-power-mode.md).

## License

MIT for the original PageVoice code. See [LICENSE](LICENSE) and the third-party
notices above.
