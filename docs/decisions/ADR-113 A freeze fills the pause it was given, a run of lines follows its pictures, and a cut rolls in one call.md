# ADR-113: A freeze fills the pause it was given, a run of lines follows its pictures, and a cut rolls in one call

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-102 An edit moves only what its answer names, and the main track keeps the gaps it was given]] and
[[ADR-106 What sits on a shot or marks a song follows it through every edit]].

## Context

A second fresh Claude Code session made a 46.5 s vertical short and its
16:9 cut through the MCP tools and listed 24 problems. The timeline-edits
lane took six of them and reproduced each on the web build's MCP server
from the tester's own calls, with the launch film's footage and its
120 BPM song (voice lines stood in by audio clips of the same lengths,
except for the voiceover note, made with the voice model itself).

- **A freeze ripped the edit apart (the worst finding).** The tester
  left a pause on the main track, 6.3 to 8 s, for a freeze under a title
  card, and called `freeze_frame` at 6.267 s for 1.733 s. It could only
  insert: every later shot moved 1.733 s, the cut came off the drop, and
  a one-frame piece of the shot (its last frame, the very picture the
  still holds) sat after the still at 8 s. Of twelve voice lines only the
  last moved with its shot. The cause was linkage, not the voice: a clip
  follows the main-track shot under more than half of it, and line 6
  ("Lakes like spilled ink", 16.3 to 20.35 s) lay over three shots with
  no majority, so it stayed. Linkage moves a run of clips moving right
  from the right (ADR-106); line 5's new spot was then taken by line 6,
  so it stayed, and so did lines 4 and 3, the line the tester saw sitting
  over its moved shot. The captions did the same.
- **Voice lines were pushed past their `at` without a word.** A script
  that overran its slots put every line after the third 1.7 to 3 s late
  (`layoutLines` starts a line when the one before ends). The answer gave
  the real starts; nothing said a line missed its mark.
- **`set_speed_ramp hold: 1.0` was refused** ("args.hold must be a
  number"). The call log shows what the client sent: the string `"1.0"`
  (`hold: 1` went through as a number). `validate` takes only JSON
  numbers.
- **No roll edit for agents.** Moving seven cuts onto the beat took two
  `trim_clip` calls each, shrink before extend, or the second collided.
  The timeline has had a Roll tool (`ops.rollEdit`) all along; no command
  reached it.
- **Keying a value on a keyed path ramps from the key before.**
  `set_param volume 0.55 at 40.067` on music keyed at 35.8 s made a 4 s
  swell under the last line; the tester added a hold key by hand.
- **Short effects lost their tails.** A sound's clip length was its file
  rounded to the nearest frame, and ADR-102's tie rule takes 7.5 frames
  to 7: the 0.25 s shutter became 0.233 s and the 0.15 s pop 0.133 s.
  `add_media_clip` also capped a clip at `roomRight`, which floors.

## Decision

- **A clip across several shots follows them when everything under it
  moved by one amount** (`settle`'s `movedAs`): the shots under it, and
  the gaps between shots that moved together, as an editor's sync lock
  carries a track through an insert. A voice line, caption, title or
  grade across a run of shots an insert or a freeze pushed later goes
  with them; where the shots under it moved apart (a reorder, a delete in
  the middle) the old rules stand: the shot under most of it, or nothing
  for a bed across whole shots. This only adds moves, so a clip that
  followed before follows by the same amount. A gap counts as moved when
  the shots on both sides moved by the same amount; past the last shot
  nothing does. **A music track's clips never follow this way**: the
  song is the grid the picture is cut to, and moving the piece after an
  insert would open a hole in it (a music clip on one shot still follows
  that shot, as before). The help's overview states the rule.
- **`freeze_frame` takes `mode`**: `insert` (the default, CapCut's
  Freeze) as before; `overwrite` lays the still over what is there (the
  rest of the shot, a pause left for it, the next shot's head) and moves
  nothing. We kept insert as the default because it is what CapCut and a
  person's Freeze button do, and named the pause case in the description,
  rather than guessing from a gap whether it was meant for the still.
- **At a clip's last frame, an inserted still takes that frame's place**:
  the one frame left after it showed the same picture, so it is gone, and
  the later shots move by the hold less that frame. The last frame's
  transition and out animation go to the still, which now ends the shot.
- **`add_voiceover` notes each line its `at` could not hold**: "Line 4
  starts at 14.349 s, 1.749 s after its at (12.6 s): line 3 runs until
  then", with what to do (`lateLineNotes` in `voiceScript.ts`).
- **A number sent as a string is read as that number** (`coerceNumbers`,
  before `validate`, for every command, batch step and app tool): only a
  plain decimal (`1`, `-2.5`, `.5`, `1e3`, spaces around it trimmed).
  `"1.0s"`, `""`, `"Infinity"`, `"0x10"` and `"1,5"` are still refused.
  A string where the schema wants a string stays a string.
- **`roll_edit {clip_id, to, edge}`** moves the cut at a clip's end (or
  its start) to `to` in one call, through the Roll tool's own
  `rollEdit`: one clip grows by what the other loses, nothing else moves,
  and the answer says where the source or a one-frame clip stopped it.
  A cut with a gap at it is refused with where the neighbor is. A person
  already has the gesture (the Roll tool), so the UI is unchanged.
- **`set_param ... at` takes `hold: true`**: what plays before `at`
  stays (a key on the frame before keeps the value playing there) and the
  value steps at `at`, over one frame, which does not click on volume. On
  a path without keys it makes those two keys. Colors are refused (a
  color steps with `add_keyframe`'s ease hold).
- **A sound's clip runs to the frame its last sample plays in**:
  `clipForAsset` rounds an audio file's length up, and `roomRight` lets an
  audio clip reach that frame. Pictures keep the frames they fill.

## Consequences

- People get the linkage rule too: a title across two shots follows an
  insert before them, and one over a black pause between two shots that
  moved together follows the pause.
- An imported song's clip may run up to a frame past the file's end; the
  last fraction plays silence, as the frames past a voice line's end did.
  Voice lines keep their tails the same way (a 1.6145 s take is 1.633 s,
  not 1.6).
- `freeze_frame` at a shot's last frame moves the later shots one frame
  less than the hold; the answer lists each.
- Not built: a title over the second half of a shot split by a freeze
  still stays where it was (ADR-106): the second half is a new clip and
  linkage follows shots by id. A roll moves one cut on one track; a
  detached sound grouped with the picture is not rolled with it (the Roll
  tool does not either). `ops.ts` now imports `audioRoles`, which imports
  ops: a cycle used only at run time.

Tests: `ops.test.ts` (the film's freeze carries five voice lines across
one, two and three shots while the song stays; a title over a pause
follows it; the last-frame still; overwrite into a pause and over the next
shot's head), `commands.edits.test.ts` (hold "1.0" as 1 and refusals,
nested coercion, roll_edit both edges, its stop and gap refusal,
set_param hold on a keyed and an unkeyed path, freeze_frame's modes
through `runAgentCommand`, sound lengths), `mcp.test.ts` (strings read for
a command and an app tool, junk refused), `voiceScript.test.ts` (the late
lines' notes). Each fails on the code before it. Through the web build's
MCP server: the tester's freeze moves lines 3 to 12 and their captions
with their shots and leaves no tail; overwrite fills the pause; hold
"1.0" ramps as 1; roll_edit puts the 12.3 s cut on 12.5 s; set_param hold
keys 40.033 s; the shutter and pop clips are 0.267 s and 0.167 s and
measure cleanly in preview_audio; add_voiceover with the tester's first
script names lines 4 and 5.
