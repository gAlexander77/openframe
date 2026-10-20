# ADR-105: Answers hold what was asked, tracked titles center on their letters, pictures take a color

**Date:** 2026-10-20. **Status:** accepted. Builds on
[[ADR-055 The MCP guide is generated from the tools]] and
[[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]].

## Context

A fresh Claude Code session made a 38-second ad through the MCP tools
and reported 22 limits. Four were about answers
and small rendering and catalog choices:

- **3.21: answers too large for the context they cost.** From the
  session's call log (characters of each answer):
  - `describe_project` answered 19,922 for the ad: 12 tracks, 43 clips, 32
    assets, 21 markers and a compound. It was the only way to read one
    clip's in-point or keyframes.
  - `analyze_music` answered 2,658 for a 56-second song, most of it every
    beat, every hit and each beat's energy.
  - `help` topics `ad`, `epic_edit` and `social_short` each ended with
    the whole design-rules block, which `help design` is: 3 KB read four
    times.
  - `help add_voiceover` listed the 24 fields of `add_text`'s style again
    as `caption_style.*` (12,754 characters in all), and so did `set_text`
    and `add_captions`.
- **3.16: a tracked title sat left of center.** A centered NORTHBOUND
  with `letterSpacing: 34` drew about 16 px left, so the tester moved it
  by hand in every version. Measured in Edge: canvas `measureText` and
  CSS both count the spacing after every letter, the last one too (NORTH
  in 100 px Arial tracked 34 advances 523.7 px, 5 x 34 more than
  untracked). A centered `fillText` centers that advance, so the ink sits
  half a spacing left: 17 px there, and -16.0 px for the tester's title
  re-rendered here. The raster was also one spacing too wide on the right,
  so snapping and checks measured it off center too.
- **3.17: warming a white sprite did nothing.** `adjust.temperature`
  70-80 on a white glow left it white (core 254, 253, 212 at 80): white
  balance multiplies each channel, and white is already at the top of
  all three. The tester drew an amber gradient shape instead.
- **3.18: the glow's default threshold, 60, smeared skies.** On the
  launch footage the towers, smoke and pad dome bloomed into white blocks.
  The tester set 88.

## Decision

### Answers hold what was asked

- **`describe_project` takes filters** (`lib/describeFilter.ts`):
  - `clip_ids`: a clip inside a compound is found there.
  - `track_ids`: a track named is listed even when nothing else in it
    matches.
  - A stretch, `start` and `end` in timeline seconds: clips still playing
    after `start` and starting before `end`.
  - `assets`, `markers` and `compounds`: `false` leaves that list out,
    `true` lists all of it.

  When the clips are narrowed, the lists follow them by default:
  - the media the clips shown use;
  - the markers inside the stretch, or the markers that follow the clips
    shown;
  - the compounds those clips play, whole.

  `shown` says how much of each list the answer holds ("1 of 33"), and
  `not_found` names unknown ids. With no argument the answer is the whole
  timeline, unchanged: edits' change answers and `project://summary` are
  built from it, and a model that asks for nothing loses nothing.
- **`analyze_music` answers a summary**, unless asked for `detail: "full"`
  (`lib/musicSummary.ts`). The summary drops `beats`, `hits` and
  `beat_energy` and gives instead:
  - a `grid`: `first_beat`, `beat_seconds`, `bar_seconds`, and
    `off_grid`, the beats more than 25 ms off the even grid;
  - `counts` of beats, bars, phrases and hits;
  - a `detail` line that says when to read the full answer.

  Everything else stays: tempo, downbeats, phrases, sections, drops,
  source and confidence. The grid takes its phase from most of the beats,
  so one stray first beat does not shift it. On the tester's own reading
  `off_grid` names exactly the three beats it noticed a frame late (0.033,
  33.033, 44.533). When many beats stray (a speed curve, a free tempo),
  only the first 16 are named, with a count, and the line says the full
  answer is worth reading.

  Nothing in the app reads the MCP answer's lists. Two drives did
  (`cut-to-beats`, `music-trimmed`), and they now ask for `detail: "full"`.
- **The design rules are given once.** The playbooks end with a pointer
  to `help design` instead of the rules. The MCP prompts (`make_ad`,
  `epic_edit`, `social_short`) still carry them whole, since a prompt
  starts a task once. [[Agent playbook]] prints them once at the top, as
  before.
- **A shared object parameter is listed once, under its owner.**
  `paramTable` knows a title style by its fields (`SHARED_FIELDS`, keyed
  by the schema's `properties` object). Outside `add_text`, the style
  parameter is one row: "its fields are add_text's style (help add_text)".
  The tool schemas in `tools/list` keep every field, because they are the
  contract.

Measured on the web build's MCP server, on a project of 8 tracks, 33
clips, 34 assets, 21 markers and a compound (bytes of the answer's text):

| Answer | Before | After |
|---|---:|---:|
| `describe_project` (no arguments) | 11,666 | the same |
| `describe_project` `clip_ids` (one shot) | refused | 522 |
| `describe_project` 20-26 s, no assets or markers | refused | 1,895 |
| `analyze_music` (38 s clip, grid given) | 1,927 | 896 (full: 1,927) |
| `analyze_music`, the tester's 56 s reading | 2,658 | 1,183 |
| `help ad` / `epic_edit` / `social_short` | 6,957 / 6,613 / 4,025 | 4,088 / 3,790 / 1,156 |
| `help add_voiceover` / `set_text` / `add_captions` | 9,741 / 4,074 / 4,277 | 6,338 / 967 / 1,170 |
| `tools/list` | 216,534 | 219,846 |

`tools/list` grew by 3.3 KB: the filters, `detail` and `set_colorize`.

### Tracked titles center on their letters

The rasterizer (`engine/text.ts`) lays out each line on its letters:
`letterWidth` (`lib/textBox.ts`) takes the trailing spacing off the
measured advance. Every line is then drawn from its left edge at
`lineStart`, so the canvas never aligns the spacing. A centered tracked
line sits on the raster's center, a right-aligned one ends at the pad, and
the raster is as wide as the letters. Preview, stills and export share
the rasterizer.

The on-canvas editor is a textarea, and CSS aligns the trailing spacing
too. `editBox` moves the textarea half a spacing right when it is
centered and a whole spacing when it is right-aligned. It also widens the
area to the word's CSS advance, so the typed letters stay on the drawn
ones and a long word never wraps in the editor.

The tester's title, before and after: -16.0 px, then +1.0 px off center,
the same as the untracked title (its glyphs' side bearings).

### Pictures take a color: `set_colorize`

`adjust.colorize = {color, amount}` is an optional part of a clip's
color, beside the LUT. It works like Premiere's and After Effects' Tint:
the picture's luma times the color, mixed over the picture by `amount`
(0..1). White becomes the color, black stays black, and grays become
darker shades of it.

- It runs first in the color pipeline (`adjustColor`), so the clip's
  exposure, temperature, filter and LUT act on the colorized picture.
- It works on video, image, title, shape and compound clips, and on
  adjustment clips, where it colors everything under them.
- `adjust.colorize.amount` keyframes. Copy and paste of color carries it.
  The Color section's reset leaves it in place, as it leaves the LUT and
  its keys.
- `set_colorize` is the command (an MCP tool) and the inspector's
  Colorize section, under Color in the Adjust tab's Basic pane. The
  section's switch runs the command.
- `colorizeRgb` is the CPU reference for the shader's math.
- The `adjust.*` path note tells a model that temperature cannot warm
  white, and that `set_colorize` can.

Effects were the other route. `duotone` already maps luma to a hue and
would have been keyframable for free, but it takes a hue angle at a fixed
saturation, with a purple floor. A model thinks in CSS colors ("amber",
`#ffb347`), and an adjustment layer should color what is under it the way
a LUT does. Measured on a white solid colorized `#ffb347`:

| Where | Pixel |
|---|---|
| The still | 255, 179, 71, exactly the color |
| Half the keyed amount | 255, 217, 163 |
| Under a cyan adjustment clip | 0, 229, 255 |
| Gray under the same clip | 0, 115, 128 |

### The glow starts at luma 85

The glow's default threshold goes from 60 to 85. At 80, the launch's
towers still streaked and the pad's dome glowed. At 85 only the exhaust
and the tower tips bloom. A stored glow keeps its own threshold: every
add path stores the defaults on the effect, and the renderer reads only
stored params. The beat-hit glow (threshold 50, a 0.35 s flash) and the
logo reveal's glow (45, a flare that fades) keep their explicit values:
their bloom is the point. The guide's `add_effect` example now shows 88.

## Consequences

- A model can read one clip, a track or a few seconds of a long edit for
  a few hundred bytes. The default answer is still the whole timeline, so
  the guide tells a model to ask for less on a long project.
- `analyze_music`'s default shape changed. A caller that reads `beats`,
  `hits` or `beat_energy` passes `detail: "full"`.
- Titles tracked out (wide labels, the minimal template's 26, ad elements'
  4-10) move right by half their spacing: they now sit where they were
  placed. Projects keep their stored offsets. A title nudged by hand to
  make up for the old error (the tester's `transform.x 0.009`) now sits
  that far right of center.
- Left open: the glow samples a sparse 7 x 7 grid 6 px apart, which still
  draws faint vertical streaks above thin bright lines (the towers at 80).
  A smoother kernel would change every stored glow's look, so it waits for
  its own decision.
- Verified by `scripts/drive/tracking-colorize.js`: the title's ink at
  the canvas center in the still, the viewer and an exported MP4 (961 of
  1920, the same as untracked), colorize in the still, keyed and under an
  adjustment clip, and the inspector's switch.
