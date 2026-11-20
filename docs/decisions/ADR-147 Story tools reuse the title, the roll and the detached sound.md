# ADR-147: Story tools reuse the title, the roll and the detached sound

**Date:** 2026-11-19. **Status:** accepted.

## Context

A survey of the 197 MCP tools against Premiere, Resolve, Final Cut, VEGAS and
CapCut found a small set every one of them has and an agent could not reach
in one call, or at all:

- **J and L cuts.** `suggest_edit_points` advised them, but the edit was two
  calls with placeholder ids (detach, then trim), and it left the incoming
  shot's own sound playing under the outgoing one.
- **A number that counts.** A statistic counting up, a countdown, a
  stopwatch: Final Cut's Counting generator, After Effects' Numbers. A title's
  text was fixed for its whole life.
- **A credits roll.** Possible by hand (a tall title and two position keys),
  with the heights and speeds worked out by the caller.
- **Caption keywords.** CapCut's keyword highlight; `style_text_range`
  styles one stretch of one title per call.
- **A progress bar** and **a cover picture on disk.** `preview_frame` returns
  the frame to the model, which cannot write it to a file.

There was also no playbook for the most common long-form genre: an
interview with cutaways.

## Decision

**Seven tools, each built on what exists; no new clip type.**

- `jl_cut` (`lib/project/splitEdit.ts`): both clips' sound is detached as
  `detach_audio` does (grouped with its picture), put on one audio track,
  and the cut between the two sounds is rolled with the existing roll. `by`
  is measured from the picture's cut, not from where the sound's cut is now,
  so a second call moves the same cut and 0 restores a straight one. A clip
  whose sound was already detached is found by group, file and sync, not
  detached twice. Roll limits (the source's ends) are answered as roll_edit
  answers them.
- `add_counter`, `set_counter` (`lib/counter.ts`): an optional `counter` on a
  text clip, `{from, to, seconds, decimals?, format?, ease?}`. The text holds
  `{n}` where the number goes. The render plan substitutes the number per
  frame (`countedClip`), so style, runs, animations, keys, versions and the
  design check all see an ordinary title; a styled run over `{n}` covers the
  whole number. The count's length is stored in seconds, not frames or a
  share of the clip, so a trim or a new frame rate leaves a timer's pace
  alone. A rising count rounds down and a falling one up: it never shows a
  number it has not reached (a countdown from 10 reads 10 for its first
  second). Formats: number (12,500), plain (2026), time (1:05). A title's
  box is measured at the wider end of its count.
- `add_credits` (`lib/credits.ts`): the roll is cut into grouped titles of at
  most eight lines, each a clip only while it crosses the frame, all keyed
  on one line of motion. One raster of a hundred lines would be several
  thousand pixels tall: past the 32 MiB text cache (re-rastered every frame)
  and past some GPUs' largest texture. Empty lines are distances between
  blocks, never drawn. `check_project` does not judge a roll (`isRoll`: a
  title keyed from below the frame to above it) by time on screen or by the
  top and bottom safe areas; its sides are still judged.
- `highlight_words`: whole-word, any-case matches in every caption (or the
  titles named) take a run style, through the same `styleRange` that
  `style_text_range` uses.
- `add_progress_bar`: a line shape with `shape.draw` keyed 0 to 1.
- `export_frame` (app tool): `exportStill` written through the agent export
  target, so it follows export_video's rules (the Videos folder or `folder`,
  never replacing unless asked). JPEG for upload limits, PNG exact. Desktop
  only, as every agent export is; the browser build says so and names
  preview_frame. No Rust change: `export_begin_auto` takes any plain
  extension.

**A `documentary` playbook and prompt**: the transcript first, the cut made
on it (`cut_ranges`), J and L cuts only once the cuts are final, cutaways,
names, sound, match color, captions, credits.

## Consequences

- One optional project field (`TextClip.counter`); older files are unchanged
  and older builds draw `{n}` literally.
- Splitting or head-trimming a counting title restarts its count at the new
  start; `set_counter` corrects it. A fix needs a count offset that
  `moveLeftEdge` maintains.
- After `jl_cut` the sound is no longer "lined up" with its picture, so
  `cut_ranges` and `remove_silences` on the picture no longer cut it too:
  the playbook puts J and L cuts after the cuts are final.
- A proportional font's digits differ in width, so a centered counter can
  shift a pixel or two as it counts; the canvas has no tabular-figures
  switch.
- None of the seven has a button yet. The in-app assistant and outside
  agents reach them through the registry.

## The playbook run end to end, the same day

`scripts/drive/documentary-flow.js` runs the documentary playbook over MCP on
two synthesized interviews. Its first runs found five things, each fixed:

- **A J or L cut's join was a click to the check.** Two different sounds
  butted together measure as a hole a few milliseconds long, and
  `check_project` answered `click_at_join` for a join `jl_cut` had just made.
  The join now gets the 30 ms crossfade a song splice gets, where the clips
  allow one (their own speed, file before the incoming sound to rise over);
  otherwise a butt cut, as before.
- **A number came as two words.** Whisper stamps "12,000" as "12" and
  ",000", so a caption began with a comma. `monotonicWords` joins a word
  that starts with `.`, `,` or `:` and a digit to a word ending in a digit
  just before it ("3" ".5", "10" ":30").
- **A word shorter than a frame fell out of its caption.** "year," was
  stamped 20 ms long; mapped to frames it had no length and `timelineWords`
  dropped it. A word that starts inside the clip keeps one frame.
- **A ripple trim left the next shot's sound out of sync, without a word.**
  With both sounds detached, trimming the first picture's end moved the
  second picture, but its sound's new place was still taken by the first
  sound, so linkage left it where it was. `trim_clip` on a picture whose
  sound is detached now moves the sound's same edge by the same amount (a
  J or L cut keeps its offset); trimming the audio clip itself still moves
  the sound alone, which is how a split edit is made by hand. The timeline's
  own trim (the drag) is unchanged: it shows the red out-of-sync counts.
- **Out of sync is now said.** After any agent command, a detached sound
  that was in sync with its picture and no longer is gets a note naming the
  two clips, the seconds, and the call that lines them up
  (`sync_to_clip` with offset 0). It is a safety net for the edits that
  still move one of the two alone (`slip_clip`, `move_clip`, a blocked
  ripple).

`jl_cut`'s note also says how to get the handle it lacks when the source
runs out: end the outgoing clip earlier in its file, or start the incoming
one later, with `trim_clip` and ripple.

## Checked

`scripts/drive/documentary-flow.js`: every word that still plays is in the
captions, the check answers "ok: nothing found", the mix passes the online
spec at -14 LUFS.

`scripts/drive/story-tools.js`, over MCP in the web build: the exported
sound's beeps move as an L cut and a J cut say they should; the counter's
held number is pixel-identical to a plain title of the same words; the roll
is empty before and after and moves a quarter of the frame a second at
`line_seconds` 4; a highlighted word turns yellow; the bar is a quarter full
a quarter of the way in. The drive's own check found the roll's first
default size (48) under the readable floor on 16:9 (49); the default is now
1.15 times the frame's floor. `export_frame` wrote no file in this round: it
needs the desktop app, and only its refusal on the web was driven.
