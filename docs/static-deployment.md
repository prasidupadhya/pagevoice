# Static deployment

The current `web/` is a browser-only PWA. It has no API client, authentication,
PocketBase connection, Edge TTS call or serverless function. The Python CLI/API
is optional and separate. Older backend deployment instructions remain in
[deployment.md](deployment.md) for that historical power mode.

## Vercel

1. Import `prasidupadhya/pagevoice`, repository root directory.
2. Choose Node 22. The root `package.json` declares `22.x`.
3. Keep the checked-in install command `npm ci --prefix web`, build command
   `npm --prefix web run build`, output directory `web/dist`.
4. Do not set any environment variables. Delete the old `VITE_API_BASE_URL` and
   `VITE_POCKETBASE_URL` variables if they exist. They are no longer read.
5. Deploy the branch/PR preview first. Model downloads are large; test on Wi-Fi.
6. Visit Offline tools and explicitly download Kokoro English and/or Piper Spanish.
   PageVoice validates each file's size and SHA-256, then caches it. Install the PWA
   if the browser offers the install action.

`vercel.json` contains a SPA rewrite excluding assets, model runtimes, licenses,
robots, icons and the service worker. Hashed assets cache for one year; HTML and
`sw.js` revalidate. The CSP permits only the site's assets, blob media/workers,
WASM evaluation and the specific static model/data CDN redirect origins. It
contains no arbitrary HTTPS wildcard. Fonts are self-hosted. Camera/microphone
permissions are disabled. No book passages appear in network requests.

All ONNX runtimes use one thread. FFmpeg uses the single-threaded core. **No COOP
or COEP headers are required**, and cross-origin static model downloads do not
need COEP exceptions. Do not add multithreading without checking the runtime,
model CDN CORS/CORP headers and isolation behavior first.

The first app-shell visit caches the code required for parsing, speech, OCR,
search and exports. Model weights and language files download only on explicit
request. Workbox caches the shell; the asset manager caches verified static files
and OPFS stores partial downloads. Once the relevant tools are cached, airplane
mode can parse books, prepare speech and export audio. OS-provided device speech
is an exception: its offline behavior is outside the app's control.

## Verification checklist

- Upload native-text PDF and EPUB; inspect detected language and section evidence.
- Download EN/ES models; preview and prepare non-silent speech.
- Click Listen from here in a later chapter; wait for the buffer and inspect
  continued preparation in later chapters.
- Reload; verify the shelf, position and prepared audio are retained.
- Block the network; reload, upload another book and generate new local audio.
- Download OCR explicitly; scan a PDF online and again with the network blocked.
- Export chapter MP3 ZIP; optional M4B contains AAC audio and chapter metadata.
- Remove a playing/preparing book; Undo within eight seconds; remove and wait for
  purge. Confirm no audio/source records remain.
- Open the credits page offline. Check light/sepia/dark at 360/375/768/1440 px.

Local and public-site results are recorded in [static-verification.md](static-verification.md).
A successful local production build does not prove a live Vercel deployment. To
run the real browser suite against a deployed static site after installing its
test models, use the test-only override:

```sh
node web/scripts/cache-e2e-models.mjs
PAGEVOICE_TEST_BASE_URL=https://pagevoice-sepia.vercel.app npm --prefix web run test:e2e
```

This runs in isolated test browser profiles and does not modify other visitors'
libraries. No Vercel environment variable is needed for this command.
No backend origin or account setup is required for this release.
