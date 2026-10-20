# ADR-106: What sits on a shot or marks a song follows it through every edit

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-102 An edit moves only what its answer names, and the main track keeps the gaps it was given]] and
[[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]].

## Context

ADR-102 promised that a clip sitting on a main-track shot moves with that
shot whenever an edit moves it, for agents as for people, that the magnet
closes only the gaps an edit opens, and that a time exactly between two
frames takes the earlier one. ADR-101 promised that a song's markers
follow its clip through moves, trims, speed changes and splits. A bug hunt
tried to break both, in unit tests and through the web build's MCP server
with the launch film's footage and its 128 BPM song. What broke:

- **A run of captions stayed behind an insert.** Linkage moved a track's
  clips one at a time, in track order, each only into a free spot. A shot
  inserted at 0 moved three shots 1 s later; caption one's new spot was
  caption two's old one, so it stayed, and so did caption two; only the
  last caption followed its shot. Voiceover lines end to end on one track
  did the same.
- **A shot ripple-deleted with its caption left the later captions off
  their shots.** Each track ripples by what it lost: the caption track by
  the caption's 1.5 s, the main track by the shot's 2 s, and linkage
  skips a clip the edit moved itself, so every later caption landed 0.5 s
  late.
- **Inside a compound, and between a batch's steps, an agent's edits had
  no linkage.** `runAgentCommand` settled the root timeline only:
  `edit_compound`'s ripple trim moved the shots inside and left their
  captions, which a person's edit with the compound open does not; a
  `batch` inserting a shot and then adding a hook title at 0 wrote the
  title over the first caption, which had not moved yet (its 1.8 s became
  0.8 s).
- **A cut from a clip's first frame lost the clip.** `cut_ranges` kept the
  clip's id on its first piece, which a cut from the head deletes:
  `cut_music` of a song's intro left a clip with a new id, the `clip_id`
  the agent held named nothing, and every marker that followed the song
  went (88 beats to 0), the kept part's too. With the magnet (an AI tool
  such as `remove_silences` taking a shot's first second), the piece left
  counted as a new clip, which keeps no gap, so the pause before the shot
  closed.
- **A clip inserted at the start of the shot after a pause closed it** (a
  person's drop at that cut with the magnet on): a new clip kept no gap,
  so it was pulled onto the shot before.
- **A song put in a compound clip lost its markers**: they named a clip no
  longer on the timeline. A unique copy of a compound with a marked song
  inside lost the copy's markers: they named the original's clip.
- **Trimming one use of a song doubled another's markers.** With the song
  on the timeline twice, each read, trimming the first one's tail moved
  its beats onto the second clip, which plays those seconds and had its
  own markers on the same frames (11 doubled).
- **A song's markers took the later frame of a tie.** `sourceToTimeline`
  and `frameOfSource` still used `Math.round`: at 30 fps every eighth beat
  of a 128 BPM song is a tie (3.75 s is frame 112.5), so its marker stood
  on frame 113 while `add_markers`, `cut_to_beats`' beats and
  `add_beat_hits`' times put 3.75 s on 112.
- **`cut_music` of a song's head began half a frame before the bar line**:
  the piece left started on the frame nearest the cut, so its beats ran
  half a frame early from the clip's start.
- **A reversed clip's trim gave the wrong reason**: its end reaches toward
  the file's start, and the answer said "the source ends there (the file
  is 60 s long)".
- **`slip_clip` on a freeze frame answered "the source ends there"**: a
  freeze holds one frame and nothing moved.
- Two drives still held the old tie: the markers drive expected 1.25 s
  typed in the Markers tab to land on frame 38 (ADR-102's rule puts it on
  37), and the motion drive compared each `preview_motion` tile at 7.55 s
  with the viewer seeked to `Math.round(7.55 * 30)`, frame 227, where the
  tile rightly shows 226.

## Decision

- **Linkage moves a track's clips in the direction they go** (`settle`):
  those moving left from the left, those moving right from the right, so a
  run of clips each moving into its neighbor's old spot all move. A clip
  whose new spot is taken by a clip that stays still stays (ADR-102's one
  silent case).
- **A clip moved only by its own track's ripple follows its shot**
  (`settle`'s `rippled`): when a ripple delete took a clip before it on
  its track and the clip moved by exactly what was deleted there, and it
  sits on a main-track shot that moved whole, it goes where the shot
  went. A deliberate move (another amount) is still the edit's.
- **A new clip on the main track keeps the empty time before it**
  (`closeOpenedGaps`): after an old clip (or the start), the empty time
  that lay between that clip and where the new one starts; after another
  new clip, none. A clip dropped past the end still snaps to the last
  one; a clip inserted at a shot's start keeps the pause before it.
- **`cut_ranges` keeps the clip's id on its first piece kept**, whatever
  is cut: the clip an agent named is still there, its markers follow, and
  the magnet sees an old clip that keeps its pause. Its description says
  so.
- **An agent's command inside another runs as the agent's command**
  (`runNested`): `edit_compound`'s command and each of a `batch`'s steps
  get the linkage of the timeline they edit, the compound's own main
  track inside a compound, as a person's edit with it open does. Outside
  an agent's call (the app's own `runCommand`), nothing changes.
- **A marker follows its clip into a compound clip** (`follow`'s
  `throughNests`): when its clip is not on the timeline but is directly
  inside a compound played there, the marker stands where the compound
  clip plays that second (nearest it when several do); moving, trimming
  or breaking apart the compound clip keeps it on the beat.
  `copyCompound` points a copied marker at the copy's clip.
- **A marker never moves onto a clip already marked at that second with
  that label**: it goes instead, as a trimmed-off second does.
- **Every time placed through a clip rounds as `secondsToFrames` does**
  (`nearestFrame` in `time.ts`): song markers, `analyze_music`'s times,
  `check_project`'s grid, and the source frames of `cut_ranges`,
  `split_at_times`, transcript words and scene cuts. A beat and the same
  second given to any command land on one frame.
- **`cut_music` of a song's head starts the piece left on the bar line**
  (its `in` is the cut's end exactly), so its beats fall on the grid from
  the clip's first frame.
- **A trim's reason knows a reversed clip**: its end stops where the
  file starts, its start where the file ends, each named so.
- **`slip_clip` refuses a freeze frame**, saying there is nothing to slip.

## What held

Tried and right as built: one undo restores the clips, gaps and markers
of a command, a cut, a compound, a move and a break apart (each through
MCP); a gap stays through `remove_silences` on the shot after it; a
ripple trim stops at a source run out at 1.5x, and reaching exactly the
source end at 1.1x or 1.5x says nothing; a ripple delete of a shot alone,
a speed change, a gap closed by `close_gaps` and a head trim behave as
ADR-102 says; markers follow a song through a split, a move, a speed
change, a compound clip moved 2 s and a break apart; `cut_music` in the
middle of a song joins on the bar; `changed_clips` lists each caption
moved by an insert, and nothing that did not move; `closedGapNotes` names
only a gap that closed by moving the clip after it. Every drive (181) ran
headless on the web build: all pass but the three that need the desktop
app (desktop-session-jobs, media-relink, window-header) and the two that
held the old tie, fixed (markers, motion-first-frame); music-structure
and longgop-cut pass with their media pointed at where it is kept.

## Consequences

- People get the same three fixes through the magnet and linkage: a run of
  titles follows an insert, a shot ripple-deleted with its title keeps the
  later titles on their shots, and an insert at a shot's start after a
  pause keeps the pause.
- Tests that put a source time on a half frame see the earlier frame (one
  in `cut.test.ts`, the markers drive).
- Not built: an app tool's answer lists the clips it moved, not the pieces
  it made (`remove_silences` names its ranges; `describe_project` has the
  new ids). A title over the second half of a shot split by
  `freeze_frame` stays where it was: the shot it sat on changed length, so
  it did not move whole. `closedGapNotes` says how far each gap closed,
  not how far each clip after it moved in all.
- ponytail: markers follow a song one compound deep; a song in a compound
  inside a compound loses its root markers.

Tests: `ops.test.ts` (a run of captions through an insert and back, a shot
deleted with its caption, an insert at a shot's start after a pause),
`cut.test.ts` (a cut from the head keeps the id and the pause),
`musicGrid.test.ts` (into a compound and out, a unique copy, two uses of
one song, `cut_music` of the intro, the tie), `commands.test.ts` (an
agent's insert and ripple delete with captions, `edit_compound` and
`batch` steps, a reversed clip's reason, a freeze's slip). Each fails on
the code before it.
