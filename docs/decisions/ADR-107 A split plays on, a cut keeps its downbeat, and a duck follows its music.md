# ADR-107: A split plays on, a cut keeps its downbeat, and a duck follows its music

**Date:** 2026-10-20. **Status:** accepted. Amends [[ADR-104 Voice and sound an agent can trust without ears]] (cut_music's frames, preview_audio's edges, how a duck is kept and aimed) and the mixer's click guard.

## Context

The sound fixes of [[ADR-100 A compound clip's sound is a bus, and a bed keeps its balance in every take]]
and ADR-104 were attacked through MCP, as a model calls them, on a 128
BPM song (AAC), the MP3, speech and interview fixtures, measuring every
answer and, where a number was in doubt, the rendered samples against
ffmpeg's decode of the file. What broke:

- **Every split ticked.** A split of a sounding clip (the same file going
  on at the same speed) ramped each half to nothing over the mixer's 4 ms
  click guard: a song split on its drop measured an 18.4 dB hole there,
  `edges` called it a tick and named `set_crossfade` the fix, which refuses
  a split ("no splice to crossfade"). An agent following the answer looped,
  and any split of an interview or a song (a punch-in, a volume change)
  played the tick.
- **cut_music played the next downbeat as it fell.** The cut was rounded
  to the nearer frame. A bar line nearer the frame after it (3.754 s is
  frame 112.6) ended the first piece 13 ms into the next downbeat, falling
  under the crossfade, and started the second piece 13 ms into its own
  (in 9.392 s for the bar at 9.379): the attack ADR-104's crossfade ends on
  the cut to keep was lost. A cut at the song's head started it 13 ms
  after its bar line.
- **A clean join read as a click and a jump.** A cut from a quiet bar onto
  a downbeat plays the kick's first sample step, steeper than anything in
  the quiet bar or the kick's own body: 7.7 dB, "a click", with
  `set_crossfade 0.03` as the fix, on a join that had exactly that. Every
  cut placed before a downbeat also read "the level jumps up 15 dB": the
  300 ms after it hold the hit, those before it the bar's end. `faded` was
  the clip's `crossfade` field, not the crossfade the mixer plays (none
  when the next clip was retimed or slipped).
- **Ducked music lost its dips silently.** Bars cut out of a ducked song
  (or the song moved) carried the piece's dips with it: the music dipped
  at 11.4-19.2 s while the voice spoke at 16-26.7 s, loud under four
  lines, and no answer said so (`staleDucks` watched only the voice). The
  duck's key signature was taken from the clip's start, so a split or a
  head trim (keys shifted, nothing edited) read as keys edited by hand and
  a retake would not dip that music again.
- **The ceiling missed the speech target.** ADR-104's 15 LU ceiling held
  the line over a quiet intro at 14.7 LU by dipping it less, which lifted
  the lines together to 12.9 LU: the playbook's own call
  (`voice_above_music_lu 12, min_line_lu 10`) answered `met: false`,
  though every line could sit 10-15 and the lines 12. A ceiling under the
  speech target (`max_line_lu 8` with 12), which no dip can meet, was
  measured four times over and answered `met: false`.
- **An interview in a compound clip was no voice.** `duck_under_speech`
  found the clips under the music on the top-level tracks only, so a talking
  head kept in a compound clip (the playbook's template, ADR-100's bus)
  answered "No other clip with sound plays under it".

What held: `set_crossfade` and `cut_music` refuse what they should (no
grid, a reversed range, retimed or non-adjacent clips, a next clip with no
file before its in-point), cut at the head, at the end and off the grid
(snap none), and undo and redo as one step; a cut shorter than half a bar
takes the whole bar its ends snap to, as documented. Every bed at 0.5, 1,
1.5 and 2 s over three seeds sits on its loudness within 0.1 LU with its
peaks under -1 dBFS and no silent 100 ms (under 1 s a bed is made 1 s
long). An AAC song from in-point 0 decodes as ffmpeg does (correlation
1.000, lag 0), its priming packet unread. Nested compound buses each act
(an inner EQ's -12 dB shelf took the low share from 0.24 to 0.057; an outer
strong compressor the seconds' spread from 5.4 to 1.8 dB). Two voice tracks
duck one music track as one set of lines. A line's pause marks at its ends
become silence before and after it and stay out of its pace; a line of
marks alone is refused. A fade-in, a start on a bar and a clip ending at
its file's end measure clean.

## Decision

### 1. A split plays on

`continues(a, b)`: the next clip on the track plays the same file on from
where this one stops, both at their own speed (nothing retimed, frozen,
muted or disabled), with no fade or video transition at the cut. There
the mixer drops the click guard: the first clip's end moves to the second
clip's level over the guard's 4 ms (`joinsNext`; the same level when the
halves' volumes match) instead of to silence, and the second clip starts
at its level (`joinsPrev`). Measured: the song's split from -18.4 dB to
-1.1, clean; the render equals the unsplit clip but for one sample's
interpolation. A split's left half no longer keeps a `crossfade`: it
belongs to the clip's end, as a transition and a tape stop do.

### 2. A cut stops before its bar line

`cut_music` ends the first piece on the frame at or before the bar line
and starts the piece after the same distance before its own downbeat
(whole bars later in the file, as before), so both downbeats play whole; a
cut at the head starts the song on its bar line. Measured: the join at
3.733 s, the second piece from 9.358 s, both 21 ms before their bars.

### 3. A join is judged against the files it plays

`preview_audio` decodes the incoming clip's file at its in-point, as it is:
its steepest sample step there (`ownOnset`) and its own step in level
(`cameIn`). A step no steeper than the file's own attack is no click; a
level that moves no more than the file's own is not told. Measured: the
clean join's click from 7.7 to 3.3 dB, its jump gone; a cut onto a drop
after an intro still says the level jumps, "more than the music does
there". `faded` is the crossfade played (`audioCrossfade`).

### 4. A duck follows its music

A duck keeps the shape of the keys it wrote (each key's value and where it
sits from the first: a move, split or trim keeps it, a hand edit does not)
and where its first key sat on the timeline (`DuckRecord.at`).
`staleDucks` also finds music an edit moved, its dips with it (`moved`):
`cut_music` and `move_clip` on ducked music answer the call that dips it
again, and a retake dips it again with the rest.

### 5. The lines stay on their target under the ceiling

Each pass of `duck_under_speech`'s per-line fit first moves every line's
dip by what the speech window is off the target, then holds each line
between its minimum and its ceiling (`aimDepths`). Measured on the same
call: the speech window 12.0, lines 10.7-13.8, met. A ceiling under the
speech target is refused before anything renders (`duckTargetsError`).

### 6. Voices are found as the mixer hears them

`voicesUnder` (lib/analysis/duck.ts) takes the sounding clips through
compound clips, each where its compound clip plays it; a measured duck
renders the voice through its top-level clip. The interview in a compound
clip now ducks as it did on the main track (4 dips; measured, met at
11.9 LU).

## Consequences

- A split's sound is continuous in preview, export and every measurement;
  splits made before play differently (better) from now on.
- Ducks written before keep a signature from their clip's start: their
  keys read as edited by hand until ducked again (a note says so).
- `preview_audio` decodes 70 ms of each incoming clip's file more per join.
- `sound-joins.js` holds sections 1-6 in the running web build; the unit
  tests are in `audio`, `musicCut`, `edges`, `duck` and `balance`.

## Not done

- ponytail: the second half of a split clip with a compressor starts its
  compressor with no gain reduction (the first half's delay tail fills its
  6 ms lookahead): 24-40 dB under the signal for about 10 ms. Sharing one
  chain across a split is the upgrade if it is ever heard.
- An MP3 plays 23.02 ms (LAME's 1105-sample encoder delay) later than a
  gapless decoder (ffmpeg) plays it: mediabunny presents the delay. The
  app's analyses read the same timeline, so its own grids agree; a grid
  from a cue sheet sits 23 ms early in the file, which section 2 keeps
  before the downbeat. Trimming it means reading the LAME header.
- A bed past 300 s still repeats its file under the click guard
  (`placeBed`'s ponytail), and `set_crossfade` cannot join the repeats
  (the next starts at its file's 0 s).
- A compound clip is never on a dialog track, so when dialog tracks exist
  a measured duck hears only them, as with a top-level interview.
