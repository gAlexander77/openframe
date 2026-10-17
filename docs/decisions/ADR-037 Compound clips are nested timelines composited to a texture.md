# ADR-037: Compound clips are nested timelines composited to a texture

- **Date**: 2026-10-16 · **Status**: accepted

## Context

CapCut's **Create compound clip** (Alt+G) turns a selection on any tracks
into one clip; its speed, color, motion and effects then act on the group,
a double-click edits what is inside, and **Undo compound clip**
(Alt+Shift+G) puts the parts back. Premiere's Nest does the same with a
nested sequence: opacity and blend apply to the nest's *composited*
picture, which is why editors nest two keyed layers to fade them together.
Resolve's *Decompose in Place* is the undo. Kdenlive shares one profile
(frame rate, size) across every sequence; reviewers call CapCut's version
"limited" mainly because a nest cannot be opened in place
([[research/CapCut desktop]], [[research/Professional NLE features]] §1.3).

## Decision

**The format.** A nested timeline is a `Compound` (`id`, `name`, `tracks`,
`markers`) stored flat in `Project.compounds`; a `CompoundClip` (type
`"compound"`) plays one the way a video clip plays a file: `in` is seconds
into the inner timeline, `speed` its rate, and it has every visual and sound
setting a video clip has. Every compound shares the project's frame rate and
canvas, so inner frames are whole frames of the same rate and a frame-rate
change rescales them all at once. `normalizeProject` refuses a clip of a
missing compound and a compound that plays itself, even through others.
Absent `compounds` means none: older projects load unchanged.

**Pictures.** `layerAt` gives a compound clip a source of kind
`"compound"` that carries its nested timeline's plan at the inner frame it
shows (`planTracks` again, one level down). The compositor composites that
plan with a deeper level of framebuffers and copies the result into a
texture of the layer's own; the layer shader then reads it as a
premultiplied, bottom-up texture. So the compound clip's transform, crop,
opacity, blend, color, mask, key, effects and transitions act on the nested
timeline's picture, and preview, export, stills, scopes and the filmstrip
all get it from the one plan. Nested layer ids carry the path of compound
clips that show them (`outer/inner`): a compound played twice (after a
split, or pasted) gets a decoder per appearance.

**Sound.** `soundingClips` moves the inner timeline's sounding clips to the
outer one through the compound clip (`throughCompound`: start, length,
fades, keyframes and speed-curve points scale by the compound clip's speed)
and lists the compound clips each plays through; its gain is multiplied by
theirs and it is cut to their spans. The scheduler and export mix them like
any clip. Solo picks among each timeline's own tracks.

**Editing inside.** The store's `project` is the timeline being edited:
inside compound clips (`nest`), a view whose tracks and markers are the
innermost compound's. Every op, command, inspector and drag works on it
unchanged. `store.document()` puts the whole project back together for
saving, export, OTIO and agents. Undo entries hold the whole document, so
one history covers every level: an undo at the project's timeline takes
back an edit made inside, and only an undo that removes the open compound
steps out. An edit that would make an open compound play itself is
refused. Export renders the project, with its own range, wherever the
editor is; a still frame is what the viewer shows.

**Create and break apart.** The selection becomes one compound clip on the
lowest selected video track, spanning it, with one inner track per track
the clips came from; transitions between selected clips come along, a
group the selection splits stays outside. Break apart puts the inner clips
back at the frames the compound clip showed them, trimmed to its window,
keeping their ids (and groups) where free; the compound clip's own settings
go with it, as in Resolve. A compound nothing plays is pruned from the
document.

**Agents** get `create_compound_clip`, `break_compound_clip`,
`edit_compound` (run any command inside a compound's timeline) and
`rename_compound`; `describeProject` lists compounds with their tracks.
`window.videoEditor.exec` runs on the whole document, whichever timeline
the user has open.

Rejected:

- **Flattening the nest into the outer plan** (inner layers transformed by
  the compound clip's transform). Cheaper on the GPU, but opacity, blend,
  effects and masks would act per inner layer, not on the composite, which
  is exactly what Premiere users nest to get.
- **Compounds as media assets** (CapCut's Subprojects, Resolve's media pool
  compound clips). There is no listing to manage them from yet; keeping
  them out of `assets` keeps every asset a file.
- **A separate undo history per open timeline.** Undo would depend on which
  timeline is open, the surprise the research notes warn about.

## Consequences

A compound clip costs one more composite of its inner layers per frame and
six canvas-sized framebuffers per nesting level (48 MB at 1080p), made on
first use. Thumbnails are rendered by an offscreen compositor
(`engine/compoundThumbs.ts`), at most ~60 per compound, cached per
compound object, so an edit inside renders them again.

`ponytail:` a compound clip takes a constant speed only: speed curves,
reverse and freeze need composed time maps in the audio mixer, so the
inspector and commands refuse them (ramp the clips inside instead).
Through a sped-up compound clip, inner sound follows the compound clip's
Change pitch. Transitions keep a hard audio cut on compound clips.
Breaking apart when the bottom inner track cannot fill the main track
puts it above, and the magnet closes the gap. `scripts/drive/compound-clips.js`
proves pixels, scopes, thumbnails, export frames and tone onsets match the
un-nested timeline, and open, save, undo and break apart.
