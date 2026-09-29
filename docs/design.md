# Ink and Paper

## Design plan (before implementation)

The reader is the main workspace: a narrow bookshelf, an open manuscript and a
quiet narration desk. Preparation changes the actual manuscript from graphite to
ink. A warm bookmark follows the spoken sentence; twenty small ink marks show the
real contiguous buffer. Search and advanced controls fold away so listening stays
within reach. No decorative dashboard statistics or unrelated hero imagery.

Palette: paper `#f7f4ec`, sheet `#fffdf8`, ink `#243239`, graphite `#626760`, amber
`#855b20`. Night: paper `#101c24`, sheet `#192932`, ink `#eee9dc`, graphite
`#a8b3b4`, amber `#e7bd75`. Status colours are separate from the single action
accent. Readable graphite must still pass text contrast, even before narration.

Newsreader is the literary face for book titles and source text; Source Sans 3
is the humanist control face. Both are locally bundled Latin WOFF2 with Spanish
coverage, font-display swap, no font CDN. Reading measure at most 70ch, adjustable
18–26px. Controls are left aligned; quantities use tabular numerals.

Desktop: shelf | manuscript + sticky listening bar | collapsible narration desk.
Tablet: shelf | manuscript, desk below. Phone: compact horizontal shelf, manuscript,
thumb-reachable sticky player. Long sentence lists virtualize measured rows; source
jumps and keyboard navigation must reveal an offscreen row before focusing it.

Review against the brief: paper/serif/amber is explicitly requested, but a stock
beige card dashboard is not. Book-cover silhouettes and readiness in the text are
the distinguishing functional elements. Borders separate controls, not every
paragraph. Motion only acknowledges readiness, playback, user navigation/deletion.

## References opened

- [frontend-design skill](https://www.skills.sh/anthropics/skills/frontend-design),
  full [SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md):
  subject-specific typography/layout, deliberate design, critique before building.
- [Impeccable](https://impeccable.style/): simplify competing actions; label controls,
  check contrast, avoid identical nested cards and decorative status clutter.
- [Design with Intent](https://designwithintent.ai/): preserve autonomy, explicit
  consent, accessibility and measurable outcomes rather than manufactured urgency.
- [beUI](https://beui.dev/): keyboard-native selectors, restrained modal/toast/tab
  transitions and reduced-motion handling. Components here are original.
- [lucide-animated](https://lucide-animated.com/): state-related icon motion.
  Existing Lucide icons are retained with original small CSS transitions; no new
  animation framework is required.
- RareUI: both `https://www.rareui.com/` and `https://rareui.com/` returned an internal
  fetch error on 2026-09-29. No inaccessible guidance is claimed or guessed.

## Component rules

Use semantic buttons, native dialog focus trapping/restoration and labelled inputs.
Minimum 44px controls, visible focus, politely announced progress. A sentence's
readiness is expressed by text contrast plus a check/state label; never colour
alone. Consent remains visible and unchecked until the user grants it.

Motion lasts 150–250ms using opacity/transform; reduced motion disables it. Paper
grain is a tiny local SVG texture. No background sound or PWA is enabled by default.
