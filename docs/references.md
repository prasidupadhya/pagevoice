# Reference reading

Read on 2026-09-23. Only README/product concepts were consulted, plus the
maintained Coqui public API documentation. No reference repository was cloned,
forked, vendored, installed as an audiobook wrapper, or used as source code.
`coqui-tts` itself is an ordinary optional PyPI dependency as requested.

| Reference README | Design idea retained |
| --- | --- |
| [ebook2audiobook](https://github.com/DrewThomasson/ebook2audiobook#readme) | Separate book parsing, speech chunks, and chaptered export; future OCR and markup |
| [VoxNovel](https://github.com/DrewThomasson/VoxNovel#readme) | Future editable character-to-voice assignments |
| [epub2tts](https://github.com/aedocw/epub2tts#readme) | Simple EPUB flow and an explicitly online draft engine |
| [Pandrator](https://github.com/lukaszliniewicz/Pandrator#readme) | Future sentence review and selective regeneration |
| [Coqui TTS](https://github.com/coqui-ai/TTS#readme) | Multi-speaker synthesis capability |
| [Maintained Coqui](https://github.com/idiap/coqui-ai-TTS#readme) | Install maintained package; install PyTorch separately |
| [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS#readme) | Optional few-shot adapter, deferred |
| [VoiceStudio](https://github.com/debpalash/VoiceStudio#readme) | Engine catalogue and local workflows; no AGPL code taken |

Public engine API: https://coqui-tts.readthedocs.io/en/latest/models/xtts.html
Edge service documentation: https://github.com/rany2/edge-tts#readme

The uppercase VoxNovel `README.md` raw URL returned 404; its rendered README
(`readme.md`) was reachable and read instead.

Phase 4 must first read all six user-provided design references and report
unreachable sources. No UI design has started in phase 1.
