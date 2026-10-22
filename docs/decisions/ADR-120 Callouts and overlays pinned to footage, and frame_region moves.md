# ADR-120: Callouts and overlays pinned to footage, and frame_region moves

**Date:** 2026-10-21. **Status:** accepted; versions crop around anchored clips' targets, leave them out of their layout and reanchor them since [[ADR-122 Versions crop around what the editor framed, and callouts stay on what they point at]]; a callout clicks on each glide's arrival, and check_project names one that leaves the frame, since [[ADR-125 Elements keep their rows and their room, joins into silence move, callouts click on each part and stay in frame, exports replace when asked]]. Builds on
[[ADR-052 Agents read what changed and export without a dialog]] (frame_region),
[[ADR-057 Shape layers are color clips with a shape]],
[[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]] (markers that follow a clip),
[[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]] and
[[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]] (masks).

## Context

A Claude Code session made a 70 s product explainer from 2560x1440 screen
recordings through the MCP tools (Claude film test 3, 2026-10-20). Guiding
the eye on dense UI footage took hand work. From its report:

- **1. `set_mask` with `at` on a mask with no keys did nothing.** The
  tester moved a spotlight's hole from the Split button to a clip's edge
  with two calls at 15.45 s and 15.85 s. The second call overwrote the
  static values: the hole sat on the trim point the whole time and the
  answer said nothing. The description said "animated values get a
  keyframe at `at`", which a model reads as "values I want animated".
- **2. No callout tool.** A ring that draws on with the rest dimmed was a
  full-frame black rectangle with an inverted mask plus a separate
  outline shape with `shape.draw` keys: two layers synced by hand, 16
  keyframes per move.
- **3. Overlay coordinates do not follow footage zooms.** Overlays are
  placed in canvas fractions, frame_region takes source fractions, so
  every callout was computed by hand from the zoom's region and corrected
  by eye on stills. The same gap broke the 1:1 version (item 4): crops
  and layout rules moved the footage and the callouts apart.
- **12. frame_region takes one move per call.** A push-in then a pan
  needs hand keys, since the second call replaces the first.

Its top fixes 1, 2 and 4 are these.

## Decision

### set_mask at keys what it is given

With `at`, each value given is keyed there. A value with no keys yet
first gets a key at the clip's start holding what it had, so the
tester's two calls (the same values where the hole leaves, the new ones
where it lands) move it; at the clip's start itself the value is simply
set (`keyFrom` in `lib/commands.ts`). On a mask the call itself makes,
`at` has nothing to key from: the values hold from the start and the
answer's notes say so. `set_param`, `set_shape`, `set_border` and the
rest keep their documented behavior (`at` keys a keyed value only).

### frame_region takes a list of moves

`moves: [{region, at, ease?}]` replaces `region`, `to_region`, `from`
and `to` (giving both is refused). Each region fills the frame at its
`at`; the picture moves there from the move before with that move's ease
(default easeInOut, any keyframe preset); before the first it holds the
first. A hold is the same region again, so a push-in and a later pan is
four moves. Keyframe semantics on purpose: the list is literally the
keys the clip gets, as a model reads them back. Moves out of order, a
frame apart or less, or outside the clip are refused by number. The one-
and two-region forms are unchanged (`frameRegion` now calls `frameMoves`
in `lib/align.ts` with one or two moves, writing the same keys).

### Overlays pinned to footage: an anchor, and keys written from the footage

A visual clip may carry `anchor: {clipId, keys, pad?, mask?}`
(`lib/project/types.ts`): a point of another clip's picture in fractions
of its uncropped source (frame_region's units), or a region of it
centered there. `add_text` and `add_shape` take `anchor: {clip_id, x,
y}` instead of x and y; `set_anchor` pins existing clips or unpins them
(`none`).

The anchor is resolved into ordinary values and keyframes, not at render
time. Written keys need nothing new from the renderer, align, the
viewer's handles, check_project or versions, which all read positions;
a render-time parent would have needed each of them to learn it, and
versions' layout writes positions. `lib/anchors.ts` writes:

- a point anchor: the clip's `transform.x` and `transform.y`;
- a region on a shape (a callout's ring): its position and
  `shape.width`/`shape.height`, plus `pad` pixels at 1080p on every side;
- a region with `mask` (a callout's dim): its mask's x, y, width and
  height, in its own picture's fractions.

**The keys are exact where they can be.** A point's place on the canvas
is linear in the footage's position and scale, so where the footage
moves by keys that share their frames and ease (frame_region's always
do), the point moves by the same ease between the same frames: one key
each end. The stretches between every frame where the footage's keys or
the anchor's glides turn are classified: held, one eased key, or sampled
(a turn, an anchor point under a zoom, keys that do not line up, or a
glide during a zoom, whose product is no single ease) every frame and
thinned to a quarter pixel. A move that starts before the overlay or
ends after it keeps its own frames (keys outside the overlay's span, as
after a head trim), so it stays exact. The tester's push and Split ring
write two keys per path; a glide during a pan writes about one a frame
for its 0.4 s.

**They follow after every edit.** `followAnchors(before, after)` runs
where a song's markers follow their clip: after every registry command
(`runCommand`, so each batch step and edit_compound's inner command too)
and in the store's `edit`, `editDocument` and gesture previews, so a
drag, a slider or an inspector edit of the footage carries its overlays.
It writes every anchored clip from its footage on the project's timeline
and inside each compound; an edit that changed nothing anchored is
untouched. The anchor's clip must be on the same timeline and not
pinned itself; one whose clip leaves the timeline (deleted, put in a
compound alone) is unpinned where it stands, with a note.
`reanchor(p)` writes them all regardless of hand edits, for code that
moves footage outside the edit path.

**A hand's move re-pins.** A pinned clip whose written values the edit
itself changed (its anchor, start and length the same) was moved by a
person or an agent: rather than overwrite that silently or unpin it,
its anchor moves by as much, read at the frame the edit changed most
(`regrip`), so it keeps following from where it was put; a region's size
scales the same way. Its group's other part with the same anchor (a
callout's dim, when the ring is dragged) takes the same anchor, so the
hole goes with the ring. Agents hear it in the answer's notes. As a
marker moved by hand stops following its song (ADR-101), the hand wins;
here the clip stays pinned because that is what a person dragging a
callout onto a button wants.

### add_callout: a ring and a dim, grouped, pinned

`add_callout {clip_id, region, shape, dim, draw_on, at, duration, to,
color, stroke_width, sound}` builds two shape layers (`lib/callouts.ts`):
the dim, a full-frame black rectangle at opacity `dim` (default 0.5; 0
leaves it out) whose inverted mask (rectangle, rounded, or circle for a
ring) is the hole, fading in over the draw-on; and above it the ring, an
outline-only rectangle, rounded rectangle (corners 0.35, as add_shape's)
or ellipse in the brand kit's accent (6 px), drawing on over `draw_on`
(0.35 s, easing out) and fading out. Both are anchored to the same
region with 6 px of room, so the ring sits on the hole's edge and clear
of what it circles. `region` is source fractions of the footage, as
frame_region takes them, so a model gives the button's own rectangle.
`to: [{region, at, glide?}]` glides both on: each arrives at its `at`
over `glide` seconds (0.4), holding where it was until then; an arrival
is the moment a voice names the next part.

A group, not a compound clip: the parts stay ordinary shapes the
inspector, set_shape, set_param and the version layout already know,
they select, move, copy and delete together, and an anchor needs its
footage on the same timeline, which a compound's insides are not.

`sound: true` places a soft click (the built-in click, volume 0.35) on
the effects track where the ring starts drawing, in the same undo step.
The click's file is made on this computer, outside the pure registry, as
add_sound_effect's are: `window.videoEditor.exec` (and so MCP) makes it
first; inside a batch the call needs a project that has the click
already, and says so otherwise.

### A person adds and sees them

- Library > Adjustment > **Callout** (and dragging it onto the
  timeline) adds a rounded callout on the video under the playhead,
  around the middle of what the viewer shows, and selects the ring:
  dragging it onto its part moves the hole with it (re-pinning above),
  and the Shape section sizes it.
- Animation > Tracking says what a layer is pinned to, with **Unpin**
  (both parts of a callout), or **Pin to footage** at its center on the
  video under it. Icons: Pin, PinOff and Scan ([[Icons]]).
- `describe_project` shows each anchor in the tools' terms (a point, or
  a region by its top-left corner, and its glides at timeline seconds).

### What it gives export_versions

Versions are another lane. Measured on a 1:1 version of the tester's
Split callout: the layout moves the ring to stay in the frame while the
subject crop cuts the button out, so they part (the report's item 4).
`reanchor(versionProject(...))` puts the ring back on the button's
point exactly. The versions lane should call `reanchor` after reframing
footage and leave anchored clips out of its overlay layout; a saved
version project re-pins on its first edit already.

## Consequences

- An explainer's callout is one call that lands on the word, stays on
  its part through any later zoom or pan, and glides to the next part;
  a label pinned to a button stays above it. frame_region's push and pan
  is one call. set_mask with at does what the tester expected.
- Anchored clips' positions are keys like any other: answers and
  describe_project show them (dense where a glide crosses a zoom).
- Every edit walks the clips once to find anchored ones (none: nothing
  more).
- ponytail: the footage's in and out animations, wiggle, stabilization
  and tilt are not followed (rare on screen recordings); a callout's box
  stays upright on a turned picture; an overlay over a split shot
  follows the first half's keys past the cut (the halves keep the same
  keys until one is changed).
- Left open: `set_shape`, `set_border`, `set_shadow`, `set_tilt` and
  `set_param` still key only values that have keys (their descriptions
  say so); a callout could follow a tracked subject (track_motion) rather
  than a still point; a whoosh on a glide.
- Tests, each failing before: `src/lib/anchors.test.ts` (frame_region
  moves, the single form unchanged and refusals; set_mask at from the
  tester's calls and the new-mask note; anchors exact through a push
  that starts before the title, following a moved shot, unpinned when it
  is deleted, refusals, a turn sampled within half a pixel, re-pinned by
  a hand, describe_project and set_anchor, reanchor; add_callout through a
  push and a glide against where the renderer draws the region, the
  group and its layers, following a later frame_region, the hole moving
  with a moved ring, refusals, the click). The drive `callouts` checks
  real pixels on green-screen.mp4: the ring 6 px outside the box's corner
  in the accent color, the corner undimmed inside the hole and the green
  dimmed past the ring, through a push, a pan and a glide; a hole moved
  by set_mask at; the click; the library card, the inspector's Pinned
  line and Unpin.
- Checked on the tester's footage through the web build's MCP server:
  03-cut.mp4 at 1.4x, a push into the timeline and a pan in one
  frame_region call, add_callout on the Split button gliding to the
  trimmed edge with a click, and a "Split" label pinned above the
  button; the ring stays on the button through the push (and when the
  push was moved under it afterwards) and lands on the edge.
