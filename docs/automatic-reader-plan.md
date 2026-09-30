# Automatic book reader: findings and plan

Scope: automatic English/Spanish detection, more conservative source-grounded
analysis, and a quieter upload/reader workflow. The existing PocketBase ownership,
worker queue, API consent guards and temporary reader remain in place.

## Findings before implementation

- `vercel.json` now contains a string value for every header. The preceding
  `vercel.mjs` deployment failure was repaired in PR #34. Add a regression test
  for this exact configuration shape instead of changing a working header.
- Upload dialogs pass the interface locale as book language; the API also
  defaults to English. This overrides the EPUB's metadata and Spanish PDF text.
- Neither parser compares metadata with the actual body language. Automatic PDF
  OCR assumes English when a language was not provided.
- Structure analysis recognizes the entire prefixes “about”, “author” and
  “sobre” as biography. Narrative headings can consequently be skipped.
- Partial lexical retrieval searches surface forms but misses partial stem
  evidence. Full exact/phrase/stem matches must retain their higher ranking.
- Reader consent resets to unchecked on every book change. The requested default
  can be checked while retaining the disclosure and an opt-out; upload alone must
  never send narration text to Microsoft.
- The shared browser currently times out on navigation and snapshots. The local
  Vite server responds HTTP 200; visual checks will be retried.

## Implementation seams and verification

1. Add matching offline language detectors in `pagevoice/languages.py` and
   `web/src/browser/languages.js`, tested against shared, independently written
   examples. Sample body sections, use metadata when evidence is weak, expose
   evidence/review status, preserve an explicit API/CLI override. Detect before
   sentence splitting and choose the matching default voice. Automatic OCR uses
   eng+spa. Do not infer universal-language support from a two-language detector.
2. Extend the evaluation with separately labelled structural edge cases before
   changing `rag/structure.py`. Tighten biography headings, add explicit numbered
   headings, reset numbering at part boundaries, and avoid suggesting a short
   part divider before narrative prose. Preserve manual/document precedence and
   unclassified fallback. Add labelled partial stem retrieval without synonyms.
3. Remove upload language controls in both React readers, retain optional OCR
   controls under a disclosure, show detected language and review evidence.
   Default the visible network option to checked. Simplify dense secondary
   settings, loading states and reader spacing; preserve keyboard operation,
   EN/ES translations, both themes and reduced motion.
4. Run targeted tests, full Python/frontend suites, build/lint/format, fixed-gold
   evaluation, Vercel configuration checks and browser checks where available.
   Record actual results and limits, then commit/push/PR/merge (at most four commits).

## Design direction and references

Private reading room for readers: book text and playback take priority, settings
use native disclosures, controls remain compact. Retain the self-hosted Newsreader
for long reading and Source Sans 3 for controls. Use paper/ink neutrals and one
restrained teal accent, with consistent 8px radii. Motion is 180–240ms opacity or
transform, triggered by import, selection or readiness; reduced motion disables it.
Taste dials: variance 5, motion 3, density 3. Antislop: energy 2, rhythm 2, motion 1.
No new illustrations, invented statistics, testimonials or decorative status dots.

Read and apply as guidance, without copying implementations:

- [Frontend design](https://www.skills.sh/anthropics/skills/frontend-design):
  subject-specific hierarchy and two-pass critique.
- [Taste](https://github.com/Leonxlnx/taste-skill): preserve existing identity;
  use complete empty/loading/error states and responsive layouts.
- [Antislop](https://github.com/miqdadbadjuber/anti-slop) and
  [Unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md):
  functional controls, restrained hierarchy, factual copy.
- [Engineering](https://github.com/mattpocock/skills/tree/main/skills/engineering):
  behavior tests at public seams, focused checks, final review.
- [Boneyard](https://boneyard.vercel.app/overview): loading placeholders should
  reserve the real content's space rather than cause layout jumps.
- [beUI](https://beui.dev/): native accessible inputs and disclosures.
- [UI UX Pro Max](https://uupm.cc/) and [Impeccable](https://impeccable.style/):
  deliberate tokens, legible contrast and fewer competing containers.
- [Animated Heroicons](https://www.heroicons-animated.com/) and
  [Kinetics](https://kinetics.colorion.co/): interaction-triggered movement,
  adapted to the existing icon family rather than mixing libraries.
- [Designeer](https://www.designeer.xyz/) and [Rare UI](https://www.rareui.com/)
  were unreachable (HTTP 429 from direct fetch, web extractor errors). No unseen
  guidance is claimed or guessed.

Existing fixed-gold baseline (112 queries): accuracy/macro-F1 1.000,
recall@1 .930, recall@5 .940, recall@10 .950, MRR .936667, nDCG@10 .939871,
no-answer precision/recall 1.000. Search p95 2.31ms; build .290s, 1,462,272 bytes.
These small fixtures do not represent production-book performance.
