# Contributing

PageVoice reads English and Spanish PDF/EPUB books. The website (`web/`) runs entirely
in the browser: parsing, analysis, search, speech and storage stay on the reader's
device. The optional Python tool (`pagevoice/`, `rag/`) keeps its work local too. Its
Microsoft Edge narration contacts an online service only after a user explicitly
enables network narration for that job. Do not weaken that consent check, and do not
add a cloud model or any external API call to the website's default path.
Planned, opt-in language-model work is described in [docs/roadmap.md](docs/roadmap.md).
Hosted-backend files are archived in `legacy/hosted-backend/`.

## Development

Use Python 3.12 and Node 22.13.1 (see `.python-version` and `.nvmrc`). Install the
native prerequisites listed in [README setup](README.md#setup), then run:

```sh
scripts/setup.sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check pagevoice rag tests
.venv/bin/mypy --ignore-missing-imports rag/structure.py rag/query.py rag/lexical.py rag/features.py pagevoice/trash.py pagevoice/security.py
npm --prefix web test
npm --prefix web run lint
npm --prefix web run format:check
npm --prefix web run build
.venv/bin/pagevoice rag-eval --baseline rag/eval/after.json
```

Add focused regression tests for behavior changes. Parser or retrieval changes
must include source-grounded fixtures; never regenerate gold labels from retrieval
results. See [the evaluation contract](docs/rag-eval.md).

Keep one commit per project phase on the active branch. Use clear imperative commit
messages. Do not commit `.env`, personal books/audio or model weights. Optional
local ONNX weights are checksum-verified and installed only by an explicit command.
