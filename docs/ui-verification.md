# Reader UI verification

React 19.3.0, Vite 8.3.0, Tailwind 4.3.3 and Lucide React 1.47.0 are pinned
with the full npm lock. Tested with Node 22.13.1 and npm 10.9.2.

The reader includes English/Spanish interface dictionaries, independent book
language selection, persistent light/dark theme, local project list, EPUB/PDF
upload and OCR options, chapter previews, sentence editing, voice/output/device
settings, consent-based cloning sample upload, SSE progress and HTML audio players.
Dialogs use native modal behavior. Chapter tabs support arrow/Home/End navigation.
The layout stacks on narrow screens and disables animation for reduced motion.

Tests run with Vitest and jsdom, using API mocks for component interactions:
locale/theme persistence, Spanish book upload, consent checkbox gating, selected
sentence editing, dictionary key parity, and the read-only WebMCP tool contract.
A jsdom FileList/native-validation mismatch in the initial cloning test was fixed
in the test harness by submitting the form after verifying file selection; native
production validation remains enabled. No supported live WebMCP context was
available, so live WebMCP integration is not claimed as verified.

Five backend API/voice tests passed: voice uploads reject absent consent and
invalid duration; valid owned synthetic test recordings are stored with consent,
language and checksum; tampered references cannot be reused. XTTS cloning passes
references through its standard library adapter, but neural synthesis remains
unverified pending model-license acceptance and model installation.

The production build succeeded. The running Vite preview responded HTTP 200 and
was handed off at http://127.0.0.1:5173/ (tab_1). Automated browser visual QA was
not performed; component interaction tests and the production build were run.
The reader loads no external fonts, analytics, or cloud assets.
