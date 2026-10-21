# ADR-125: Elements keep their rows and their room, joins into silence move, callouts click on each part and stay in frame, exports replace when asked

**Date:** 2026-10-21. **Status:** accepted. Builds on
[[ADR-121 Captions stay on top, ad elements keep rows of their own, and answers count what moved together]]
(an element's own rows, its place clear of captions),
[[ADR-104 Voice and sound an agent can trust without ears]],
[[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]] and
[[ADR-119 A person corrects a song's grid and cuts its bars, markers say what they follow, and the check hears its joins]]
(joins, cut_music, the check's joins),
[[ADR-120 Callouts and overlays pinned to footage, and frame_region moves]] (callouts),
[[ADR-122 Versions crop around what the editor framed, and callouts stay on what they point at]]
(a callout off a version's frame) and
[[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]]
(an agent never replaces a file).

## Context

A fourth fresh Claude Code session made a 58.5 s vertical how-to ("Your
first edit in OpenFrame") from 2560x1440 screen recordings through the MCP
tools (Claude film test 4, 2026-10-21) and reported 16 problems. Seven
were about elements, music joins, callout sounds and exports. Each was
reproduced through the web build's MCP server with the tester's own
arguments (the same recordings, the 120 BPM promo song, the icon):

- **F. Titles and callouts landed on the end card's rows.** The end card,
  added at 54 s, made four rows named "End card". Every later `add_text`
  (the step pills, the hook and result titles, all before 54 s) went onto
  its background's row, free at their times, and every `add_callout` ring
  and dim onto two more of its rows: the pills lived on a track named
  "End card", and moving the card's rows would have carried them.
- **G. The end card was built at the readable floor on 9:16.** Placed
  below captions moved to the top band, it was laid out again in the
  0.358 of the height left: headline 40 (the tester's 36), button 31,
  logo 0.17, the whole card 0.30 of the height. Every part shrank by one
  ratio that overshot: a headline made smaller wraps to fewer lines, so
  it came out shorter than the ratio said, and the loop never grew it
  back. Its pulsing button sat at the floor, so at the bottom of its
  pulse (scale 0.94) check_project named it too small. The tester then
  enlarged the headline, its three lines ran into the button, and the
  check said nothing: an element's own parts were never judged against
  each other.
- **I. A join's diagnosis repeated the fix already applied.** The song
  was cut by hand into file 6-16 s and file 8-56 s joined at 10 s, with
  `set_crossfade 0.03`. `preview_audio` called the join "an 18.5 dB hole
  ... (a butt cut's click guard)" and fixed it with `set_crossfade 0.03`
  again; 0.1 s made it 18.8. check_project said "silence ... dip_db -60"
  with the same fix. The cause: the incoming file is digital silence from
  7.75 to 8.0 s (the breath before the drop), so the crossfade fades into
  silence and a longer one deepens it. And `cut_music` could only take
  bars out: repeating four bars meant two clips by hand.
- **J. A frame of black, made silently.** In one batch `set_speed 1.4`
  ended a main-track clip at 49.500 s; the next, given 49.521, rounded to
  49.533. The answer said nothing (check_project later found 0.03 s of
  black).
- **K. A callout clicked only as it drew on.** A glide's arrival could
  not click; the tester placed twelve clicks by hand.
- **L. A pinned ring rode a pan off the frame.** The ring on a landed
  clip followed the shot's pan off the left edge of the 9:16 frame, its
  dim's hole with it. `export_versions` measures this for a version
  (ADR-122); nothing measured it for the project itself.
- **O. An export never replaces a file.** The superseded 16:9 file stayed
  beside the fixed one, which had to take another name; no tool deletes
  a file.

## Decision

### An ad element's rows are its own (F)

A row whose every clip is a grouped part named as the row is (an "End
card" part on an "End card" row) belongs to that element: placement
(`placeStack`, lib/overlays.ts) never lands a title, shape, sticker,
template or callout there, free or not; it inserts a row of its own
instead (directly above what shows then, as before). Only the element,
or another of the same name, reuses it (ADR-121). A clip moved onto the
row by hand makes it an ordinary row again. Measured: the tester's pills
and titles land on one "Titles" row and the callouts on two "Callouts"
rows; each "End card" row holds its one part.

### An end card is laid out for the room it has (G)

`addAdElement` (lib/ads.ts) fits an element to its room by bisection
instead of a shrink ratio: the largest size that fits, in two steps. An
end card or a logo reveal first gives up its logo's size, down to half
(`MIN_GIVE`); only then do its type and spacing shrink together, as
little as fits, down to half as before. Other elements shrink whole, also
by bisection. Spacing stays with the type, not with the logo: a version
holds type at its readable size while the rest of a card shrinks, and a
4:5 version of a card whose gaps had given first ran its url into its
button (the ad-versions drive). The fit leaves 1% of the frame's height
above and below, the room for an outline check_project may suggest that
a version keeps for its titles: a card exactly as tall as its room was
pushed past the top of a 16:9 version's safe area for it. A text part's
raster drawn wider than its wrap width (an outline's margin) does not
count against the room, since smaller type would wrap to the same width.
When the type shrank, the answer says how much and what keeps it larger
("To fit the room there, its logo was made 50% and its type 82% of their
size: fewer words, or another position, keep it larger."). A part that
pulses (a button, a badge) is floored so that the bottom of its pulse
stays readable (31 / 0.94, size 33 on 9:16).

Measured on the tester's call, captions at the top band: headline 55
(was 40), button 33 (31), logo 0.12 (0.17), the card filling the room
left under the captions on two lines; check_project has nothing to say
about it. The unit test's measure (0.55 em a character, wrapping at the
width) gives headline 45 (41 on the old code), and 65 (58) for a card
with the whole safe area, its logo smaller first.

`text_overlaps_text` now judges an ad element's text parts (named after
it) against each other, since they are laid out apart: the tester's
enlarged headline over its button is named. A template's parts and a
compound clip's insides are still left alone.

### A join into silence moves; a crossfade already set is never asked for again (I)

`preview_audio` reads, at every join, how long the incoming file is
digital silence (under -60 dBFS) right before its in-point
(`silentBefore`, state/audition.ts; 20 ms or more). Where the join has a
hole and that silence is under it, the edge says so and why a crossfade
cannot help, with `silent_before` in seconds: "an 18.5 dB hole at the
cut: c_...'s file is silent for 0.25 s just before its in-point (7.75-8
s of the file), so the crossfade fades into that silence and a longer one
deepens the hole: move the join where both files sound, e.g. a bar later
(roll_edit to 12 s)". The fix is `roll_edit` (which keeps both clips'
timing, only moving where one hands over to the other) a bar later, or
earlier, where the incoming file sounds before its new in-point and both
clips stay in their files: the bar from the song's grid, or the Bar
markers on either clip. With neither, no fix is guessed and the verdict
says to roll it to a bar line. Measured: with the grid given, the fix
rolls the join to 12 s and the join there measures clean (-2.3 dB), as
the tester's own move did.

A join whose crossfade is already as long as the fix would be is never
told to set it again: the fix moves the join instead, or, with nowhere
measured to move it, the verdict says the crossfade is set and to move
the join. check_project's `click_at_join` reads the same report: its
message names the silence and its fix is the roll (`joinFix`); the Check
tab says "Move the cut where both pieces sound: drag the cut ... a bar
later or earlier with the Roll tool. A crossfade cannot help here."

`cut_music` takes `repeat`: from-to plays that many more times right
after it plays (1 to 16), instead of being cut (`repeatMusic`,
lib/musicCut.ts). Each jump back stops the piece before on the frame at
or before the bar line and starts the next as far before its own
downbeat, as a cut's join does, so the beat runs on exactly whatever the
frames round to; each join gets the cut's 30 ms crossfade. The song grows
by whole bars and every clip after it on its track moves as much; the
picture and other tracks stay (the song is the grid the picture is cut
to). The tester's two hand-built clips are one call: `{from: 8, to: 16,
repeat: 1}` on file 6-54 s plays file 6-16 s, then 8-54 s from 10 s. A
repeat onto a bar with a breath before it has the same silent join, which
`preview_audio` names with its roll. `fit_music` extending by whole bars
was the other way offered; repeat in `cut_music` is the smaller surface,
next to the bars it already takes out.

### A shot added a frame after the one before starts where it ends (J)

`add_media_clip` on the main track (not `insert`), landing exactly one
frame after the end of the clip before it, starts where that clip ends:
its head a frame earlier in its file so it still ends where asked (or
the whole clip a frame earlier when the file has no frame before its
in-point). The answer's note names it: "c_... starts at 49.5 s, where the
clip before it ends: start 49.521 rounded to 49.533 s, a frame of black
after it; its end is where asked." A gap of two frames or more, and
every other track, stay as asked. A black frame on the main track is
never wanted; check_project still names any gap left.

### A callout clicks where it lands on each part (K)

`add_callout`'s `sound: true` clicks as the ring draws on and as it
arrives at each `to`; a step's own `sound` (false or true) wins over the
callout's, so `to: [{..., sound: true}]` clicks one arrival alone. The
clicks land in the same edit, on the effects track, at the arrival's
frame. Measured: the tester's ring with two glides clicks at 6.5, 9.1 and
10.5 s.

### check_project names a callout that leaves the frame (L)

`callout_off_frame` (a warning): a callout (ADR-122's `calloutsOf`: a
pinned ring, dim or label, or a ring or spotlight made by hand) with a
quarter of its box or more outside the frame at some moment, measured
every sixth of a second as the versions check measures a version
(`calloutsOffFrame`, lib/versionCallouts.ts). A ring and its dim are one
finding. It says when the callout starts to leave (where its share
outside first climbs past where it rested before, frame by frame, so a
ring around a part at the frame's edge is not called leaving from its
start) and the fix: trim both to end there, or frame the shot so the part
stays in. The Check tab files it under Timing. Measured on the tester's
ring: 80% outside at 16.87 s, leaving from 16.1 s (the tester trimmed it
to 15.9); trimmed as the fix says, the check is clean.

### An agent may replace a file when it asks, in the folder it names (O)

`export_video` and `export_versions` take `replace: true`, with `folder`
only (refused without it, before anything renders). The export then goes
to its own name in that folder (`agent_dest`, src-tauri export.rs),
written to `<name>.part` and renamed over a file of that name only when
it finishes, as every export is; never over a folder, nor while another
export is still writing that name. The answer's note says "Trip.mp4
replaced the file of that name in that folder, as asked (replace)."
Without `replace` nothing changes: the first free numbered name, with a
note. ADR-095's rule that an agent never replaces a file still holds
unless the agent asks, by name, for the folder it chose: what it can
already read and write there is unchanged, and a superseded export of its
own no longer has to be left beside the new one for a person to clean up.

## Consequences

- Rows: a project with an ad element gets a "Titles" or "Callouts" row
  where those used to fill the element's rows; elements keep theirs.
- End cards and logo reveals in a short room keep larger type and a
  smaller logo; a whole-frame card on 9:16 keeps more of its role sizes
  with a smaller logo where it used to shrink everything alike. Pulsing
  buttons and badges at the floor are two sizes larger on tall frames.
- An end card's parts overlapping by hand are a warning now.
- `preview_audio` decodes up to a second of the incoming file before
  each join (and 50 ms at up to two roll targets where it is silent).
- `cut_music` answers a note for a repeat; the clip after the repeated
  bars is a new clip on its track.
- `add_media_clip` may answer a note and move a main-track clip by one
  frame.
- check_project measures every callout every sixth of a second it shows.
- ponytail: the silence is read in the incoming file only (the outgoing
  fades within its own clip); a roll target is a bar from the grid or a
  Bar marker, not a beat; `repeat` needs the song at its own speed, as
  cut_music does; the off-frame check reads callouts on the project's
  timeline, not inside compound clips (ADR-122's limit).
- Not tested on the desktop: `replace` (the web build refuses agent
  exports). Its Rust (`agent_dest`, the commit's rename over the old
  file) has unit tests, and the page side is checked by `mcp.test.ts`
  and the export drive.
- Tests, each failing on the code before: `src/lib/film4Fixes.test.ts`
  (titles and callouts off the end card's rows; the end card under
  captions at headline 45, its button at 33, a whole-frame card at 65,
  an enlarged headline over its button named; the frame of black closed
  with its note; clicks on each arrival and per step; callout_off_frame
  found, words, and clean once trimmed; the silent join's verdict, fix,
  no repeated crossfade, the check's message, fix and words; cut_music
  repeat once and twice, on bars off the frames, refusals; the replace
  note), `src/lib/mcp.test.ts` (replace passed on, refused without
  folder), and `export.rs`'s `agent_exports_replace_only_when_asked_and_only_a_file`.
- Checked through the web build's MCP server with the tester's arguments
  and media, before and after: every number above. Drives: ad-elements,
  ad-spot, ad-versions, callouts, sound-joins, cut-bars, crossfade-drop,
  fit-music, check-joins, check-panel, check-measured, export,
  export-versions, versions-stack, mcp-io-surface, template-placement,
  stickers, graphics, music-trimmed, film3-fixes and duck-open pass.
