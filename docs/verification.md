# Phase 1 verification — 2026-09-23

## Environment

- macOS/Darwin arm64; Python 3.10.12; Node v22.13.1 (not used yet).
- FFmpeg/ffprobe 8.1.
- beautifulsoup4 4.13.3; defusedxml 0.7.1; pySBD 0.3.4; pytest 8.3.5.
- coqui-tts 0.27.5; torch/torchaudio 2.8.0; transformers 4.57.6;
  edge-tts 7.2.3. Full installed versions: `requirements-macos-py310.lock`.
- `pagevoice doctor`: `device: mps`, `torch: 2.8.0` after optional installation.
  This is accelerator detection, not an XTTS benchmark.

## Commands run and observed results

```text
./scripts/setup.sh
# exit 0; repeated after optional engine installation, also exit 0
.venv/bin/pip install -e '.[xtts,edge]'
# exit 0
.venv/bin/pip check
No broken requirements found.
.venv/bin/python -c 'from TTS.api import TTS; import edge_tts; print("Coqui and Edge imports: OK")'
Coqui and Edge imports: OK
.venv/bin/pytest -q
7 passed in 8.76s
.venv/bin/python -m compileall -q pagevoice
# exit 0
```

Tests cover spine order rather than ZIP/manifest order, metadata, navigation
exclusion, English abbreviations, Chinese chunk length and text preservation,
unsupported languages, archive path traversal, online-engine opt-in, metadata
escaping, empty books, and persisted state/chunks after an injected engine failure.
Two smoke tests invoke the real CLI with macOS Samantha speech, assemble M4B and
MP3, probe codecs/chapters/title/author, check for nonzero PCM, and decode the
complete output with FFmpeg. No mock speech is used in those two smoke tests.
Audio has not received a human listening/quality review.

Persistent sample run:

```text
.venv/bin/python tests/sample.py outputs/sample.epub
.venv/bin/pagevoice convert outputs/sample.epub --engine say
Session: sessions/ba8d8736e95245fe83e3a4307848cc9b
[1/4] Arrival
[2/4] Arrival
[3/4] Morning
[4/4] Morning
Output: outputs/ba8d8736e95245fe83e3a4307848cc9b.m4b
Chapters: 2; duration: 7.446000 seconds
```

`ffprobe -v error -show_chapters -show_format -of json <output>` confirmed:

| Chapter | Start | End |
| --- | --- | --- |
| Arrival | 0.000000 | 3.844000 |
| Morning | 3.844000 | 7.445000 |

Title: `The Quiet Harbour`; artist: `PageVoice`; container duration: `7.446000`.
The tiny container/last-chapter difference comes from encoding time rounding.

## Errors and unverified paths

- XTTS startup was attempted with stdin closed. Coqui displayed its model-license
  acceptance prompt and the CLI returned `pagevoice: EOF when reading a line`
  (exit 1). No acceptance was supplied. This is a real startup test, **not a
  successful XTTS synthesis test**. First run interactively and review the model
  terms before accepting; model loading, inference, speed, and quality remain
  unverified here. The persisted session records the failure.
- Edge without `--allow-network` returned exit 1 and
  `Edge sends book text to Microsoft. Pass --allow-network to opt in.`
  Import and opt-in guard were verified; online synthesis was not run.
- Initial raw uppercase VoxNovel README URL returned 404; the repository's
  rendered lowercase README was reachable. No other reference code was fetched.
- No synthesis, FFmpeg, test, or dependency-resolution errors occurred on the
  tested macOS speech path.

## Checkpoint

Phase 1's offline EPUB → chaptered M4B/MP3 path is verified using macOS speech.
XTTS remains the default configured engine, with the explicit verification
limitation above. Phase 2 has not started. Main contains README only. Four
feature branches plus main meet the five-branch ceiling. The phase 1 feature
commit is one of the maximum four reserved for `feat/pipeline`; PR/merge is later.
