# ADR-101: A song's markers follow its clip, its grid can be given, and designed layouts refit as designed

**Date:** 2026-10-20. **Status:** accepted.

## Context

The fifth improvements round checked, through the MCP tools as a model
sees them, three things added in earlier rounds but never checked:
compound clips in answers, versions of designed layouts, and music on
edited clips. Measured on the web build's MCP server with the launch
film's footage and its 128 BPM song (Liftoff, synthesized, so its true
grid is known: a beat every 0.46875 s from 0, the drop at 15 s).

**Compound clips.** Edits inside and around nested compounds answered in
98 to 480 characters, a changed compound summed up with only what changed
inside it; `describe_project` listed each compound once (4.7 KB for six);
`open_project` answered a summary. Three faults:

- `duplicate_clips` with `unique: true` copied a card's timeline but not
  the window compound nested in it: `replace_clip` in the copy's window
  changed the original card's window too.
- `open_project` of the project already open, before its first autosave
  (an agent's own new project, mid-edit), failed with "The project could
  not be opened; the app shows why": it loaded from disk before saving.
- `describe_project` showed no mask, crop or disabled flag, so a round
  picture-in-picture or a split screen's half could not be checked.

**Versions of designed layouts** (`export_versions` check sheets and
saved projects on 9:16, 1:1 and 4:5). The masked picture-in-picture kept
its round mask and its subject, and saved version projects opened and
took edits. But:

- A title card built as a compound (a box, a headline, a subhead) was
  refit part by part: on 9:16 the box shrank to 56% of its pixels and the
  headline to 76%, so the headline filled the box edge to edge and the
  subhead sat on the box's bottom edge.
- A split screen whose cropped halves filled the 16:9 frame was stacked
  in the safe column ([[ADR-091 Tall versions stack what stood side by side]]):
  about 60% of the 9:16 frame was black, and the 1:1 and 4:5 versions had
  black bands.
- The lower third's role line, size 49 on 16:9 (the floor, 4.5% of the
  short side), kept its pixels as 28 on 9:16 and 39 on 4:5, under the 31
  and 43 those frames need (5%): `check_project` named text the version
  had made.
- On 4:5 overlays kept to ads.ts's 5% margins while `check_project` judges
  every tall frame by the apps' zones: the lower third landed in the
  bottom 35% and the left 11%.
- A designer adapting a film had no way to move, resize or hide one title
  in one version.

**Music on edited clips.** Markers are absolute timeline notes. After
`analyze_music` marked the song and the clip was trimmed, moved and sped
up, its markers stayed where they were: after the move all 86 Beat markers
were off the song's beats (median 139 ms, worst 1.75 s), after 1.25x 63 of
79; reading it again would add a second grid beside the stale one, and
`cut_to_beats` and `add_beat_hits` cut on both. `mark_beats` read only the
clip's stretch with the old detector and answered the file's seconds and
the file's tempo (128 where 160 plays at 1.25x); `analyze_music` answered
the file's tempo too. The reading itself had the intro wrong: with no kick,
the tracker followed the off-beat hats, so the intro's beats and bars sat
half a beat late (233 ms) and the tempo read 127.4; and the drop was missed
(the drop section starts a bar early, the rise across it under 3 dB). With
confidence at 0.95, 0.86 and 0.93, a model had no cue, and no way to give
the right grid for good: the hints of [[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]]
lasted one call and reached neither `mark_beats` nor `check_project`.

## Decision

### Compounds

- `copyCompound` copies every compound nested in the one it copies, once
  each, so a unique copy shares nothing with the original.
- `openProject` saves first; the project asked for, when it is the open
  one, is then simply open. `list_projects` gives an unsaved open
  project's real length.
- `describe_project` shows a clip's mask and crop as `set_mask` and
  `set_crop` take them, and `disabled`; a new command, `set_clip_enabled`
  (Premiere's Enable), turns a clip off or on, so a textless version's
  titles or a clip a version hid can come back.

### A song's markers follow its clip

- A marker may carry `follows: {clip, at}`: the clip and the second of its
  file it marks. `analyze_music`, `mark_beats`, `set_music_grid` and
  `generate_music` make such markers (`markClip`, `markMusicClip`).
- `followClips` places them again after every edit: in `runCommand` (so a
  batch's next step, or a `cut_to_beats` after a move, sees them right)
  and in the store for every edit and drag. A marker moves to where its
  clip plays its second; to the other half of a split; and goes when
  nothing plays that second any more (trimmed off, the clip deleted).
  Undo brings it back with the rest of the document.
- A second reading replaces the clip's own markers of those kinds, and
  any marker with the same label on the new frames, instead of adding to
  them. A marker moved by hand (`update_marker`, the Markers tab) is the
  user's from then on.
- Edit answers sum up more than 24 markers (count, by label, first and
  last): a song's beats moving with its clip are hundreds.
- `mark_beats` reads the whole song as `analyze_music` does (one reading,
  kept), places its beats through the clip and answers timeline seconds.
  Both answer `bpm` as the clip plays it and `file_bpm` when it plays at
  another speed.

### A song's grid can be given

- `Asset.musicGrid {bpm, firstDownbeat, sections?}`, in the file's own
  seconds, 4/4: `set_music_grid` gives it (with `clear` to forget it), and
  `generate_music` keeps its score's exact grid on the files it makes.
- `analyze_music` and `mark_beats` read the song through it (`gridHints`:
  the call's own hints still win), so every later reading, on every clip
  of the song, is the given grid: tempo and downbeat set the whole grid,
  sections name the parts and the drops.
- `set_music_grid` places the grid's markers on the clip at once from the
  grid alone (`gridStructure`, no audio needed), by default the kinds the
  clip is already marked with, and its answer's note says where the grid
  plays on the timeline (the tempo heard, the first bar, the drop).
- `check_project` judges an epic edit's cuts by the markers and by every
  given grid where its clips play it (`givenBeats`), so a grid needs no
  markers to be checked against.

### The reading keeps one phase

`keepPhase`: when most tracked beats (70%) sit within a tenth of a beat of
one straight line, found by consensus (the beat whose line holds the most
of its 32 neighbors either way, then fitted by least squares and grown),
a run of four or more beats a quarter beat or further off the line is
moved onto it, with the beats either side still on their way back. Where
the song starts and ends is still judged by the beats as heard. Liftoff
now reads 128 BPM, its 86 beats at most 21 ms and its 21 bar lines 17 ms
from the true grid (the tempo's confidence drops to 0.8: the intro's beats
land on no attack); the drop is still missed, which `set_music_grid`
corrects.

### Designed layouts refit as designed

- **A compound clip that draws only part of its frame at rest** (its
  content box short of the frame), like one placed on the frame, refits
  as one picture: its parts keep their layout, and every compound played
  inside a picture compound is part of it.
- **A split screen that filled the frame edge to edge** (side by side,
  every part a cropped cell, together covering the frame) fills the new
  frame: stacked full width on a tall frame, side by side full height on
  a narrower one, each cell's share of the master's width, the gutter
  kept, each cell cut again to its box. Its labels follow their cells
  inside the safe area.
- **Text keeps the readable size** (`readableK`, `keepReadable`): when the
  master's type met the master's floor, a version's never ends under its
  own frame's (`minTextSize`, as `check_project` judges it), raised before
  the set is measured so it is placed at that size; a part of a picture
  compound counts at the size its compound clip draws it. A group that a
  held size makes taller than its room shrinks the rest a little more
  and moves back inside.
- **4:5 is judged as `check_project` judges it**: overlays, wrap widths
  and rooms keep to the apps' column on every frame taller than wide
  (`safeOf`), as ADR-091's stacks already did.
- **Overrides by hand**: a version (or the call, for every version that
  does not say) takes `overrides: [{clip_id, x, y, scale, hidden}]`,
  applied after all of the above (`applyOverrides`): x and y set where the
  clip rests (its transform, keyed motion moved with it), scale multiplies
  its adapted size about its center, hidden turns it off or on. A clip in
  a group carries its group when moved or resized; any clip, inside a
  compound too, by its own id; an unknown id is an error. A saved version
  project keeps them.

Measured again on the same layouts: the title card keeps its margins on
every shape, the split screen fills 9:16, 1:1 and 4:5, the lower third
reads at 31 and 43, and `check_project` finds nothing in the layout of any
version. On the song: after a trim, a move and 1.25x the markers stay
within 21 ms of the true beats, reading again adds none, and `mark_beats`
answers 160 BPM at 1.25x (`file_bpm` 128); with the grid given, Beat
markers are at most 15 ms and Bar markers 7 ms from the true grid and the
drop lands at 10.433 s (true 10.44); `fit_music` to 9 s drops the 47
markers past the music's end, and undo brings them back.

## Consequences

- Markers made by the music tools are bound to their clip; one made by
  hand, or by `add_markers`, is not, as before. Older projects' markers are
  unbound and stay where they are.
- `bpm` in `analyze_music` and `mark_beats` is the tempo heard; a caller
  that wanted the file's reads `file_bpm`.
- A 4:5 version's overlays sit higher and narrower than before; a tall end
  card on 4:5 is fitted a little smaller, its type held at the floor.
- A title card compound wider than a 9:16 safe column shrinks as one, and
  its smallest type is held at the floor, so its lines sit a little closer.
- ponytail: one tempo and 4/4 for a given grid; a song that changes tempo
  needs a grid per part (several clips) until the grid takes a tempo map.
- ponytail: the drop is still found by loudness; a song whose build is
  nearly as loud as its drop (Liftoff) needs `set_music_grid` sections.
- `scripts/drive/edited-structure.js` checks it through MCP in the web
  build: the open project reopened, a nested unique copy, a song's
  markers through a trim, a move and a speed change, a given grid judged
  by `check_project`, and a version's overrides kept in its saved project.
- Tests: `src/lib/musicGrid.test.ts` (markers following trims, moves,
  speed and splits; the given grid; check_project), `src/lib/versions.layouts.test.ts`
  (the three layouts on 9:16, 1:1 and 4:5; overrides),
  `src/lib/analysis/musicStructure.test.ts` (one phase),
  `src/lib/project/compound.test.ts` (nested unique copies),
  `src/lib/commands.test.ts` (mask and crop described).
