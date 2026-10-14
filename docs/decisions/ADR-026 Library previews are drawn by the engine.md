# ADR-026: Library previews are drawn by the engine

- **Date**: 2026-10-14 · **Status**: accepted

## Context

The Filters, Effects, Transitions and Text cards showed CSS stand-ins: a
`filter:` chain guessing at each look, a sparkle icon for every effect,
two gradients sliding for every transition. They could not match what the
shaders do, and a card that promises a look the editor does not make is
worse than no preview. CapCut's cards show the real result on a sample
image and play a loop on hover ([[CapCut desktop]] §1.4, §8.5).

## Decision

- **The real pipeline, offscreen.** `src/engine/previews.ts` builds a tiny
  project per card — the sample shot with the card's filter, effect or
  transition, or the text clips a preset adds — and draws it with
  `planFrame` and a `Compositor` on one `OffscreenCanvas` (one extra
  WebGL2 context for all cards). Text uses the viewer's rasterizer and is
  cropped to its ink so small titles stay legible.
- **What it is applied to.** A generated landscape (sky, sun, water, a red
  cabin, dark pines: something for every look to bite), cutting to a
  night skyline for transitions. With one video or image clip selected,
  that clip's bare frame under the playhead replaces it, so the cards
  answer "what would this do to my shot".
- **Never stall the UI.** Cards ask only while on screen; jobs run one at
  a time with a macrotask between them, a job whose card scrolled away
  is dropped, hover jobs jump the queue. Results are cached as small JPEG
  blob URLs per card and scene.
- **Motion on hover.** Effects, transitions and text render a 16-21 frame
  sprite strip on first hover; CSS steps through it, so playback costs
  nothing and `prefers-reduced-motion` keeps the still.

## Consequences

Previews cannot drift from the renderer; they found wipes running
backwards on their first run. Adding a catalog entry needs no preview
work. `ponytail:` the cache is a 320-entry FIFO; scrubbing with a clip
selected re-renders visible cards (debounced 250 ms), fine at 20 cards.
