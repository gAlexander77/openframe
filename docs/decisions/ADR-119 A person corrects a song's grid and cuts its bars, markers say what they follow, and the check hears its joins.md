# ADR-119: A person corrects a song's grid and cuts its bars, markers say what they follow, and the check hears its joins

**Date:** 2026-10-20. **Status:** accepted. Closes gaps that
[[ADR-109 What an agent can set, a person can see and change]] and
[[ADR-111 A person checks the project, Space presses what the keyboard reached, and a transition on sound crossfades]]
left.

## Context

Agents can give a song its beat grid (`set_music_grid`: a tempo, a bar's
first beat, named parts) and cut a song on its bars (`cut_music`, joined
with a 30 ms crossfade), and a song's markers follow its clip
([[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]],
[[ADR-104 Voice and sound an agent can trust without ears]],
[[ADR-106 What sits on a shot or marks a song follows it through every edit]]).
A person could do none of it. ADR-109 left four gaps open:

- **`set_music_grid` had no UI.** A person's beats came from AI tools >
  Beat markers, a reading with no way to correct it. ADR-109 judged that
  a grid wants "a song view with its beats drawn, not a row of numbers".
- **`cut_music` had no UI**: it wants a range of the file.
- **The Markers tab did not say which markers follow a clip.** A song's
  Bar markers and a person's own notes looked alike, though only the
  first move with the song.
- **The Check tab could not show a click at a join.** `preview_audio`'s
  edges (ADR-104, [[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]],
  [[ADR-114 A duck opens where it is asked and keeps the hand's keys, long words set the pace, a filtered voice keeps its loudness]])
  measure a hole, a click or a sound cut off where two audio clips meet,
  but they were an agent's listening tool, not a rule of `check_project`.

The products we follow:

- **CapCut** draws a song's beats as yellow dots along the music clip
  (its Beat feature), and a person adds or removes one at the playhead.
- **Final Cut Pro's** beat grid (the model since
  [[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]])
  draws bars and beats over the clip.
- **Premiere Pro** keeps two kinds of markers: clip markers, which travel
  with their clip, and sequence markers on the ruler. Its In and Out marks
  are the range Lift and Extract take.
- **Tap tempo** (Ableton Live, Logic, every DJ app) reads a tempo from a
  person tapping along.

## Decision

### The Audio tab's Beat grid

A **Beat grid** section follows **Basic** in the Audio tab of a song
(`isSong`, lib/beatGrid.ts: an audio clip whose file has a grid, or is
music by its file's or its track's role; a plain audio track is music).
A voice line or a sound effect has none. Every change runs
`set_music_grid`, the agent's command, as one undo step, so the song's
markers of the kinds already on the clip are placed again too.

- **No grid yet: Detect beat grid.** It reads the song as `analyze_music`
  does (once, kept) and keeps what it read as the song's grid. An agent's
  `analyze_music` stays a reading; a person's Detect keeps it, because a
  person corrects what the clip shows, and a correction needs a grid to
  correct. The grid is one straight line through the beats the tracker
  found (`fitGrid`, least squares, each beat numbered from the one before
  so a missed beat counts two) and the bar phase most downbeats take: a
  tempo the tracker reads as 127.4 for a 128 BPM song would drift 0.3 s a
  minute as a grid; the line does not. On the 128 BPM fixture (kicks from
  0.25 s) Detect reads 128 BPM, first bar 0.2501 s. The parts are kept
  when the reading found more than one. A toast says, in a person's
  words, what the reading is unsure of ("the bar lines are a guess (set
  the downbeat on a kick you hear)").
- **Tempo**, typed (the arrows step 0.1, with Shift 1), or **Tap**: tapped
  along while the song plays, the tempo shows on the button and lands
  when the taps stop for 1.5 s, one undo step (`tapTempo`: four taps at
  least; the run after the last pause over 2 s, its last nine; steady
  taps give the span's mean, which a tap's jitter barely moves, a stray
  one the median). It is the tempo heard, divided by the clip's speed.
- **First bar**, in the song's own seconds: typed, nudged 10 ms earlier
  or later, or **Set downbeat here** (a bar starts at the file second the
  playhead plays, `sourceAtFrame`). The field shows the grid's first bar
  line; the grid keeps the downbeat as it was set, so a tempo change turns
  about the bar the person placed.
- **Parts**: each with where it plays (a button that goes there), its
  name (a select) and a remove; **Add here** starts the part chosen on
  the bar line nearest the playhead.
- **Clear grid** forgets it (`set_music_grid` clear).

**The clip draws the grid** (`gridTicks`, ClipView), CapCut's dots: an
amber dot on each beat along the clip's foot, a larger one and a line on
each bar's first beat; under 8 px apart only bars are drawn, then every
fourth bar. Through the clip's in-point, speed, curve and direction, as
its markers are placed. So a nudge of 10 ms moves the lines over the
waveform's kicks as it is made, which a row of numbers could not show.

### Cut bars, between In and Out

The timeline has no range inside one clip; it has In and Out marks, the
range Premiere's Lift and Extract take, and ours. The clip menu of a song
offers **Cut bars**: the In to Out range (one mark alone runs to the
timeline's start or end, as Extract reads it), held to the clip, each end
on its nearest bar line as `cut_music` moves them (`barCut`). With both
ready the item names what it takes: **Cut 4 bars (In to Out)**. It runs
`cut_music` (the 30 ms crossfade, the piece after whole bars later in its
file), clears the marks and leaves the playhead at the In, as Extract
does; one undo step brings the bars back. Where it cannot, choosing it
says what to do: mark In and Out, give the song a grid (Detect), the
song at its own speed, marks over the clip, at least one bar between
them. A playhead and a bar count were the fallback the task allowed; In
and Out are already the editor's range, so they won.

### Markers say which clip they follow

Premiere's clip markers and sequence markers, in one list: a marker that
follows a clip names it after its time, with the linkage icon, and says
so to a screen reader ("Go to Bar at 00:00:02:00, on Liftoff.wav"). A
marker of the timeline's own names nothing. **Detach** (the unlink icon)
makes a following marker the timeline's own where it stands:
`update_marker` takes `detach: true` (the agent can too; moving one
already detached it, ADR-101). The marker's editor says "It moves with
Liftoff.wav; a new position detaches it." Search finds a following
marker by its clip's name, so a song's markers can be listed, exported or
deleted together without a third filter in the tab's narrow row.

### The check hears the joins

`check_project`, for agents and the Check tab alike, listens to where
audio clips meet:

- `joinTargets` (lib/designCheck.ts): on each top-level audio track that
  plays, every place an audio clip ends where the next starts, both
  sounding. A split that plays on in its file (`continues`) is clean by
  construction (ADR-107) and left out.
- `measureForCheck` renders each one **on its own track alone**, 1.4 s
  before to 0.4 s after (the second before the cut tells a ring-out),
  and judges it with `edgeReport`, as `preview_audio`'s edges do
  (`joinEdge`, state/audition.ts). Alone, because a voice or a hit on
  another track can hide a click or make one; the fault belongs to the
  join. Measuring decodes, so it runs only when the check runs, and at
  most 24 joins (`MAX_JOINS`); `not_checked` names how many were heard
  of how many.
- **`click_at_join`** (a hole of 10 dB or more for a few milliseconds,
  "silence" past 40 dB, or a sample step 6 dB steeper than any around it)
  and **`sound_cut_at_join`** (the outgoing sound still ringing 6 dB over
  what follows) are warnings, at the join, naming both clips. The fix is
  `set_crossfade` (0.03 s; 0.25 s for a cut-off tail), or, where none
  fits (`crossfadeJoin`'s rules), `trim_clip` the next clip's start first,
  or short fades for retimed clips. A step in level is no finding: the
  music may change there (ADR-107, ADR-114).
- **The Check tab's words** (lib/checkFindings.ts), under Sound: "A tick
  where the two pieces of “Liftoff.wav” meet", "For a few milliseconds at
  the cut the sound drops 14.7 dB.", "Add a crossfade from the clip menu:
  right-click “Liftoff.wav” and choose Crossfade into next clip." The
  finding selects the clip before the join, on its Audio tab (where the
  Crossfade row is), the playhead on the join.

Measured on the music fixture cut 4-8 s as a butt cut: `preview_audio`
(music alone) and the check both measure a 14.7 dB hole; after the clip
menu's crossfade the check finds nothing and `preview_audio` calls the
join clean (-1.4 dB).

## Gaps left, and why

- ponytail: one tempo a song (ADR-101's): a song that changes tempo
  still needs a grid per piece.
- Parts are added at the playhead, not dragged on the clip; the grid is
  drawn, not grabbed.
- Cut bars needs In and Out: there is no range selection inside a clip.
- The grid is drawn on audio clips only; a video's own sound with a
  grid shows it in no section and no drawing (`set_music_grid` takes it).
- The check hears joins on top-level tracks only: `edges` skip clips
  inside compound clips (ADR-104). A clip that starts mid-sound with
  nothing before it is still `preview_audio`'s to report, not a rule.
- Tap reached with the keyboard is pressed by Space (ADR-111), so the
  song is played with the player's button while tapping by keyboard.

## Consequences

- A song a person ran Detect on has a grid: `analyze_music`, `mark_beats`
  and `check_project` read it through that grid from then on, as after
  an agent's `set_music_grid`.
- `check_project` renders up to 24 short stretches more, and agents'
  checks list click and cut-off findings at joins they did not ask
  `preview_audio` about.
- ADR-111's test of a rule the tab does not know used `click_at_join` as
  its example; it is known now, and the test names another.
- Tests: `beatGrid.test.ts` (taps, the fitted grid, the drawn grid, the
  playhead's second, Cut bars' range and its refusals),
  `designCheck.joins.test.ts` (the joins listened to, the findings and
  their fixes, the Check tab's words), `markers.test.ts` (detach, search
  by clip name). Drives: `beat-grid-ui.js`, `cut-bars.js`,
  `markers-follow.js` and `check-joins.js`, at 1280 x 720 and 1920 x 1080
  (the grid and the check at 1600 x 950 too).
