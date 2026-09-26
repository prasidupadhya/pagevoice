# Progressive listening

Select a chapter and choose **Listen from here**. The player starts after **20
consecutive sentences** from that point are ready. If fewer than 20 sentences
remain in the book, it waits for that shorter remainder. This is a contiguous
buffer: 20 scattered ready sentences cannot unlock playback over missing audio.

Preparation and listening proceed independently. The player reads committed
sentence WAVs, preloads up to four decoded sentences, and schedules them on the
Web Audio clock. It does not wait for a chapter MP3 or the final M4B. Narration
plays at its original speed and pitch. Pausing or stopping listening leaves
background preparation running. If playback catches up, it waits for the next
sentence and resumes without skipping text.

## Chapter priority and complete export

Starting at chapter 3 gives preparation order **3, 4, …, last, 1, 2**. Earlier
chapters never run ahead of that forward listening section; they are filled
later to complete the whole audiobook. Playback itself continues only forward
and ends at the last chapter; it does not wrap back to chapter 1.

Selecting another chapter while preparation is active changes priority at the
next sentence boundary. The engine finishes its current sentence, keeps the
same loaded model, then handles the newly selected chapter. Requests update a
small independent `sessions/<id>/listening.json` record and cannot create a
second synthesis job for the same book. Priority survives server restarts.
Sentence edits and regeneration also honor listening priority.

The complete M4B/MP3 is always assembled in the book's original chapter order,
regardless of the order in which audio was generated. Whole-book preparation
and chapter readiness are shown separately. Final encoding is labeled explicitly.

**Pause preparation** stops after the in-flight sentence is safely saved. It
unlocks voice/text editing; completed audio is retained. **Resume preparation**
continues from those chunks. Pausing preparation and pausing playback are separate
controls. Final encoding, once underway, finishes before the job completes.

## Performance and correctness fixes

- Already-normalized mono, 16-bit, 24 kHz PCM bypasses an unnecessary FFmpeg
  process per sentence. The full WAV is validated and atomically copied first.
- One engine instance is reused for the entire job, even across priority changes.
- Audio URLs include the generation checksum; missing, stale or damaged audio
  is rejected instead of playing an obsolete take.
- Job status is snapshotted before the manifest, avoiding a race where the UI
  could briefly see a completed job with no completed output.
- Chapter changes cancel old scheduled audio and stale audio downloads.
- Paused playback remains paused when SSE announces more ready sentences.
- Browser `fetch` is invoked with its correct global receiver. A real browser
  check caught an illegal-invocation issue not exposed by the first mocked tests.
- The listening panel appears above a bounded scrolling manuscript, so controls
  remain reachable on books with hundreds of sentences per chapter.

## Executed verification

```text
Backend suite: 48 passed (one existing Starlette/httpx deprecation warning)
Frontend suite: 17 passed
Production build: passed
```

Backend tests hold synthesis at sentence 21, verify the first 20 chapter-3
sentences can be downloaded while the job is running, switch priority to
chapter 4, and verify earlier chapters have not been prepared. Other checks
cover complete export order, restart recovery, stale audio rejection, and
pause/resume without regenerating completed chunks.

Player tests cover the contiguous threshold, short endings, forward chapter
traversal, scheduled adjacency, pause/resume, chapter switching, underrun recovery,
failed downloads and browser fetch invocation. UI controls are tested in both
English and Spanish, including controls remaining usable during preparation.

A headless Chrome audio-engine check used actual speech WAVs and an actual
AudioContext, without DOM inspection or visual automation:

```text
threshold: 20
scheduled: 4
AudioContext sample rate: 44100 Hz
actual decoded speech: 2.912108843537415 seconds
pause/resume: passed
```

Reproduce it with an existing completed English sentence in the library:

```sh
PAGEVOICE_URL=http://127.0.0.1:8766/ node scripts/check-audio-browser.mjs
```

The script uses the macOS Chrome path by default; set `CHROME_PATH` elsewhere.
It uses an isolated temporary profile, mutes test audio and cleans up its browser.
This validates the audio engine, not a full visual/browser interaction audit.

A real HTTP run uploaded an original four-chapter EPUB, chose Samantha, and
started from chapter 3 on this macOS arm64 machine:

```text
20-sentence buffer: 20.43 seconds
Playable sentence: 143878 bytes while the job was still running
Synthesis chapter order: [3, 4, 1, 2]
Total preparation: 104.37 seconds
Completed: 100 sentences
Downloaded audiobook: 4074303 bytes
Project: d377af7524a8463f9cc474abd04553cd
```

These timings apply to this sample and installed macOS voice, not to every book
or engine. A 20-sentence buffer cannot overcome sustained synthesis slower than
playback; the player waits safely when necessary. Neural synthesis/cloning still
requires local XTTS model/license setup and has not been end-to-end verified.
Background tabs may be suspended by a browser/OS; playback is not an installed
native background-audio service. English/Spanish and light/dark support remain.

The Web Audio scheduling behavior follows the documented
[AudioBufferSourceNode start API](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start)
and [AudioContext resume API](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume).
