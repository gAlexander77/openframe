# ADR-096: A voice's pace, a song's grid and a mix's balance are measured where they apply

**Date:** 2026-10-19. **Status:** accepted; a line's pace leaves its pause marks out, a band asked is held over its pace, and ducking holds lines under a ceiling, by [[ADR-104 Voice and sound an agent can trust without ears]].

## Context

Codex made a 72-second documentary through MCP alone and reported every
limit it hit (the fourth improvements round's lane C, D and E, and limit
15 of [[Launch film through MCP 2026-10-18]]). Four of them had one root:
a number measured over the wrong stretch, or a rule stated in the wrong
unit.

- **Pace.** The owner's rule for a natural narrator is 2.3-2.8 words a
  second. `review_voiceover` judged pace in syllables (flagging under 3.2),
  so seven of Codex's eleven lines, read at 2.33-2.76 words a second, were
  called slow; and help's narrator speed 0.9 read the same lines at
  3.7-4.2 words a second. Codex retook ten lines by hand at speeds
  0.61-0.90.
- **Emphasis.** A read could not be directed to stress a word ("I never
  said *she*...").
- **Music.** `analyze_music` read only the clip's own stretch of the file.
  On source 0-32 s of the 120 BPM promo score it put the downbeats on odd
  seconds and the drop at 7 (the whole file reads 8 and 36 correctly).
- **Balance.** "11 LU over the music" meant three things: the duck target
  over the stretches of speech (met at 11), each line alone (9.6-18.8) and
  the whole track (5.9, the music swelling between lines). Answers did not
  say which, and `measure_loudness` by_track printed every second of every
  track.

## Decision

### Pace is words a second over a line's speech, landed by measuring

`src/lib/voicePace.ts` (tested) holds the bands, the measures and the
verdict. A line's pace is its words a second **over its speech**, from
its first word to its last with its own pauses in, the window the owner's
rule and Codex's measurements use. It is reported over the clip too, and
the script's pace across lines (gaps in) stays a separate, unjudged
figure.

- Bands by kind: `read_as` narration 2.3-2.8 (the default), ad 2.6-3.1,
  social 2.8-3.4, or `words_per_second` [lowest, highest]; `pace` slow or
  fast moves a line's band half a word a second.
- With no speed given, `add_voiceover`, `retake_voiceover` and text to
  speech choose each line's speed: a first guess from its syllables
  (Heart says about 4.6 a second at speed 1), then the read is measured
  after the natural finish has set its pauses, and read again at speed x
  voiced / wanted, where the pauses the finish set to a length are taken
  out of both (they do not scale with speed). Up to three reads, speeds
  0.6-1.3 (Codex's accepted reads went as low as 0.61), the read nearest
  the band kept. The audio is never time-stretched: the voice model
  itself reads slower, so its intonation and phrasing stay its own. A
  speed given is kept as given.
- The verdict separates failure from advice: a line more than a tenth of
  its band's edge outside the band fails (a fix: `retake_voiceover` with
  `words_per_second`); within that tenth it passes with advice; a line
  whose speed was already chosen and still misses is at the voice's limit
  and gets advice (a pause at a phrase boundary, or `pace`), not a retake
  that would read the same. Syllables a second only catch long words
  rushed (over 5.8 at on-target words) and note short words drawn out
  (under 2.5).
- The old rushed-line rule (re-read over 5.5 syllables a second) and the
  fixed default speed 0.95 are gone; the inspector's Text to speech offers
  a pace (Slow, Normal, Fast) instead of a speed.
- Measured (the `voice-pace` drive): four of Codex's lines voiced with no
  speed chose 0.60-0.78 and landed at 2.46-2.74 words a second, three of
  them in one read, every review verdict ok; Codex had picked 0.61-0.75 for
  them by hand. The figures are in [[Natural voiceover 2026-10-19]].

### Emphasis cannot be directed, measured; the stars are dropped with a note

Kokoro reads phonemes from espeak-ng (kokoro-js), and its only prosody
inputs are those phonemes with their stress marks, punctuation, a style
vector and one speed for the whole input. Its author's own G2P (misaki)
offers emphasis one way, by raising a word's stress, noting it only
changes "less stressed, usually short words". That was built and measured
before deciding: `*word*` reached the worker as `{word}`, which the
phonemizer passes through as punctuation, so the word was phonemized on
its own (with its citation stress) and every word inside got primary
stress before the tokenizer. Heard back with Whisper's word times (widened
80 ms each side), against the same sentence plain, Heart at speed 0.85:

| Ten short words (she, or, is, your, any, him, can, were, one, all) | Length | Peak pitch | Peak level |
|---|---|---|---|
| Stress raised (`*word*`) | +0.012 s (5 longer, 1 shorter) | -0.08 st (5 up, 5 down) | -0.37 dB (3 up, 7 down) |
| The word in quotes | +0.054 s (7 longer, 1 shorter) | -0.48 st (3 up, 7 down) | +0.04 dB (4 up, 6 down) |

A first run on seven words with Heart and Michael agreed: pitch moved up
to 5 semitones either way, level within 2 dB, length 0 to +0.06 s. An
emphasized word in speech is higher, louder and longer (a few semitones,
a few dB, a third longer); neither mark does that, so neither is offered.
Whisper heard every variant word for word, so the marks did no harm
either. `*word*` stars are dropped from the voice and the caption and the
answer's `notes` says why and what works instead: the word last in its
phrase (where English puts the main stress, and where Kokoro lengthens the
words before a pause, measured in [[Natural voiceover 2026-10-19]]) or a
`[pause 0.2]` before it.

### A song is read whole, once, and placed through each clip

`analyze_music` decodes the whole music file (files over ten minutes: the
clip's stretch and a minute either side), keeps the reading by asset and
hints (eight readings), and maps beats, bars, phrases, sections and drops
into each clip through its in-point, speed or speed curve, reversal and
position (`src/lib/analysis/musicMap.ts`, tested), cutting sections at the
clip's edges; `drop` is the biggest drop the clip plays. The same promo cut
as Codex cut it (0-32 at 0, 8-24 at 32, 32-56 at 48) now reads bars on
even seconds everywhere and drops at 8, 32 (the drop section's restart)
and 52, with the breakdown at 48-52 and the outro at 64.

Hints replace detection, in the file's own seconds: `bpm` (beats tracked
at it), `first_downbeat` (sets the bar phase; with bpm, the whole grid)
and `cues` ([{at, label}], each part to the next, a drop cue after another
part a drop). `confidence` reports tempo (the share of beats on an onset),
bars (how far the winning phase leads, 0 when nothing told them apart) and
sections (how clearly each boundary changes), with a note naming the hint
to give when one is low. On the promo the bar phase is right but weakly
supported (0.17: the runner-up phase had most of the winner's votes),
which is exactly why its 32-second excerpt flipped.

### A balance names its window; ducking can hold every line to a minimum

Three windows, named in every answer (`BALANCE_WINDOWS`,
`src/lib/analysis/balance.ts`): **program** (the whole stretch, the
music between lines in), **speech** (while the voice speaks: each line from
its first word to its last, together) and **line** (each line alone).

- `measure_loudness` by_track reports all three (per-line as the lowest,
  median and highest margin and where the lowest is), each track's
  integrated, loudest three seconds and LRA; the per-second arrays only
  with `per_second: true`.
- `duck_under_speech` renders each stem once over the lines and measures
  every window from the 100 ms loudness steps (`windowLoudness`), instead
  of one render per window. `voice_above_music_lu` aims the speech window;
  the new `min_line_lu` holds every line to a minimum: each line's dip is
  deepened by what it lacks and measured again (up to four passes), the
  speech target's (or `depth`'s) dip the least. `duckKeys` takes a depth per
  line; lines close enough to share a dip stay down between them, the level
  moving in the pause.
- `review_voiceover` measures each line from its first word to its last
  (it used the clip's edges, lead-in and tail included), names the window
  in its summary, and its fix for a thin margin is `min_line_lu` with the
  music's present dip as the least.
- `measure_loudness` judges the mix's loudness range for its `kind` (film
  5-15 LU, ad 3-8, social 3-10, podcast 3-8, any 3-15: rules of thumb from
  EBU Tech 3343's guidance and broadcast practice; R128 sets no LRA limit).
  Codex's film measured 2.0 LU: very flat for a film.

## Consequences

- A voiceover made with no speed lands every line on a natural narrator's
  pace by measurement, and the review agrees with what was asked; Codex's
  lines would pass as read.
- `review_voiceover`'s lines report `pace` as an object, and fixes name
  `words_per_second`; `measure_loudness` by_track's `balance` has the three
  windows instead of one unnamed number. Drives and docs follow.
- Emphasis is honest about its limit: the guide and every answer that
  meets a `*word*` say it cannot be voiced, and what to write instead.
- A reading is kept per music file for the session, so a second clip of
  the same score costs nothing.

## Not done

- Per-word emphasis, speed or pitch: Kokoro's ONNX model takes one speed
  for the whole input and no emphasis input; a model with prosody control
  (or a per-token duration input) is the upgrade.
- Listening tests: naturalness is measured by proxies (words a second,
  pitch range, pauses), not by people.
