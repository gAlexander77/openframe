# ADR-116: New titles land on top, masks say where they end, wider versions keep the master's framing

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-073 Templates land as a block and the web keeps what it imports]]
for where overlays land, [[ADR-097 Checks and versions judge by the picture]]
and [[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]]
for versions.

## Context

A fresh Claude Code session made a 46.5 s vertical short and its 16:9 cut
through the MCP tools (Claude film test 2, 2026-10-20). This ADR answers
the layering, mask and version items of its report, each reproduced from
the call log, in unit tests and through the web build's MCP server on the
launch footage:

- **Track placement surprised it (8).** In a batch, `add_text "FOLLOW"`
  with no track_id landed on the Porthole track: under the grade's
  adjustment layer and under the pill shape just put on the Titles track,
  so the word was hidden under its own button. `add_text` used the
  landing for media (the first free track from the top), while shapes and
  stickers already landed above everything showing then. And
  `add_beat_hits` put its Hits track above the Titles track (its help says
  below the titles), so the zoom punches zoomed the hook title: hits went
  above the topmost track holding a video, compound or color clip, and a
  title card built as a compound or a pill shape counted.
- **A circle mask on 16:9 media needed aspect math, and clipped flat in
  silence (14).** Mask sizes are fractions of the picture's width and
  height, so a round porthole on a 16:9 picture is width 0.44, height
  0.782. With y 0.2 the circle reached 0.591 of the picture's height from
  its center, past the edge at 0.5, and drew with a flat bottom; the answer
  said nothing.
- **The 16:9 version kept the vertical push-ins and cut the rocket (19).**
  The tester gave `focus` x 0.5 on the launch shots to center the rocket;
  the rocket came out left of center (0.385 of the width in the file). A
  version keeps its frame inside what the master showed (ADR-097). A 16:9
  frame is wider than a 9:16 master's column, and the clamp that keeps a
  narrower frame inside put the frame's left edge on the column's left
  edge (center 0.78, held at 0.59 by the picture's edge), whatever the
  focus asked. Separately, the master's push-in (frame_region from the full
  height to 0.82 of it) crops the picture's top and bottom in the version
  exactly as in the master, the nose with it; on 9:16 that reads as a
  close-up, on 16:9 as a mistake. The porthole picture-in-picture sat under
  the 16:9 version's burned captions, and neither the sheet nor the export
  said so.
- **No way to look at an exported file (24).** Previews render the
  timeline; the files themselves could not be seen.
- **"LA_T NOTE" in the 16:9 file, 40-43 s.** Frame by frame (ffmpeg, 30 fps)
  the label's letters are drawn above the rocket in every frame: no copy
  of the subject (text_behind_subject was not used), no track above the
  titles. The rocket shows through the label's box (55% opaque) as
  designed. The S disappears only in the label's 0.2 s fade-out, where
  its yellow at about a quarter opacity lies on the rocket's white nose
  cone. The nose was under the S because of the focus clamp above: in the
  9:16 master and in a fixed version it passes behind the space between
  LAST and NOTE.

## Decision

### A new title lands above everything showing then

- `add_text` without track_id lands as `add_shape` and stickers do
  (`placeOnTop`, lib/overlays.ts): directly above the topmost track that
  shows anything during its time, holds footage, or is a row of
  adjustment layers (hits, bars, a grade) at any time, so a title never
  sits under a row that is only empty for now. It shares the free row
  above that when one is there (titles one after another stay on one
  row), else a new row named Titles is inserted.
- An overlay never joins a row of adjustment layers or a row of captions.
- A title card built as a compound is a graphic, not footage
  (`isFootage`: video, pictures other than stickers, and compound clips
  that play some), so titles may share its row.
- A title, shape or title card placed on a track the caller names
  (`add_text`, `add_shape` and `move_clip` with track_id) that sits under
  an adjustment layer says so in the answer's notes: which layer, on
  which track, over which seconds, and how to put it above.

### Hits and bars act on footage

`add_beat_hits` goes above the topmost track holding footage or a solid
color, never a title, shape, sticker or title card (`isPicture` in
lib/epic.ts); `add_cinematic_bars` above that and the hits. A titles track
holding a title card and a pill now stays above the hits, as their help
says. Reproduced: on the tester's stack the Hits track lands between the
Porthole and the grade, and the 4 s punch leaves the title card still.

### A mask can be round on any picture, and says where it ends

- `set_mask` takes `aspect`, the mask's width over its height in pixels:
  1 is a round circle or a square on any picture. Its height follows its
  width (or the mask's own width); a height given alone sets the width
  (`sizeForAspect`, lib/mask.ts). Width, height and aspect together are
  refused.
- After every `set_mask`, a closed mask (circle, rectangle, heart, star;
  not inverted) that reaches past the picture's edge is named in the
  answer's notes: the edge, how far it reaches, and the x, y or size that
  keeps it whole (`maskReach`: the mask's box turned with it). The
  tester's porthole: "runs past the picture's bottom edge (to 0.591 of its
  height from the center; the edge is at 0.5), so it is cut flat there:
  y 0.109 keeps it whole."

### A wider version keeps all the master showed, centered on it

- A version's frame that is wider (or taller) than what the master showed
  on an axis holds all of it: its center lies where that part stays inside
  the frame, the caller's focus or the subject choosing within that
  (`fit` in lib/reframe.ts). The subject framing already centered it; the
  focus clamp no longer pushes the frame to one side. The tester's focus
  x 0.5 now puts the rocket at the frame's center (960 of 1920, from 747).
- `pushes` on a version (or the call): `keep` (default, as ADR-097),
  `relax` (each keyed zoom of a full-frame shot halved as a ratio over its
  widest) or `hold` (the shot at its widest throughout), applied after the
  shot is grown to the new frame and before it is framed, so the frame
  still holds what the master showed and now shows more around it. On the
  launch, relax shows 4% more above the nose and hold the whole height.
  The default stays `keep`: the vertical crop equals the master's, which
  is the editor's choice, and a version should not quietly change it.

### A version names what it draws across its captions

`captionCollisions` (lib/versions.ts) lists every picture or graphic off
the main track (a picture-in-picture, a shape, a sticker, a card) whose
visible part crosses a burned caption's letters while both show: a masked
picture by its mask's part, not its whole frame (the porthole's circle,
not its 1728 by 972 picture), with whether it is drawn over or under the
captions and the override that puts it above them, scaled when it would
not fit there otherwise ("y -0.341, scale 0.43"). The check sheet outlines
it ("under the captions"); the check answer, each exported version and
each saved version project list it in `caption_overlaps`. Placement itself is
unchanged: a wide version still places overlays as before
([[ADR-063 Versions fit a group as one unit]]); only tall versions keep
overlays above the captions.

### preview_media looks inside a file that is not imported

`preview_media` takes `file` instead of `asset_id`: a path (desktop) or a
URL (the browser build), read where it is and never imported, answered as
the same contact sheet with what the file is (kind, seconds, size, fps,
sound). `export_video`'s help says to look at the delivered file this way.
The desktop reads the path as `import_media` does (the media protocol
registers it); the web build cannot read back a download, so there it is
for URLs.

## Consequences

- Titles added without track_id may make a new row more often (one per
  overlapping title, as shapes and stickers always did) and never land on
  a free row under a grade or the hits. Shapes, stickers, templates and ad
  elements land the same way, so they too now go above a grade or hits row
  and never join one, or a captions row. Tests that expected the first
  free row still pass; the old landing stays for media and adjustment
  clips.
- A version of a tall master in a wide shape shows its shots centered on
  the master's framing; a focus beyond what the master showed is held to
  keep all of it in frame.
- Left open:
  - The collision check flags; it does not move anything. Keeping
    overlays clear of captions in wide versions (as tall ones do) would
    change every wide layout and is a separate decision.
  - The subject check still judges a subject inside what the master
    showed: a push the master made that cuts a subject is not flagged in
    a version that could show it. `pushes` is the remedy an agent chooses.
  - Contrast is measured once a title's in-animation has played and before
    its out (ADR-097), so a fade over a bright subject is not judged; the
    "LA_T" frame lasted a few frames of a 0.2 s fade.
  - `preview_media` reads an export after it is written; the export
    answer itself carries no sheet.
- Tests: `src/lib/layering.test.ts` (the tester's stack: FOLLOW above its
  pill and the grade, rows, notes; hits and bars under the title card),
  `commands.test.ts` (set_mask aspect and edge notes), `reframe.test.ts`
  (focus on a wider version, pushes relax and hold), `versions.captions.test.ts`
  (the porthole under the 16:9 captions, its override, the mask's box),
  `mcp.test.ts` (preview_media file). Each failed before the change.
- Checked through the web build's MCP server: the porthole's flat bottom
  and its note, then round and whole; FOLLOW over its pill above the grade;
  hits under the titles; the 16:9 check with the tester's focus (rocket
  centered, the label's fade on the gap between its words), the porthole
  outlined under the captions and cleared by the override it names; a
  file previewed without being imported.
