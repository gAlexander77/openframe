# ADR-148: Punch-ins keep what they applied, angles switch by held opacity, a slideshow is ordinary clips

**Date:** 2026-11-19. **Status:** accepted.

## Context

After the story tools (ADR-147) the owner asked for whatever was still
missing to be added, the editor being for an AI to make its own decisions
in. Three things every large editor does and an agent here could only do
by hand, one call a cut:

- **Jump cuts.** `remove_silences` on a talking head leaves dozens. The fix
  editors use is a punch-in on every other piece; `suggest_edit_points`
  advised it as one `set_param` per cut, with the scale worked out by the
  caller and nothing to undo it by.
- **Multicam.** All five editors have it. `sync_audio` could line a recorder
  up with a camera, but not a second camera, and there was no way to cut
  between angles short of splitting and disabling pieces by hand.
- **A slideshow.** Pictures end to end with a move on each and a transition
  at every cut: three calls a picture.

A fourth is a habit rather than a feature: looking at every shot before
export took a `describe_project` and arithmetic to choose the times.

## Decision

- **`punch_in_cuts`** (`lib/punchIn.ts`). A jump cut is two video clips of
  one file that touch where the file does not go on. In each run of such
  pieces every other one is scaled (default 1.15) about a point of the
  frame (default where a framed face sits, x 0.5, y 0.4), which stays put:
  the scale is multiplied and each position moves away from that point by
  the same factor. The same is done to every scale and position key, so a
  piece that `auto_reframe` or a `frame_region` move keyed (the framing a
  vertical short's pieces usually have) is punched in with its move
  intact. A first version held a point of the picture and skipped keyed
  pieces; on a reframed take that point is off the frame, and the skipped
  pieces were the ones a short needs. What was applied is kept on the clip
  (`VideoClip.punch`: the factor, the point, and the scale it left), so a
  second call first takes it back exactly: no compounding, and after more
  cuts the pattern evens out. A marker was chosen over deriving the base
  from a neighbor because pieces get deleted and reordered. A piece
  reframed since (its scale is no longer what the punch left) keeps the new
  framing as its own, and a piece that no longer meets a jump cut loses its
  punch-in.
- **`switch_angles`** (`lib/multicam.ts`). Angles are clips stacked on
  different tracks, already in sync. Nothing is split: each angle gets
  opacity keys that hold (its own opacity while it shows, 0 otherwise). Sync
  cannot slip, the render plan already skips a layer at opacity 0 (it is
  neither decoded nor drawn), and calling again replaces the program rather
  than cutting pieces of pieces. The alternative, splitting and disabling,
  is what a person does by hand and cannot be redone without undo.
  `sound_from` keeps one clip's sound and mutes the other angles; without
  it sound is untouched and the answer says when several angles are heard.
  An angle asked to show where it is not on the timeline is refused, in
  seconds. Hard cuts only: a dissolve between angles needs the lower one
  held opaque while the upper fades, which depends on track order.
- **`sync_audio` takes a second camera.** A video clip named with the camera
  it syncs to moves into sync as a recorder's sound does. The tool's own
  target (a selection, the tool card) stays an audio clip, so nothing a
  person does changes.
- **`add_slideshow`** composes what exists: `add_media_clip` for each
  picture (each starting where the one before really ended, so a video
  shorter than its turn leaves no gap), a linear `frame_region` move from a
  cycle of four (push in, drift, pull out, drift back), and a transition
  capped at a third of the shorter neighbor. The result is ordinary clips.
- **`preview_frames` without times** shows the middle of every shot on the
  main track, up to 24 spread evenly, and answers the times it chose.

## What a blind test found, the same day

A fresh model with nothing but the MCP tools (the web build, served frozen;
a 77 s NASA interview and two Earth-from-orbit reels) made a 53 s
documentary short in 80 calls and reported fifteen problems. No call had
errored. What was fixed:

- **Captions lost and broke words.** Whisper stamps the last word before a
  pause through the silence, so its middle fell past the cut that ended the
  clip and "another." left the transcript: a word's middle is now taken
  over the time its letters take to say. A word stamped with no length
  ("long" in "long-term") is kept; "-term", "-trapping" and "'s" join the
  word before them.
- **Whole-line captions broke mid-phrase and ran sentences together**
  ("…in the / surface", "…a half. And that / temperature…"). Two lines are
  now balanced and broken where a phrase begins, and a sentence that ends
  inside a cue costs more than ending the cue there.
- **Cutaways were placed blind**: six of twelve cut to another shot midway
  or showed a reel's own title card, because frames a few seconds apart do
  not show cuts. `preview_media` with `shots: true` answers a shot list of
  the file, one tile per shot with its source seconds (the scene detector
  run on the file, not on a clip, kept for the session).
- **A second `split_scenes` call was handed the first call's job.** A long
  tool still at work on other arguments now makes the second call wait its
  turn, and tells it so if the first outlasts the wait. `job_status` takes
  `wait`, so following a job is one call.
- **Reordering lines took five overwrites and a parking spot.**
  `move_clip` with `mode: "insert"` closes the gap a clip leaves and makes
  room where it lands; what sits on the shot goes with it.
- **A transcript was 230 loose words.** `get_transcript` answers sentences,
  each with its source seconds and the pause after it.
- **Captions landed on a lower third added before them.** `auto_captions`
  answers `overlaps` (the check's own finding, with its fix), and the
  documentary playbook captions before it names.
- **The music opened ducked.** Between two lines a short swell pumps; at
  the song's own edges nothing does, so a stretch of at least half the gap
  comes up (a second of title before the first line used to play 15 dB
  down).
- **`measure_loudness by_track` did not see the talk** when it was the
  footage's own sound on the main track: video tracks that sound are
  listed (role picture) and, with no dialog track, taken as the voice.
- Smaller: `delete_markers` by label or all (81 scene markers were left
  behind), a roll given a length no longer ends a frame past it,
  `normalize_loudness` answers `now_lufs` beside the `lufs` it measured
  before, `add_text`'s help shows `\n` as written, and the advice for a
  final hit under a line offers moving the music, not only the talk.

The documentary playbook was rewritten where it contradicted itself or the
tools (a cutaway that hides a join starts before it; `move_clip` reorders
only with insert; the talk may still be in the footage).

Not fixed, for the next round: `generate_music` places a score whose fit
it reports as failed, and its ring ending is cut short; a whole talk on
one clip is one "line" to `duck_under_speech`; `check_project` passes a
film whose loudness fails the spec (it does not measure it) and says
nothing of stray markers; nothing tells whether a clip's sound already
carries music; burned-in text is only read by the desktop shot log;
`duck_under_speech`'s description is 4,000 characters.

## Consequences

- One optional project field, `VideoClip.punch`. A reader that predates it
  draws the punched-in piece as it is (the transform already holds it) and
  only loses the way back.
- An angle that is off still plays its sound unless muted: `sound_from` or
  the note is how an agent learns that.
- `check_project` counts cuts where clips meet; a switch of angle is an
  opacity key and is not counted as a cut.
- No buttons yet, as for ADR-147's tools.

## Checked

`scripts/drive/cut-tools.js`, over MCP in the web build: the second camera
(its sound starting 1.5 s into the first's) is placed at 1.53 s with offset
-1.502 and confidence 0.76; frames at 3, 5 and 9 s are the first angle, the
second (98% teal) and the first again; a second call replaces the program;
the punched-in piece's burned-in words measure 1.149 times as wide, 1.252
at scale 1.25, and `off` restores the frame exactly; the slideshow's
pictures fill the frame, move, and mix at the cut; `check_project` answers
"ok: nothing found".

`scripts/drive/social-short-flow.js` runs the social_short playbook in its
new order (frame the take, then cut it up, then punch in): on a 9:16
canvas a piece framed with `frame_region` grows exactly 1.15 times and
still fills the frame, the three-word captions say every word that plays,
and `check_project` kind social_short finds nothing. Its first run put the
hook at y -0.3, where two lines reach under the apps' tabs; the playbook
now says y about -0.2.
