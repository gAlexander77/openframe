# ADR-102: An edit moves only what its answer names, and the main track keeps the gaps it was given

**Date:** 2026-10-20. **Status:** accepted.

## Context

A fresh Claude Code session made a 38 s music-led ad through the MCP tools
and listed what went wrong. The edits lane reproduced each finding on the
web build's MCP server, from the tester's own calls where it could.

- **A gap closed by itself (the worst finding).** The tester left 0.233 s
  of black on the main track for the music's breath before the drop
  (7.767 to 8 s). Every later main-track clip, and the picture-in-picture
  over one of them, moved 7 frames early, and no answer said so. The cause:
  commands run through `runCommand`, which never applies the magnet, but
  the AI tools (`add_voiceover`, `duck_under_speech`, `add_ambience`,
  `add_sound_effect`, `normalize_loudness`, `generate_music`...) run
  through `edit()` in `state/actions.ts`, whose `settle` packed the whole
  main track (`compactTrack`) with the magnet on, the default. The first
  such call after the gap was the tester's `add_voiceover`, an edit on
  audio tracks only. Its answer lists the lines, not clips, so the move
  surfaced 30 calls later as black at 31.9 s. Reproduced with
  `normalize_loudness` on the music: the gap closed, the PiP moved, the
  answer was the gains. This was the third time the class bit:
  effect edits and the background-removal switch had closed gaps the same
  way (History, 2026-10-16), each fixed by moving one caller to
  `store.edit`.
- **Connected clips followed some ripples and not others.** A command's
  ripple (a ripple trim, an insert) moved its own track and nothing else;
  the AI tools' `settle` applied linkage ([[ADR-035 Linkage binds a clip to the shot under most of it]]),
  so the PiP moved with the silent gap close and stayed behind on the
  insert. (The tester also thought it followed the ripple trim; it did
  not: that answer did not list it, and replaying it left it in place.)
- **A ripple trim stopped short with no reason**, at 7.833 instead of 8,
  because the source ran out at 4x; its `speed_points` ended at
  `[0.983, 4]`. The stored curve was fine: points stay where they are when
  a clip is trimmed ([[ADR-027 Speed curves are exponential and anchored to clip frames]]),
  and past the last one the speed holds. `describe_project` divided raw
  points by the length, so a trimmed ramp read as ending early.
- **`slip_clip` `by` was not seconds of source.** It became timeline
  frames, times the clip's mean rate (the timeline drag's rule): on a ramp
  averaging 1.48x, 0.75 s moved the in-point 1.134 s.
- **`check_project` counted a cut nobody sees**: a filler shot's cut at
  7.833 under a black card on a track above, flagged off the beat.
- **Half-frame times landed late.** `secondsToFrames` used `Math.round`:
  nearest, with a time exactly between two frames (3.75 s at 30 fps is
  frame 112.5) going up. At 30 fps every quarter-beat of a 120 BPM song is
  such a tie, so the launch shot ended at 7.767 and its rumble ran a frame
  into the breath.

## Decision

**The magnet closes only the gaps an edit opens** (`closeOpenedGaps` in
`ops.ts`, used by `settle`). After an edit, each main-track clip keeps at
most the empty time that lay, before the edit, between it and the clip now
before it; a new clip keeps none. Deleting or dragging a shot away, or
trimming a tail, still closes the hole it leaves, as CapCut's magnet does,
but a gap that was there before the edit stays, whatever made the edit.
For people the main track behaves as before: with the magnet on, the track
has no gaps to keep (turning the magnet on packs it, `compactTrack`). For
agents a deliberate pause survives every later call. We kept CapCut's
magnet rather than turning it off for agents: the user's own timeline uses
it, and what it closes is what the edit opened. The class of bug ("a
metadata edit through `edit()` closes gaps") is gone at its root, not
caller by caller.

**Agents' commands get the timeline's linkage, never its magnet**
(`runAgentCommand` in `commands.ts`, called by `window.videoEditor.exec`
and so by MCP). One rule for clips sitting on a main-track shot, the same
for commands, AI tools and the user's edits: they move with that shot
whenever an edit moves it (a ripple trim, an insert, a ripple delete, a
closed gap, a speed change, a move). A gap on the main track closes only
when the call asks (`ripple: true`, `close_gaps`, `lift_range`). The
help's overview states the rule once, with the way to hold a black pause
that nothing can close: a color clip on the main track.

**Linkage follows a shot only when the shot moved whole** (same length).
A clip whose head was trimmed changed its start but not where its pictures
play; with the magnet off (agents), linkage had shifted the titles on it.

**Every clip an edit moves is in its answer.** Commands already answered a
diff of `describe_project`; the app tools (`add_voiceover`,
`normalize_loudness`, `duck_under_speech`...) answer in their own words, so
`handleMcp` now snapshots the timeline around any tool that is not
read-only and adds what moved (a start, end or track that changed) to
`changed_clips` (`withMoves`), in a second text part when the answer is
not one JSON object. When the main track's gap closes by moving the clip
after it, the answer's notes say so in one sentence: "The main track
closed the 0.233 s gap at 7.767 s: the 12 clips after it moved 0.233 s
earlier."

**A trim that stops short says why** (`trimStop` in `ops.ts`, which
shares `trimBounds` with `trimClip`): "Stopped at 7.833 s, not 8 s: the
source ends there (launch.mp4 is 12 s long, and the clip reads it at 4x at
its end)", or the next clip, the timeline's start, one frame.
**`speed_points` describe the curve as it plays over the clip**:
`normalizeWindow` pins t 0 and 1 at the speeds playing there. The stored
points keep ADR-027's rule, so untrimming still brings a ramp back.

**`slip_clip` `by` is seconds of the source file**, as its help said and
as `in` and `cut_ranges` are: the in-point moves exactly that much
(`slipBySource`), and an answer says where the file stopped it. The
timeline drag keeps its rule (a frame of drag moves the source by the
mean rate). `trim_clip`'s `to` stays timeline seconds: it places an edge
on the timeline, where slip changes only the source.

**`check_project` counts a cut only where it shows** (`shownCuts` in
`designCheck.ts`): a cut under a clip on a higher visible track that
hides the whole frame on both sides of it (footage or a solid card, opaque,
unmasked, unkeyed, upright, normal blend) joins its two shots. Pictures and
compounds never hide a cut: they may be transparent.

**A time exactly between two frames takes the earlier frame**, the one on
screen at that instant (`frameAt`): `Math.ceil(x - 0.5)`. Every other time
still rounds to its nearest frame. A beat at 7.75 s sounds during frame
232, so the cut lands on the frame where the beat happens. Ties going one
way, rather than to even, keep a whole-frame span between two ties (0.25
to 0.75 s) its length.

## Consequences

- An agent's gap stays until it asks to close it, and `check_project` still
  reports one as black (`gap_on_main_track`).
- In the app, a person's drag onto the main track with the magnet on still
  packs it (`placeClip`), as CapCut does: a color clip is the way to hold
  a pause there too.
- Ripples now carry titles, pictures-in-picture and sound effects sitting
  on a shot for agents as well. A music bed, a grade or anything else
  across two whole shots stays (ADR-035); so does a clip whose new spot is
  taken, which is the one silent case left (the answer lists only what
  moved).
- Describing every non-read-only app tool twice costs a few milliseconds
  per call on a long timeline; previews and measurements skip it.
- Four tests encoded the old tie (a 0.5 s fade at 25 fps, a 0.25 s hit at
  30 fps, a clip at 8.95 s); `+ 0` keeps `secondsToFrames` from answering
  `-0`. A branch merged later whose tests put a clip on a half frame will
  see the earlier frame.
- Not done: the tester's suggested check for cuts that drift off the
  markers they were placed on. With nothing moving silently, a marker
  drift is now always in an answer.

Tests: `ops.test.ts` (an edit elsewhere keeps the gap; a delete or a tail
trim closes only what it opens; a head trim carries nothing),
`commands.test.ts` (agents' ripple trim and insert carry the PiP, a gap
stays unless asked, the trim's reason, a trimmed ramp described 0 to 1,
slip in source seconds), `mcp.test.ts` (an app tool's moves and the gap
sentence), `designCheck.test.ts` (the hidden cut), `time.test.ts` (ties).
Each fails on the old code.
