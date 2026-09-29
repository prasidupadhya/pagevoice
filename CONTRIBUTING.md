# Contributing

PageVoice reads English and Spanish PDF/EPUB books. Local parsing, extraction,
analysis and stored audio stay on this machine. Speech generation contacts
Microsoft Edge only after a user explicitly enables network narration for that job.
Do not weaken that consent check or add a cloud model to the default path.

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
