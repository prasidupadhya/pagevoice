# TTS evaluation and implementation decision — 25 September 2026

## What the requested discussion establishes

The [Reddit discussion](https://www.reddit.com/r/MachineLearning/comments/12kjof5/d_what_is_the_best_open_source_text_to_speech/) is a useful research map, not a controlled benchmark. It mixes acoustic models, vocoders, complete narration systems and commercial services. Its recommendations span multiple years, devices and versions. Opinions on cloning quality conflict; no shared English/Spanish audiobook test set or consistent latency measurements establish a winner. The warning about comparing MOS across different papers is particularly relevant. A mention of Whisper should not be treated as a TTS recommendation: transcription is a different task.

For this product, a pleasing short demo is insufficient. A candidate must sustain long-form narration, preserve numbers and punctuation, support both languages, recover individual sentences, fit local hardware, and produce audio faster than it is consumed. We therefore retain a small adapter interface rather than expose every model mentioned in the thread.

## Primary-source cross-check

[Tortoise's own README](https://github.com/neonbjb/tortoise-tts) prioritizes prosody and multiple voices. It contains both historical slow-generation measurements and newer optimization/streaming claims. Those figures use different configurations and are not measurements on this Mac. Its documented Apple Silicon caveats and additional setup make it an optional future evaluation, not a justified replacement for a working local draft engine. We have not installed or benchmarked it, and copied no implementation.

The [maintained Coqui fork](https://github.com/idiap/coqui-ai-TTS) distributes `coqui-tts`, supports multiple speech architectures and documents cloning-cache support. We keep the pinned installed package rather than vendor its source. [XTTS documentation](https://coqui-tts.readthedocs.io/en/latest/models/xtts.html) describes multilingual synthesis, cloning, and model-specific inference controls. Its model weights and license are separate from the Python package. Neural output cannot be marked verified until licensed weights are installed and actual speech is evaluated locally.

## Product decision and tradeoffs

| Engine | Current role | Evidence / limitations |
|---|---|---|
| macOS speech | Immediate offline narration and eight curated voice styles | All eight generated valid PCM in this workspace. System voices can sound synthetic; they are not equivalent to a premium neural service. Available on macOS only. |
| XTTSv2 | Default neural adapter and consent-based cloning | Package present; weights absent. No claim of verified cloning or neural audio quality. Catalogue depends on installed model and uploaded profiles. |
| Edge | Explicit opt-in online draft | Existing adapter retained; sends narration to Microsoft. It is not local-first synthesis and is not silently used as a fallback. |
| Tortoise / GPT-SoVITS | Deferred adapters | No local comparison establishing improved bilingual throughput. Adding setup burden without measurements would not solve the playback bug. |

The eight local choices are one young-style and one older-style voice for each gender/language pair. “Style” describes the intended synthetic presentation, not a verified age of a real speaker. Legacy voice identifiers still validate for saved projects; the picker no longer lists the entire operating-system catalogue.

## Evaluation protocol

Use original English and Spanish passages with dialogue, abbreviations, decimals, long sentences and names. Measure time to twenty complete *natural sentences*, steady-state real-time factor (synthesis seconds / audio seconds), memory use, recoverability and missing/repeated words. Compare the same text, device and output settings. Conduct listening review for pronunciation, prosody, fatigue and speaker consistency; valid PCM alone does not prove naturalness.

Current automated evidence covers speech generation, WAV integrity, exports, pitch-preserving duration changes, natural sentence preservation, twenty-sentence gating, chapter priority, retry and resume. It does not establish a universal “best voice” or perfect OCR. The implementation fixes the product bottleneck directly: conversion arms the browser player, suspended audio exposes an explicit recovery action, and internal model windows no longer fragment the manuscript.
