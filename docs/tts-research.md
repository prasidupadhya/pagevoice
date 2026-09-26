# Narration research and decision — 26 September 2026

## Decision

**Keep Edge as the website's only narration engine. Remove XTTSv2 and cloning.**
The user's listening assessment is the strongest evidence about their preferred
sound. Replacing it with an untested local model would not address that feedback.
The measurable application bug was independent of model quality: a universal
220-character window broke sentences into separate requests with independent
prosody and trailing silence. We removed that constraint for ordinary sentences.

## Reading the requested discussion critically

The [MachineLearning discussion](https://www.reddit.com/r/MachineLearning/comments/12kjof5/d_what_is_the_best_open_source_text_to_speech/)
contains an architectural bibliography, anecdotes about Tortoise/diffusion quality,
comments favouring Mimic3's ease of use, Coqui suggestions, and later references to
MARS5. Participants disagree about cloning quality and practical inference speed.
They use different hardware, settings, voices and versions. The thread does not
provide a common bilingual audiobook benchmark or establish a best engine.

It also mixes complete speech systems, acoustic models, vocoders and development
toolkits. Those are not interchangeable application dependencies. The caveat about
comparing MOS scores across papers matters: a score from a different test set and
listener population is not a direct ranking. Whisper's mention does not make it
a narration candidate; transcription and synthesis are different tasks.

## Primary-source comparison

| Candidate | What the primary source supports | Fit for PageVoice |
|---|---|---|
| Edge through `edge-tts` | Online Microsoft service; voice listing, rate/pitch/volume controls; restricted SSML | Keep. Matches the user's preferred audio and was exercised in this environment. Not open-source model weights and not offline synthesis. |
| Kokoro82M | Compact82-million-parameter model with Apache-licensed weights; English and Spanish voices | First local built-in-voice candidate to benchmark if offline narration returns. Its published Spanish catalogue has one female and two male voices, so it does not meet the requested two-female Spanish selection as-is. |
| Chatterbox Multilingual | Multilingual family includes English and Spanish; current docs describe multilingual variants and regional Spanish models | Candidate for a future independently evaluated local neural engine. Turbo/Nano are presented as English-focused; their speed claims cannot be transferred to bilingual narration. Not installed or benchmarked here. |
| Piper | Local neural engine with a `piper-tts` package and downloadable voices | Candidate when CPU/offline operation is more important. Requires selecting and auditioning specific voice models; no evidence here that its audiobook quality beats the preferred Edge voices. |
| Tortoise | Focus on multi-voice prosody; README mixes historical slow-generation figures with later optimization claims | No reason to add it merely because it was popular in the older thread. Requires a controlled hardware/version/voice comparison. |
| MARS5 | Published repository describes an English model and a two-stage architecture | Does not satisfy this product's English-and-Spanish requirement as published. |
| XTTSv2 | Previously integrated adapter | Removed at the user's request. No fallback to it and no new cloning uploads. |

Sources: [Edge documentation](https://github.com/rany2/edge-tts),
[Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M),
[Kokoro voice catalogue](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md),
[Chatterbox documentation](https://github.com/resemble-ai/chatterbox),
[Piper documentation](https://github.com/OHF-Voice/piper1-gpl),
[Tortoise README](https://github.com/neonbjb/tortoise-tts),
[MARS5 README](https://github.com/Camb-ai/MARS5-TTS).
No reference application code was cloned, copied or vendored.

The product-fit column is our engineering judgement, not a published comparative
quality result. Model-family marketing claims are not measurements on this Mac.
A model being newer or smaller does not establish better Spanish pronunciation,
long-form stability or character consistency.

## Findings in our implementation

1. **Mid-sentence segmentation:** the previous synthesis loop split at220
   characters regardless of engine. A long natural sentence therefore acquired
   multiple unrelated endings and restarts. Ordinary sentences now use one Edge
   request. Only exceptionally large text splits, bounded by3500 UTF-8 bytes,
   preferring clause punctuation and preserving complete words.
2. **Provider padding:** eight live voice tests found about0.8–0.9seconds of
   trailing silence before the fix. Near-silent edge padding is now capped at40ms
   leading/220ms trailing. Interior pauses and explicit `[pause:N]` remain intact.
   At artificial request joins, guards protect quiet consonants; there is no
   blanket silence-removal filter over the full audiobook.
3. **Language boundaries:** the previous splitter kept multiple quoted sentences
   together and split Spanish honorifics such as `Sr. García`. Original EN/ES
   rules now cover quoted punctuation, honorifics, decimals, initials, URLs,
   numbered lists and missing spaces after periods. Ambiguous abbreviations
   still require review rather than promises of universal correctness.
4. **Document boundaries:** page-by-page PDF fallback interrupted sentences across
   page turns. Unstructured pages now form continuous text. Repeated margins are
   recorded for review instead of being fed repeatedly into narration.
5. **Retrieval quality:** OR-ing every query word let common words dominate the
   old search. Stopword filtering, complete-keyword matching, explicit partial
   labels, context windows and cited sentence targets make results more useful.
   Retrieval cannot repair a wrong extraction by itself, so source inspection and
   manual structural corrections are first-class controls.

## Live voice verification

Microsoft's live catalogue confirmed eight choices: Aria, Jenny, Guy, Christopher,
Elvira, Dalia, Álvaro and Jorge. The English choices are US voices; Spanish choices
cover Spain and Mexico. Catalogue metadata supports gender/region and voice
personality descriptions, not reliable young/old age categories. We removed the
invented age labels.

`scripts/check-edge-quality.py --allow-network` sends original297-character
English and332-character Spanish sentences, each longer than the removed limit.
All eight used one synthesis request. After padding normalization, generation plus
validation took0.61–1.48seconds per sample and produced12.96–17.99seconds of audio
in this run. FFmpeg's `silencedetect=noise=-45dB:d=0.4` reported no silence event in
these samples. Network conditions and later service changes can alter timings.

These checks prove request continuity, decodable audio and the absence of detected
long silence in the test samples. They do **not** prove human-level pronunciation,
subjective naturalness or perfect word accuracy. We did not benchmark Kokoro,
Chatterbox, Piper or Tortoise against Edge locally, so no such winner is claimed.

## Gate for any future alternative

Use the same original EN/ES text, hardware and output format. Include dates,
numbers, abbreviations, dialogue, names, long sentences, accents and chapter
transitions. Measure first20-sentence readiness, steady-state real-time factor,
peak memory, missing/repeated words, restart behaviour and export validity.
Then perform blinded listening comparisons for pronunciation, prosody, fatigue
and voice consistency. A candidate must improve the actual audiobook experience
without weakening Spanish support or restoring the setup complexity just removed.
