# ADR-114: A duck opens where it is asked and keeps the hand's keys, long words set the pace, a filtered voice keeps its loudness

**Date:** 2026-10-20. **Status:** accepted. Amends [[ADR-104 Voice and sound an agent can trust without ears]] (how a duck is shaped and re-run, a band asked held exactly), [[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]] (the band a speed is chosen for) and [[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]] (how edges judge a join's step).

## Context

A second Claude Code session made a 46.5 s vertical short ("Field notes
from orbit") and its 16:9 cut through the MCP tools and reported 24
problems. Six were about ducking and the voice. Each was reproduced
through MCP on the web build with the tester's own script (twelve lines,
Heart and Michael), arguments and song (the 120 BPM promo score, file
16-24 s cut out, its grid from the cue sheet). The voice reads the same
input the same way, so every line landed where the tester's did:

- **2. The duck held the music down through both drops.**
  `duck_under_speech {track_id, voice_above_music_lu: 12, min_line_lu: 10}`
  bridged every pause under 1.1 s (attack 0.1 + release 0.4 + hold 0.6),
  and the pauses holding the drops at 8 s and 28 s were 0.97 and 1.07 s:
  one dip from 0.13 to 44 s, the drops 15 dB down, and no word of it. It
  also left the music at full level for 0.1 s before the first line (a
  key at 0.033 s, the line at 0.133), and, measuring further, at the cut
  between the song's two pieces: each piece was planned alone, so the
  second started at full level at 16.0 s and dipped by 16.3 (a line ended
  at 15.6 in the first piece).
- **3. Ducking again wiped the keys made by hand.** The tester capped the
  drops' lift at 0.75 and lifted the music before the last hit, then
  could never re-duck: every volume key was replaced.
- **10. The pace chooser rushed long words.** "Honestly? Mostly water."
  (seven syllables in three words) landed on narration's 2.3-2.8 words a
  second at speed 1.29: 2.56 words, 6.0 syllables a second, which
  review_voiceover itself called rushed. Its fix, a retake with
  `words_per_second [1.9, 2.4]`, read speed 1.09: 2.36 words, 5.5
  syllables, still quick. Only `speed: 0.85` read it naturally.
- **11. read_as was refused on a line.** `add_voiceover` took read_as for
  the call only ("not a known argument"), though retake_voiceover takes it.
- **13. A band-passed voice lost 3-3.6 LU.** A radio band-pass on mission
  control's three lines (`set_audio_filter` highpass 380 and lowpass 3400,
  resonance 3) measured -20.2, -19.9 and -20.6 LUFS against -16.6 to -17.4
  for the rest; review_voiceover flagged all three as quieter.
- **21. A bar cut from the outro stepped 6.9 dB, called clean.** Cutting
  file 50-52 s (`cut_music`) joined at 42 s with `step_db` 6.9 and the
  verdict clean, and nothing said why.

## Decision

### 1. One plan over the bed: pauses held by rule, moments opened by ask

`duckPlan` (lib/analysis/duck.ts) plans the music's level over a whole
music bed, every piece of a track together, then gives each clip its part
(`clipKeys`): a cut between pieces is no edge, so the second piece starts
at the level the plan has there.

- A pause shorter than `min_gap` (default 1.1 s, what the old hold
  bridged) stays down: between lines, and between the bed's start and the
  first line or the last line and its end, so there is no blip before a
  first line. A longer pause comes back up over `release` (default 0.4 s)
  and dips again 0.1 s before the next line.
- `open_at` brings the music up on chosen moments whatever their pause:
  timeline seconds, or marker labels (`"Drop"`: every marker so labeled,
  as analyze_music and set_music_grid mark a song). The music is at its
  level by the moment and dips after it; never into a line (a frame after
  the line before, a frame before the next). A moment inside a line stays
  down, and the answer says so; a label no marker has is refused with the
  labels there are.
- The answer lists the pauses held (`held`, seconds), each moment asked
  (`open`: `up` around it, or `inside_line`), and a note when a Drop
  marker sits in a held pause, with the call that opens it. Defaults stay
  as they were: open_at is asked, not assumed, since a line may be meant
  to ride over a drop.

Measured on the tester's project: before, keys `[0.033, 1], [0.133,
0.266]` and `[16.2, 1], [16.3, 0.176]`; now `[0, 0.266]` and `[16, 0.176]`,
one dip, `held` naming the eleven pauses with 7.37-8.33 and 27.23-28.3
among them, and the note "the Drop at 8 s and the Drop at 28 s fall in
them and play ducked: open_at ["Drop"] brings the music up there". With
open_at ["Drop"]: the music is up 7.77-8.23 and 27.63-28.2 s, three dips,
and the balance as before (11.7 LU in the speech window, lines 10.3-14.7,
met).

### 2. A duck replaces its own keys and keeps the hand's

Each ducked clip keeps the keys the duck wrote (`DuckRecord.written`:
each key's place in the clip's file, ms, which a move, split or trim keeps,
and its value). Ducking again, `mergeKeys` replaces those and keeps every
other key (added, or changed by hand) wherever no line speaks: in a pause
that holds one, the hand's keys stand in for the duck's there, and the
duck's level is held at the lines on either side, so the hand's level
never ramps under a voice (the tester's complaint 17). A hand key on a
line's first or last frame moves a frame into the pause beside it; one
inside a line is replaced, since the duck sets the level a voice is heard
over. `hand_keys` lists both. A duck from before this kept no keys, so
all its keys are its own, as before; music never ducked keeps its keys
outside the lines.

Measured: the tester's caps (0.75 at 7.77, 8.23, 27.63 and 28.2 s) and the
lift before the last hit (0.55 on the line's last frame, 40.067 s) survive
a second duck, the lift at 40.1 s; the hold key under the line (39.93 s)
is replaced and named. A retake still leaves music with hand-edited keys
alone (its note now says ducking again keeps them).

### 3. A band never rushes long words

A band in words a second cannot see how long the words are.
`syllableBand` (lib/voicePace.ts) moves a band down, keeping its width,
until its top says the line's words no faster than 5 syllables a second
(`CHOSEN_MAX_SPS`; read speech runs 4-5.5 inside a phrase, and review
calls 5.8 rushed). Every chosen speed lands on it, a band asked moving too
(naturalness first; a speed given still reads faster), and the answer's
`pace_note` says so. review_voiceover holds a line to the same band (its
syllables to its words as read), and a line over it read at a speed chosen
before this gets a retake, not "the voice's limit".

Measured, Heart: "Honestly? Mostly water." reads [1.64, 2.14] words a
second instead of [2.3, 2.8]: speed 0.96, 2.08 words and 4.85 syllables a
second (was 1.29, 2.56, 6.0); the tester's retake with [1.9, 2.4] lands the
same (was 1.09, 2.36, 5.5). The other eleven lines read at the speeds they
did.

### 4. read_as per line

`add_voiceover` lines take `read_as`; a line's kind wins over the call's
words a second, its own words a second over its kind. Measured: mission
control's two radio calls as `read_as: "social"` landed at 2.9 and 3.03
words a second in [2.8, 3.4], as the tester's per-line words_per_second
workaround did.

### 5. A filter can keep a voice's loudness

A filter takes loudness with what it cuts. `AudioFilter.makeup` (dB, -24
to 24) is a gain after the filter, played everywhere the filter is (one
render path, engine/soundFx.ts), shown in the inspector as Makeup.
`set_audio_filter keep_loudness: true` measures each clip alone as it
plays (compressor, volume and room in) before and with the filter and sets
the difference as its makeup, as one undo step (state/ai.ts
`keepFilterLoudness`). It measures, so it runs on its own: in a batch it
is refused, naming makeup as the way to give the gain. A fixed filter
only: a sweep changes the loss as it moves. Filtering a voice line (a
dialog track, or speech the app read) without either answers a note.

Measured on the tester's lines: highpass 380 took 2.5, 1.8 and 2.3 LU,
lowpass 3400 then 0.6, 1.5 and 1.1; kept, the three lines measure -17.1,
-16.6 and -17.2 LUFS among lines at -16.6 to -17.4, and review_voiceover
flags none (it flagged all three, 2.9-3.6 LU quieter).

### 6. A step the music makes itself says so; one in a ring-out it does not is flagged

Not a fault in the sound: the outro rings out with a new chord on each
bar (the file at 50.0 s goes from -29.7 to -20.7 dB within 100 ms, at
52.0 s from -32.6 to -22.0), so the join onto bar 27 steps up as the music
does on every bar: uncut, the file steps 5.9 dB on the bar the cut took
out, and the join 6.9. `edges` now says that in `step_note` when a clean
join steps 6 dB or more ("the music steps 5.9 dB there itself (a new bar
or hit), so the join keeps its shape"). And a join inside a ring-out (the
sound fell 6 dB or more over the second before the cut) that steps 6 dB
or more off what both files do there (the outgoing file uncut, the
incoming one at its in-point) is flagged, at half a plain join's 12 dB,
with a longer crossfade (0.25 s) as the fix: a smooth tail cut onto a
louder part.

## Consequences

- A whole-track duck's keys can differ at piece boundaries from before
  (no swell at a cut); single clips duck as they did, but for the music
  no longer coming up for under min_gap before a first line or after a
  last one.
- Ducking again no longer wipes volume automation outside the lines;
  automation made by hand under a line is still replaced (and named).
- Lines of long words read slower than before: any line whose words
  average over 1.8 syllables (narration's top, 2.8, at 5 a second). Lines
  of ordinary words read at the same speeds.
- Clips filtered with keep_loudness carry a makeup gain an older build
  drops on load: the line plays quieter there.
- The unit tests are `duck` (plan, held pauses, open moments, the bed's
  cut, the merge), `voicePace` (the moved band, the tester's line landed
  with a model of the voice), `voiceReview` and `edges` (the ring-out).

## Not done

- open_at does not default to a song's Drop markers: a line can be meant
  to ride over a drop. The note names the call.
- keep_loudness is not offered for a sweep, and a filter's makeup is not
  measured again when its cutoff later changes by hand (it is shown).
- A retake leaves music whose keys were edited by hand alone, as before;
  ducking again by hand keeps them now.
- ponytail: a key's place in its file is read at the clip's plain speed,
  so on a speed-curved or reversed music clip a duck's own keys may read
  as the hand's after an edit, and survive in a pause.
