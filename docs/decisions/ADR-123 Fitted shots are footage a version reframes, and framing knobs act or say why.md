# ADR-123: Fitted shots are footage a version reframes, and framing knobs act or say why

**Date:** 2026-10-21. **Status:** accepted. Builds on
[[ADR-097 Checks and versions judge by the picture]] (the subject crop and `focus`),
[[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]] (`overrides`),
[[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]] (`pushes`),
[[ADR-120 Callouts and overlays pinned to footage, and frame_region moves]] (anchors, frame_region) and
[[ADR-122 Versions crop around what the editor framed, and callouts stay on what they point at]] (callouts in versions).

## Context

Claude film test 4 (2026-10-21) made a 58.5 s vertical how-to from
2560x1440 screen recordings through the MCP tools: a 9:16 master whose
interface shots are `frame_region` fit push-ins (the recording spans the
frame's width, dark bands above and below, pushes up to 3.03x) with
`add_callout` rings pinned to them, then asked `export_versions` for its
16:9 version. Its report's items M, N and B and top fixes 1 and 2:

- **M.** The 16:9 check listed four rings and their dims off the frame
  (100% at 10 s, 27% at 33.33 s, 36% at 36.3 s, 90% at 44.47 s). The
  suggested `focus {clip_id, x, y}` changed nothing, `pushes: relax` and
  `hold` changed nothing, and no answer said so. An override `{clip_id,
  y}` on a shot left its pinned rings behind (named off their target).
  The shots that passed came out as small pictures floating in black, and
  nothing flagged it. Its reading: clips that do not fill the 9:16 master
  are not treated as footage.
- **N.** `frame_region` in a batch, in the saved version, answered "c_...
  was moved by hand, so it is pinned there now: it follows c_...'s
  picture at x 0.15, y 0.522 of its source" for every ring, while each
  kept gliding through its regions.
- **B.** `frame_region` slides a zoomed region back to the picture's edge
  when the picture overflows the canvas, so on 9:16 past about 3x the
  timeline at the bottom of a recording landed in the apps' buttons and
  the Import button under the captions.

Reproduced first in a unit test of the tester's master rebuilt from its
calls (30, 33, 48, 49, 53 and 87): exactly its four rings and dims off
the frame, at the same moments and shares. Causes:

1. **A fitted shot was neither footage nor a picture.** `fullFrame` asks
   for 97% of both axes; a 16:9 recording in a 9:16 frame at 3.03x covers
   96% of the height. At 2.08x (1266 px of 1920) it was an overlay:
   `placeSets` laid it out as a picture-in-picture, 1728 x 972 centered on
   16:9. At 3.03x it was neither: its scale kept its pixels and its
   position kept its fraction of the frame, so `x 1.015` (1096 px of a
   1080 frame) became 1949 px of 1920 and the picture slid off, its rings
   (rewritten from it, exactly) with it. `reframeShot`, where callouts and
   `focus` decide the crop, was never called for either.
2. **focus and pushes act only in `reframeShot` and on full-frame shots**,
   so on these shots they did nothing, and nothing reported a knob that
   did nothing.
3. **Overrides came after the callouts were written** (`reanchor` and
   `followCallouts` run inside `reshape`), so a moved shot left its rings.
   The keyed pan itself was offset, not flattened (its y keys stayed four
   distinct values, each moved by the override): the shot had been laid
   out as a picture-in-picture, and the sheet's three moments looked alike.
4. **A full-frame pull-back past covering floated too**: 02-timeline-play
   pulls back from 4.17x (covering) to 1.92x (bands); the full-frame rule
   scaled every key by the ratio of the covering scales, 1213 x 682 px on
   16:9 at the end of the reveal.
5. **N: a batch follows twice.** `runCommand` runs `followAnchors` after
   each step and again around the batch; the outer pass saw the inner
   pass's rewrite of the ring as a change the edit made and re-pinned it
   "by hand". The note named the anchor's middle at one frame, though the
   ring glides through five regions.
6. **B:** `regionTransform` always clamps the position so no band shows.

## Decision

### A shot fitted with bands is footage (fix 1)

`fittedShot` (lib/versions.ts): a video or picture (not a sticker) whose
picture spans the master's frame edge to edge on one axis (97%) and
covers its middle (the central tenth both ways), at its first frame or at
one of its position or scale keys; not a window (no crop, closed mask or
border, not in a group, not pinned, not turned); and no picture under it
covering the frame's middle at its middle frame (a band of footage or a
square logo over a background is a layout: the film test 2 porthole and
the Roast logo stay pictures). The rule takes the tester's suggestion
(covering the center) and adds "spans an axis" so a large floating window
stays a window, and "nothing under it" so a stacked layout stays one.

A version treats it as a full-frame shot: not an overlay, looked at for
its subject, and with fill framed by `reframeShot` (callouts, else the
region the master frames, else the subject; `framesRegion` also counts a
fitted push past the frame by 1.1x on its long axis). Its size: **its
pixels against the short side** (its interface as readable on a phone as
in the master: 16:9 and 9:16 share the 1080 short side), grown where that
would not cover the new frame at its widest. On the tester's 16:9 the
media library at 3.03x stays 3273 px wide and shows 0.59 of the
recording, close to the 0.5-0.62 the tester framed by hand; covering the
frame at the least zoom instead would have shown the whole recording and
undone every push. **Every shot with fill** (full-frame too) now grows to
cover the new frame at its least scale (cause 4); a shot that always
covers is unchanged, since its covering ratio already does.

### focus, pushes and overrides act on every clip they name, or say why (fix 2)

- **focus** applies to fitted shots now. Several points for one clip, each
  with `at` (master seconds), make a path: centered on each at its time,
  held until the next, moving to it over the 0.4 s before (`focusAt`,
  `FOCUS_GLIDE`), as an `add_callout` ring glides. Callouts already lead
  the crop this way without a focus (ADR-122), which is "follow the
  callouts"; a focus replaces that on its axes. The off-frame callout
  report's hint now carries the moment (`focus {clip_id, x, y, at}`).
- Every version's answer (the check sheet's, each exported file's, each
  saved project's) carries **`options`**: a focus on a clip the version
  does not frame by it, and why (no such clip, a compound's inside, the
  shape kept, a title or shape, fit `blur`/`fit`, a picture-in-picture
  with the override that places it); an axis the shape shows whole; a
  point held back, with where and when ("focus x 0.98 on c_... is held at
  0.293 at 6.5 s: the frame stays on the picture and around what the
  master showed of it"); `pushes` that found no keyed zoom; and what an
  override carried.
- **overrides** carry what points into a picture they move or resize:
  hand-made rings and spotlights through `followCallouts`, pinned clips
  through `reanchor`, except clips an override placed themselves
  (`carryPinned`), and `options` names them.

### Footage left floating small is named (fix 3)

`coverageReports`: every half second of a version, the share of its frame
the footage covers (videos and pictures, half opaque or more, by what
their masks show, on a 24 x 24 grid; a blurred fill covers all) against
the master's at the same moment of the largest picture showing. Under 0.7,
and 0.15 or more under the master's, it is reported once a clip at its
worst moment as `coverage` `{clip_id, at, covered, master, note}` with
what enlarges it (an override's scale that gives it the master's share,
or fit `fill` where fit `fit` was asked), and the check sheet outlines
the picture with "footage covers N%". On the tester's master nothing is
named now; a bordered window that filled 83% of the 9:16 frame is named
at 53% on 16:9.

### frame_region places a region anywhere (fix 4, item B)

`place_at {x, y}` (canvas fractions from its center, as positions are;
top-level, or per move in `moves`) puts the region's center there at any
zoom instead of sliding the picture back from its edges, a band showing
where the picture runs out (`regionTransform`'s `at`). `{x: 0, y: 0}` is
"allow bands" centered. The tester's timeline track at 3.85x on 9:16 sits
at -0.05 from the middle instead of 0.28 below it, in the apps' buttons.

### What is pinned is described as it is (item N)

`followTimeline` takes a pinned clip as moved by hand only where its
values are not what its anchor writes now: what a follow wrote (an inner
step of a batch, an `edit_compound` step, the store's edit around a
command) is not a hand. A real hand move's note says where the clip
follows as it is: a point, a region, or "through its 5 regions, each
moved as much (the region {...} of its source at 10.5 s, where it was
moved; describe_project lists them all)" (`pinnedWhere`).

## Consequences

- The tester's 16:9 check names no callout off the frame or off its
  target; every interface shot covers the frame, the push-ins kept, each
  ring on its part (Import, the Media tab, the Speedboat card, the plus,
  the ruler, the scissors, the trimmed edge, the Text tab, the Title
  card, Letter rise, Word pop, the Export button and its glide to the
  Preset field, Loudness).
- A 9:16 how-to's 16:9 version is closer than before but still a crop of
  a tall edit: a push that framed a column now frames the same part at the
  same pixels, wider around it. `focus` paths and `pushes` are the knobs,
  and they say when they cannot move.
- ponytail: a fitted shot is recognized on the project's timeline and in
  whole-scene compounds, not inside picture compounds; the "nothing under
  it" test is at the shot's middle frame; `coverage` counts footage on the
  project's timeline (not inside compounds) and maps a cut-down's clip by
  its own frames; a focus path's `at` is converted to the clip's frames
  before a cut-down moves it, a callout report's `at` is the version's
  time; a fitted shot with fit `blur` or `fit` keeps its scale against the
  fitting size, as a full-frame shot does.
- Tests, 10 of 11 failing before (the other guards a band over a
  background staying a picture), `src/lib/versions.fitted.test.ts`: the
  tester's master rebuilt from its calls on 16:9 (no callout reports, every
  interface shot covering the frame at its master pixels, the Media tab
  ring inside the frame at 10 s, no coverage report); focus on a fitted
  shot and a path with at (centered at each time, moving over 0.4 s);
  options for a title, a missing clip, a held point and the master's shape;
  pushes relax on a fitted push and the note when there is none; an
  override offsetting keys and carrying its ring and dim; a framed window
  named in coverage; place_at holding the tester's timeline track mid-frame
  at 3.85x, also per move; a batch frame_region with no hand notes and a
  real move of a gliding ring described as its five regions.
- Checked on the web build's MCP server with the tester's master rebuilt
  from its calls (its footage, frame_regions, titles, brand, end card and
  nine callouts; captions three words at a time where its voice's sat):
  the 16:9 sheets at its own eight moments and at every callout's moment,
  `pushes` relax and hold, its `focus` and `overrides` calls (answers in
  `options`), `save_projects` and its call-102 frame_region batch in the
  saved version (no notes, rings on their parts), `place_at` on the cut
  shot, and a bordered window named in `coverage`. Drives on the web
  build: export-versions, versions-subject, versions-stack, ad-versions,
  callouts, auto-reframe, edited-structure, borders, export-shape and
  mcp-io-surface pass.
