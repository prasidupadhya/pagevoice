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
