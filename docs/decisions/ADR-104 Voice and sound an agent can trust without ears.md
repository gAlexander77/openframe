# ADR-104: Voice and sound an agent can trust without ears

**Date:** 2026-10-20. **Status:** accepted. Amends how [[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]] measures a line's pace and holds a line's margin over its music.

## Context

A Claude Code session made a 38-second ad through the MCP tools and
reported 22 limits. Six were about voice and sound it had to take on
trust, since it cannot listen. Each was reproduced through MCP with the
tester's own lines and arguments, on the 120 BPM promo score (cut at
source 14-30 s, as the tester cut it) and Kokoro's Heart voice:

- **3.7 A band asked was moved by the pace.** The end-card line
  ("Northbound. [pause 0.4] Find your north.", `pace: slow`, read as an
  ad) retaken with `words_per_second: [1.8, 2.2]` was held to
  [1.3, 1.7]: read at 1.37 words a second, speed 0.65, a 3.17 s drawl.
  The pace shift applied to every band, asked or not, and `read_as`
  was stored as if it were a band asked.
- **3.8 A slow line was read at speed 1.3.** The same line's pace window
  counted its 0.4 s pause mark, so its four words had to fit 1.7 s with
  the pause in; the first speed guess also counted the pause twice (as a
  mark and as the sentence's own pause). Read at 1.3: 2.55 words a
  second "on target".
- **3.9 A retake left the duck behind.** The retake grew the line from
  34.32 to 35.67 s; the music's dip still ended at 34.3, so the music
  rose under its last words.
- **3.10 An extra word passed unchecked.** "You wake up where the water
  meets the light." for "Wake up...": a lone short extra word counted as
  a minor slip, so it was never heard again, and `match` stayed 1 (it
  counted only the script's words).
- **3.14 Ducking was per clip and emptied quiet passages.** The song cut
  in two needed two calls; one depth for the speech target left lines
  16.7 and 15.1 LU over the quiet intro and 19.0 over the last hit.
- **3.15 A splice could not be checked.** `preview_audio` answers each
  second's loudness. The butt splice at 14 s played each side's 4 ms
  click guard into the other: an 8 ms hole of -16.8 dB (2 ms of the
  sound's slope against its sides) in the middle of a bar's last beat.

Measuring the splice found a bug under it: decoding started cold at the
packet holding the first sample, and an MP3 frame leans on the one
before (its bit reservoir), so that frame came out as silence. Every
10 s render window (export, `preview_audio`, every measurement) began
with 12-22 ms of silence on an MP3 song, and a clip starting mid-file
with 26 ms.

## Decision

### 1. A band asked is held as asked

`targetBand` returns a `words_per_second` band exactly; only a kind's
band (`read_as` narration, ad, social) moves for `pace`. A take keeps its
kind (`SpeechInfo.readAs`) apart from a band asked (`wps`); takes saved
before kept a kind's band in `wps`, and `bandSource` reads a band equal
to a kind's as that kind, so its pace still moves it. A retake's band
asked wins over the line's kept pace; a kind asked replaces its kept
band. Review's fixes name the line's own band, its pace in it.

### 2. Pause marks are out of the pace; a slow line is read no faster than 1

A line's words a second is measured over its speech with its pause
marks' seconds taken out (`readWps`): a `[pause]` is the script's beat,
not the reader's pace, so adding one never makes the words faster. The
reader's own pauses at commas and sentence ends stay in, so the bands
of ADR-096 (2.3-2.8 for a narrator) mean what they meant for lines
without marks. The first guess no longer counts a mark twice. A line
meant slow whose band is its pace's is read at speed 0.6-1, never faster
than the voice's own pace; a band asked lifts that. The read-and-measure
loop is `landSpeed` (pure, tested with a model of the voice). Review
measures the same window and says so (`pause_marks_out`).

Measured, Heart: the slow tagline now reads at speed 0.94, 2.60 words a
second over its words (2.18 s); retaken with [1.8, 2.2] it reads at
0.80, 2.16 (2.55 s, the 0.45 s mark in). Lines with no mark land as they
did (the six-line ad read at the same speeds).

### 3. A word heard that is not in the script is heard twice

An extra word is never a minor slip: it is a sound the voice made or
the recognizer's guess at a breath, and Whisper small hears the line
again. `match` counts it (`matchShare`: matched words over those and
every word either side of each difference), so it is under 1 whenever a
difference is listed; a minor slip says `minor`. An extra word the
second hearing confirms gets a slightly faster read: the "you" was the
glide into "Wake" drawn out at speed 0.6. Measured: Whisper small heard
"you" too (likely voice, match 0.89); the suggested retake (speed 0.65)
was heard clean, match 1, as the tester's own retake was.

### 4. A track ducks as one bed, under a ceiling

`duck_under_speech` takes `track_id`: every clip with sound on the track
is one bed, each keyed over its own span, a line across a cut dipping on
both sides (`trackDuckKeys`). `max_line_lu` is the most a line sits over
the music: a line past it dips less, down to no dip, the music never
raised (`lineDepths`). By default it is 15 LU, the top of a promo's
10-15, or 3 over the speech target or minimum when higher
(`lineCeiling`), whenever the call measures. A single clip of a track
that plays more answers a note naming `track_id`.

Measured, the tester's call per clip: lines 14.7, 14.7, 10.3 and 14.7,
10.3, 14.7 LU (were 16.7, 15.1, 10.3 and 15.2, 10.1, 19.0); with
`track_id`, one call, six lines 10.3-14.7, the speech window 12.1, met.

### 5. Music keeps how it was ducked, and dips again under a retake

Each ducked clip keeps the call's arguments and a signature of the keys
it wrote (`Sound.duck`). `staleDucks` compares an edit's voice lines
before and after: a line added, moved or resized under ducked music.
`retake_voiceover` dips that music again as it was asked, in the
retake's undo step (`ducking` in its answer); keys edited by hand since
are left alone and a note says so. Any other edit (`move_clip`,
`trim_clip`, a batch) and `add_voiceover` answer a note with the call
that dips it again: measuring takes renders, and commands are pure.
Measured: after the tester's retake the dip runs to 35.07 s under a line
ending at 35.05, and one undo restores both.

### 6. A song is cut on its bars, joined with a crossfade, and its joins measured

- `set_crossfade` (`AudioClip.crossfade`) crossfades an audio clip into
  the next one on its track at equal power over the seconds before the
  cut: the next clip rises from its file before its in-point, this one
  falls, so the downbeat after the cut plays clean (a crossfade centered
  on the cut would play the first piece's next downbeat too). The
  mixer's `soundOverlaps` plays it in preview, export and every
  measurement.
- `cut_music` takes bars out of a song: `from` and `to` in the file's
  seconds, each on the nearest bar line of its grid (`set_music_grid`;
  `snap` beat or none), the gap closed, the piece after playing on
  exactly whole bars later in the file whatever its frames round to,
  joined with a 30 ms crossfade (enough that nothing steps or dips,
  inside the last sixteenth before the downbeat).
- `preview_audio`'s `edges` measure every join of audio clips in the
  stretch, and any start or end that is not clean, on the rendered
  sound: `dip_db` (the quietest 2 ms of the sound's slope at the cut
  against the quieter side 6-12 ms away, never less than a tenth of the
  usual level around, so a hit dying away is not a hole and a silent
  stretch at the cut is), `click_db`, `step_db`, `tail_cut_db` (the
  file decoded past the cut against what follows) and `cut_in_db`, with
  a verdict and the fix. `dropouts` lists any 3-100 ms of silence inside
  sound anywhere in the stretch.
- Every decode starts 0.1 s early and drops what falls before
  (`DECODE_PREROLL`): no silence at render windows or mid-file starts.

Measured: the tester's splice, `dip_db` -16.8 (fix: `set_crossfade`
0.03); `cut_music` of the same bars, -1.8, clean; on the MP3 fixture the
butt cut measures -17.3 (the guard alone, its 26 ms of silence gone),
and a 24 s preview has no dropout at its windows (it had two).

## Consequences

- A line with pause marks measures faster than before, so a retake or
  a new read of it lands slower; agents that asked bands with marks in
  mind get a slower read. The tools' descriptions and the voiceover
  guide say the window.
- Every measuring duck now holds lines under 15 LU unless told: quiet
  passages keep more music than before.
- A retake can take a duck's measuring time (a few seconds) more.
- `voice-trust.js` holds sections 1-6 in the running web build; the
  unit tests are `voicePace`, `voiceReview`, `balance`, `duck`,
  `edges`, `audition` and `musicCut`.

## Not done

- ponytail: crossfades skip retimed clips (speed, curves, reverse,
  tape stop); the retimer's window would need to start early too.
- No inspector control for a crossfade yet; the timeline does not draw
  one. `edges` skips clips inside compound clips.
- A stale duck is dipped again only by a retake; other edits say so.
