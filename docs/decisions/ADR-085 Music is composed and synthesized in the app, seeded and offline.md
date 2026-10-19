# ADR-085: Music is composed and synthesized in the app, seeded and offline

**Date:** 2026-10-19. **Status:** accepted.

## Context

The launch film ([[Launch film through MCP 2026-10-18]]) was edited
entirely through MCP, but its music was synthesized in Python outside the
editor: an agent cannot finish a film without leaving the app. The third
improvements round wants an agent to make an advanced video, score
included, through the tools, and wants the score to sound made, not like
a toy. Everything runs on the user's hardware (ADR-003), the app is
GPL-3.0-only, and there is no sample library we may ship.

Three ways to make the sound were weighed:

- **Web Audio's OfflineAudioContext** (oscillators, BiquadFilter,
  ConvolverNode, DynamicsCompressor). Fast, but its nodes are specified
  loosely enough that renders differ between Chromium (WebView2) and
  WebKit (macOS, Linux), so "the same seed gives the same music" could not
  be promised across the desktop's webviews, and it does not run in Node,
  where the tests are.
- **Samples or soundfonts.** The usual way to real instruments, but we
  have none we may ship under GPL-3.0-only, and downloading them would
  break the local-first rule for a core feature.
- **Plain TypeScript synthesis** over Float32Arrays: the same code in a
  worker, in a test and in any webview, sample for sample.

## Decision

- **Synthesize everything in TypeScript** (`src/lib/music/`), in a
  worker (`src/engine/music.worker.ts`), no samples, no dependency:
  PolyBLEP saws and squares through state-variable filters (supersaws,
  strings, brass, choir formants, plucks, leads), FM (a Rhodes, glass
  bells), additive partials (piano, glockenspiel), Karplus-Strong (the
  corporate guitar), and the drum machine's recipes (pitched-sine kicks
  and toms, band-passed noise snares and claps, the 808's six-square
  hats). Every voice starts and ends on a ramp.
- **Compose, then play.** `arrange.ts` turns a request into a plan: the
  form in bars, chords voice-led bar by bar from each style's progressions
  (major-scale numerals with explicit flats, so i-bVI-bIII-bVII means the
  same in any key), a four-bar hook (a motif and its answer, chord tones on
  the beat, the best of eight candidate contours), and every hit and note
  as an event with swing and seeded human timing. `render.ts` plays the
  events. The plan is data, so the tests read the music (the hook repeats,
  the bass sits on the kick, fills land before changes) without listening.
- **Four stems that add up to the mix.** Drums (with risers and hits),
  bass, harmony and lead are rendered apart, each with its EQ, its
  reverb send (convolution with the impulse `soundFx.ts` already makes for
  the clip reverb, run at half rate since the send stops at 9 kHz) and its
  sidechain pump. The master's gains (a 2:1 glue compressor, the gain to
  the loudness target, a true-peak limiter at -1 dBTP, the export
  limiter's `limiterGains`) are worked out on the sum and applied to each
  stem alike, so the stems still add up to the mix exactly, as the launch
  film's track was delivered.
- **The balance is measured, not guessed.** After rendering, each stem's
  loudness in the drops is set to the style's levels (in LU against the
  loudest stem). The first renders had the chords 13 LU under the drums;
  measured, every key, seed and voicing comes out balanced.
- **Seeded and deterministic.** The song seed picks the progression, the
  hook and the arp; each section has its own seed for its drums and fills,
  so one section can be regenerated (`sections[i].seed`) and the others
  keep every note. 16-bit WAV with triangular dither (silence stays
  digital silence).
- **An app tool, not a command.** `generate_music` imports files, so it is
  an MCP tool beside `add_sound_effect` and cannot go in `batch`;
  `plan_music` answers the same cue sheet without rendering (read-only).
  The Audio tab's Generate music card calls the same code.

## Consequences

- About 5 s to render a minute of music in Node on this machine, 9-14 s
  in the web build with the stems written and imported; a preview takes
  most of that. Memory peaks near 60 bytes a sample (stems,
  sends, the mix, the files): about 170 MB for a minute with stems; the
  length is capped at ten minutes.
- Synthesized instruments have a ceiling: the strings and choir are
  convincing pads, not solo instruments. Nothing was listened to: every
  judgment is a measurement (loudness, true peak, spectrum, crest factor,
  correlation, analyze_music's reading), recorded in
  [[Music generation 2026-10-19]].
- Determinism holds per JavaScript engine: Math.sin and friends may round
  differently elsewhere, so two engines can differ in the last bits.
