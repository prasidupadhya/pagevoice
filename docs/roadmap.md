# Roadmap

This page separates what PageVoice does today from what is planned. Nothing under
**Planned** exists in the code. The repository has no Claude or Anthropic API
integration, no API key handling, and no model calls.

## Available today

- Import PDF (text layer) and EPUB files in the browser. Scanned PDFs need the
  optional OCR download.
- Read with sections, bookmarks, themes, text size and line width, and focus mode.
- Listen with downloaded local voices: Kokoro for English, Piper for Spanish.
  Speed, sleep timer, and sentence-level control.
- Keyword search across the book, with citations to sections and sentences.
- Optional local meaning search and character-name detection, each a separate
  download that runs on the device.
- Library storage in the browser, backup and restore as ZIP files, and export of
  prepared audio as MP3 or an experimental M4B.

## Planned: a Claude-based analysis layer

Claude is the intended language model for the features below. None of them is
implemented, and none will be shown as available until it is tested.

1. **Deeper analysis.** Summaries of chapters and themes, and structure notes, each
   built from passages the reader can open.
2. **Source-grounded questions.** Answers to questions about a book, with citations
   to the passages used. When the book does not support an answer, the answer should
   say so rather than guess.
3. **Connecting ideas across long books.** Retrieving relevant passages from across
   the whole book before a model reads them, so that long documents are covered.
4. **Explanations and study help.** Clarifying a passage, defining terms the book
   uses, and preparing questions for review, always tied to the source text.
5. **Better narration preparation.** Narration quality depends on the text the speech
   engine receives. A language model could help normalize numbers and abbreviations,
   split text at sensible boundaries, and identify who is speaking. The speech itself
   would still come from the local voice models.

### Privacy consequences

PageVoice's current guarantee is that documents stay in the browser. A Claude feature
would break that guarantee for the text it sends, so the design must keep these rules:

- Off by default. A person turns it on, and each request shows which passages will
  leave the device before it is sent.
- No API key in the frontend or in the repository. Keys need a server that the
  operator controls, or a key that the person supplies and that stays in their
  browser. Either choice needs a separate review.
- Local-only features keep working without it. Search, reading, and local narration
  do not depend on any external model.
- Requests and responses are not stored by PageVoice beyond what the person saves.

### Quality bar before launch

- Answers must cite passages. Citations must be checked against the text.
- Each feature needs a fixed evaluation set with expected results, following the
  approach in [rag-eval.md](rag-eval.md). Results from a retrieval step must not be
  used to generate the expected answers.
- Known limits, such as accuracy on fiction and uncertain speaker attribution, must
  be stated in the interface.

## Other planned work

- Verify Safari (WebKit) behaviour in offline reload and storage on real devices.
- Make the Python power mode's documentation match its current status.
- Add accessibility testing with assistive technology, beyond automated checks.
