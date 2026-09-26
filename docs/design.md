# Reader design

## Intent

A private reading workbench for people converting their English and Spanish
books to audio. The task begins with a book, continues through chapter review
and voice selection, and ends with a playable/downloadable audiobook. Interface
language is independent from book language. No cloud publishing is involved.

## Direction and pre-build critique

The memorable element is the manuscript: generous readable serif text, real
chapter numbers, and a narrow vertical reading guide. Controls use system sans.
Avoid a marketing hero, fictional statistics, equal-sized dashboard cards,
decorative waveforms, and continuous decorative motion. Initial plan included
book-cover cards; removed because most uploaded books have no cover extraction.
The actual title, author, chapters, and sentences carry the page instead.

Light tokens: paper #f5f8fb, sheet #ffffff, ink #172d40, muted #536778,
blue #245c82, line #cbd7e0. Dark tokens: background #142433, sheet #1b3042,
ink #eef5fa, muted #b4c8d6, blue #8ccced, line #40586c. Use semantic focus,
success, warning, and error tokens in both themes. No externally loaded fonts.

Layout: a compact top bar for library, interface language, and theme; project
rail; manuscript workspace with chapter navigation; voice/export controls; an
ordinary accessible audio player. Stack the columns on small screens. Keep
controls at least 44px high. Body copy is 16px or larger; controls at least 14px.
Keep reading lines below 80 characters and preserve focus when status updates.

## Guidance actually read

- https://www.skills.sh/anthropics/skills/frontend-design and its linked SKILL.md:
  intentional typography, one distinctive decision, restrained decoration.
- https://impeccable.style/ and /docs/critique/: assess hierarchy, cognitive load,
  empty/error states, and responsive/theming consistency.
- https://designwithintent.ai/: autonomy, accessibility, truthful progress,
  no prechecked consent, and recoverable actions.
- https://beui.dev/ and /docs/motion-patterns.md: short press/state feedback,
  semantic movement, stable layout, and reduced-motion fallback.
- https://www.rareui.com/: component-level interaction restraint. Homepage was
  readable; machine-readable documentation returned 429, so no inaccessible
  component API was inferred or copied.
- https://lucide-animated.com/ and /llms.txt: Lucide icons with semantic state
  motion. Use the official Lucide React package with original CSS transitions;
  motion is disabled for reduced-motion preferences.

The supplied Sites skill was applied to working-surface layout, typography,
local preview and validation. Existing local React/Vite/FastAPI architecture
and local-only instructions take precedence over hosted scaffolding/deployment.
No cloud Site is registered. No external reference audiobook code is copied.

## Progressive listening refinement

The reader now leads with an accessible listening panel above a bounded manuscript.
Chapter tabs expose real readiness counts; the current spoken sentence is highlighted
and chapter selection follows forward playback. A contiguous buffer indicator answers
when listening can begin, while the separate whole-book progress explains the export.
Pausing playback and pausing preparation are visibly distinct. Natural narration
speed/pitch are preserved; no decorative waveform or fabricated time estimate is shown.
Controls remain available while completed audio is playing and future chunks synthesize.

## Requested AudiobookGen reference update

Reviewed https://audiobookgen.com/ and https://audiobookgen.com/upload on
25 September 2026. The reference uses a centered upload card, generous spacing,
rounded controls, warm charcoal surfaces and amber accents. PageVoice now applies
that direction with original CSS, a three-step upload/voice/listen guide, curated
voice cards and a voice preview action. It retains the local library, sentence
review, English/Spanish and light/dark controls required by this project.
No reference branding, copy, images or application implementation was copied.
This is an adaptation of the visual direction and workflow, not a claim of
pixel-identical reproduction of inaccessible post-upload screens.

Updated tokens: light paper #faf8f4, sheet #ffffff, ink #29241e, muted #6a6054,
accent #925400; dark paper #1a1714, sheet #2a2622, ink #fffbf5, muted #c4baad,
accent #fbbf24. Reading prose retains Georgia; controls/headings use local system
sans. Visible focus, reduced motion, narrow-screen stacking and keyboard radio
selection remain available. The chapter map starts collapsed to keep the immediate
listening action near the reader; uncertain source boundaries remain inspectable.


## Current refinement — 26 September 2026

Replaced amber with indigo/slate in both themes: light background #f5f6fb,
ink #20253b, muted #565f78, accent #5143a9; dark background #141827,
ink #f1f3fc, muted #b9c2dd, accent #b6b0ff. Book analysis now starts open:
evidence, uncertain classification and corrections are immediately discoverable.
Search results include neighbouring sentences and navigate to a focusable citation.
Removed cloning/model installation controls and irrelevant GPU selection from the
Edge-only website. No age claims are attached to voices without provider evidence.
Validated React interactions and production build; no new screenshot/visual audit
was performed for this refinement.
