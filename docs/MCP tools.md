# MCP tools

<!-- Generated from src/lib/mcpGuide.ts and the tool definitions by
     `UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts`;
     npm test fails when this file is out of date. Do not edit by hand. -->

Every tool the editor offers an AI model over MCP, 132 in all, in the order a video gets made. How to connect is in [[Automation]]; the playbooks are in [[Agent playbook]]. Every edit is undoable; times are seconds; ids come from describe_project.

## What the server tells a model first

```text
You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable (undo).
Conventions: times are seconds; positions are fractions of the canvas from its center (x right, y down; 0.35 is near the bottom), but rectangles (box, region) are a top-left corner and a size, fractions of the picture; scale 1 fits a picture inside the canvas; ids come from describe_project and stay stable. Edits answer with only what they changed; describe_project has the whole timeline.
Before you start: help (the tools by step), help with topic ad, epic_edit or social_short (playbooks with design rules), list_catalog (every effect, transition, animation, template, look, sound effect and font by name), help with a tool's name (its parameters and an example).
To make a video:
1. new_project, so the user's projects stay untouched (open_project returns to one; list_projects finds them); set_project for the canvas shape.
2. import_media the footage, music, logo and pictures by absolute path; preview_media shows what is inside each video, to choose the moments worth using.
3. Write the script and add_voiceover: the voice and matching captions, timed to the real speech; it answers where each line landed.
4. Lay shots under each line with add_media_clip; frame_region zooms a shot onto the part that matters and can move between two regions; for music-driven edits, Music-synced below.
5. Titles: add_text (style.stroke, style.shadow or style.background keep it readable over footage), then set_animation in and out; add_text_template for lower thirds and end cards.
6. set_transition between shots; one look over everything (set_filter or apply_lut on an adjustment clip); music on an audio track, duck_under_speech under the voice, set_fades at the end; add_sound_effect on reveals.
7. Make many small edits at once with batch: one call, one undo step.
8. Check: preview_frames (a contact sheet of many moments), preview_motion around cuts and moves (frames in a row, with the beats), check_project (the design rules, each finding naming the tool that fixes it); fix, then check again.
9. export_video writes the file to the user's Videos folder and returns its path; loudness -14 suits online video.
Music-synced (epic, hype, velocity) edits: add the music, analyze_music (markers bars and drop), fit_music drop_at to place the drop, cut_to_beats the shots, add_beat_hits, set_speed_ramp a shot onto a beat, add_cinematic_bars, add_sound_effect end_at (a riser into the drop), then fit_music to end it.
Sound design: set_audio_filter (a low-pass sweep opening on the drop), set_reverb, set_echo, set_tape_stop; measure_loudness checks the mix against online, ebu_r128 or atsc_a85 before export.

For an ad: set_brand first (colors, two fonts, logo), then add_text with a role, set_animation per word or letter (wordPop, typewriter, unit), add_ad_element for lower thirds, offers, calls to action and the end card, text_behind_subject for a title behind a person, set_fades on the music, and export_versions for every shape and cut-down (check: true shows them first).
```

## Contents

- **Start here**: `help`, `describe_project`, `list_catalog`
- **Projects**: `list_projects`, `open_project`, `new_project`, `set_project`
- **Media**: `import_media`, `remove_media`, `relink_media`, `replace_clip`, `edit_media_folder`, `organize_media`
- **Timeline**: `add_media_clip`, `add_color_clip`, `add_adjustment_clip`, `add_track`, `update_track`, `delete_track`, `split`, `split_at_times`, `trim_clip`, `move_clip`, `nudge_clips`, `duplicate_clips`, `delete_clips`, `lift_range`, `close_gaps`, `cut_ranges`, `split_scenes`, `group_clips`, `ungroup_clips`, `set_clip_label`, `freeze_frame`, `detach_audio`, `sync_to_clip`, `create_compound_clip`, `break_compound_clip`, `edit_compound`, `rename_compound`, `batch`, `undo`, `redo`, `seek`
- **Music, beats and markers**: `analyze_music`, `cut_to_beats`, `add_beat_hits`, `fit_music`, `mark_beats`, `add_marker`, `add_markers`, `update_marker`, `delete_markers`
- **Picture and motion**: `set_param`, `add_keyframe`, `move_keyframe`, `set_keyframe_ease`, `remove_keyframes`, `frame_region`, `frame_clips`, `align_clips`, `distribute_clips`, `set_uniform_scale`, `set_flip`, `set_crop`, `set_mask`, `set_blend`, `set_chroma_key`, `set_canvas_fill`, `set_background_removal`, `remove_background`, `set_animation`, `add_cinematic_bars`, `track_motion`, `auto_reframe`, `stabilize_clip`
- **Speed**: `set_speed`, `set_speed_curve`, `set_speed_ramp`, `set_reverse`, `set_preserve_pitch`, `set_frame_blending`
- **Text and captions**: `add_text`, `set_text`, `add_text_template`, `apply_word_art`, `add_sticker`, `add_captions`, `set_caption_look`, `replace_caption_text`, `get_transcript`
- **Brand and ad elements**: `set_brand`, `apply_brand`, `add_ad_element`, `text_behind_subject`
- **Effects, transitions and color**: `add_effect`, `edit_effects`, `copy_effects`, `apply_effect_preset`, `paste_attributes`, `set_transition`, `set_filter`, `auto_adjust`, `set_hsl`, `set_curve`, `set_color_wheel`, `apply_lut`
- **Sound**: `add_voiceover`, `text_to_speech`, `add_sound_effect`, `set_fades`, `set_audio_filter`, `set_reverb`, `set_echo`, `set_tape_stop`, `set_compressor`, `set_channel_fill`, `normalize_loudness`, `duck_under_speech`, `reduce_noise`, `sync_audio`, `remove_silences`, `remove_filler_words`
- **Check and deliver**: `preview_media`, `preview_frames`, `preview_motion`, `preview_frame`, `check_project`, `measure_loudness`, `export_video`, `export_versions`, `export_status`

## Start here

Read before editing: the guide, the timeline and the names the tools accept.

### help

The guide to these tools. topic: overview (the tools by step; start here), ad, epic_edit or social_short (step-by-step playbooks with design rules), design (rules of thumb that make a video look professional), catalog, params (set_param paths), or any tool's name for its parameters and an example call.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `topic` | string |  | overview (default), design, ad, epic_edit, social_short, catalog, params, or a tool's name |

Example:

```json
{"name":"help","arguments":{"topic":"ad"}}
```

### describe_project

Read the timeline: canvas, fps, duration, assets, tracks and clips with ids and times in seconds. Call this first and after edits.

No parameters.

### list_catalog

Every name the edit tools accept. With no section: an index of all sections (effects, transitions, animations, filters, text_templates, caption_looks, speed_presets, sound_effects, blend_modes, mask_shapes, fonts, canvas_ratios, export_presets, sticker_motions, stickers, param_paths). With a section: its details, such as each effect's parameters with ranges and defaults. section stickers with a query searches the sticker library.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `section` | string |  | A section name from the index |
| `query` | string |  | Search words, for section stickers |

Example:

```json
{"name":"list_catalog","arguments":{"section":"effects"}}
```

## Projects

Work in a new project so the user's own stay untouched.

### list_projects

The saved projects, most recently edited first, with ids for open_project. The one open in the editor is marked open: true; none is when the app shows its home screen.

No parameters.

### open_project

Save the project in the editor and open another, by id or by name (any case; the most recently edited wins a tie). Returns its description, as describe_project does.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | yes | Project id or name |

### new_project

Save the project in the editor and start a new, empty one (1920x1080, 30 fps; set_project changes them). Work in one to leave the user's projects untouched.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | Project name; default: the date and time |

Example:

```json
{"name":"new_project","arguments":{"name":"Spring sale ad"}}
```

### set_project

Change project settings: name, canvas size (pixels), frame rate, background color.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | Project name |
| `width` | integer |  | Canvas width in pixels (16..8192) |
| `height` | integer |  | Canvas height in pixels (16..8192) |
| `background` | string |  | CSS hex color behind all layers |
| `fps` | "23.976" \| "24" \| "25" \| "29.97" \| "30" \| "50" \| "59.94" \| "60" |  | Frame rate; clips keep their times |

Example:

```json
{"name":"set_project","arguments":{"width":1080,"height":1920,"fps":"30"}}
```

## Media

Bring files in and keep the library tidy.

### import_media

Import media files into the project by absolute path (desktop) or URL. Returns the new assets with their ids, for add_media_clip.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `files` | { src, name }[] | yes | Files to import |
| `files[].src` | string | yes | Absolute path or URL |
| `files[].name` | string |  | Display name |

Example:

```json
{"name":"import_media","arguments":{"files":[{"src":"C:/Footage/product.mp4"},{"src":"C:/Music/track.mp3"}]}}
```

### remove_media

Remove imported media from the project; the files on disk stay. Media a clip uses is refused unless remove_clips=true, which deletes those clips too. unused=true removes every file no clip uses.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_ids` | string[] |  | Assets |
| `unused` | boolean |  | Remove all media no clip uses |
| `remove_clips` | boolean |  | Also delete the clips that use it |

### relink_media

Relink every use of an asset to another imported asset's source. Preserves edits and identity; requires compatible streams and duration. Undoable.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string | yes | Original asset |
| `replacement_asset_id` | string | yes | Imported replacement asset |

### replace_clip

Put another media file of the project in a clip's place (CapCut's Replace): the clip keeps its start, length (shorter only if the new source runs out), transform, effects, animations and sound settings, and plays the new source from its start.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video, image or audio clip |
| `asset_id` | string | yes | Media in the project |

### edit_media_folder

Create, rename or delete a virtual media folder. Deleting unfiles its media; source files and clips are preserved.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `action` | "create" \| "rename" \| "delete" | yes | Operation |
| `name` | string | yes | Folder name |
| `new_name` | string |  | New name for rename |

### organize_media

Set virtual folder membership and/or favorite status for imported assets. An empty folder name unfiles media; does not move source files.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_ids` | string[] | yes | Assets |
| `folder` | string |  | Existing folder, or empty to unfile |
| `favorite` | boolean |  | Favorite status |

## Timeline

Place, cut, move and arrange clips. batch runs many edits as one undo step.

### add_media_clip

Place an imported asset (video, audio or image) on the timeline. Omit track_id to let the editor choose (main track if free, otherwise an overlay/audio track).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string | yes | Asset id from list_assets |
| `start` | number | yes | Timeline position in seconds (0..) |
| `duration` | number |  | Length in seconds; defaults to the whole source (5 s for images) (0.001..) |
| `in` | number |  | Seconds into the source where the clip begins (0..) |
| `track_id` | string |  | Track id |
| `mode` | "overwrite" \| "insert" |  | overwrite replaces what is under the clip; insert pushes later clips right |

Example:

```json
{"name":"add_media_clip","arguments":{"asset_id":"a_123","start":0,"duration":3.5,"in":12}}
```

### add_color_clip

Add a solid color layer (backgrounds, flashes, title cards).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `color` | string | yes | CSS color |
| `start` | number | yes | Seconds (0..) |
| `duration` | number | yes | Seconds (0.001..) |
| `track_id` | string |  | Track id |

### add_adjustment_clip

Add an adjustment layer: its color settings, filter and effects apply to every layer below it for its duration.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `start` | number | yes | Seconds (0..) |
| `duration` | number | yes | Seconds (0.001..) |
| `track_id` | string |  | Track id |

### add_track

Add an empty video (visual) or audio track. Video tracks stack above existing ones; audio tracks go at the bottom.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `kind` | "video" \| "audio" | yes | Track kind |
| `name` | string |  | Track name |

### update_track

Mute, solo, hide, lock, rename, resize, or set the volume or pan of a track.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `track_id` | string | yes | Track id |
| `name` | string |  | New name |
| `muted` | boolean |  | Mute the track's sound |
| `hidden` | boolean |  | Hide the track's picture |
| `locked` | boolean |  | Prevent edits |
| `volume` | number |  | Linear gain, 1 = unchanged (0..4) |
| `pan` | number |  | -1 left .. 1 right, added to each clip's pan (-1..1) |
| `solo` | boolean |  | While any track is soloed, only soloed tracks sound |
| `height` | "small" \| "normal" \| "large" |  | Row height on the timeline |

### delete_track

Remove a track and its clips. The main track stays.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `track_id` | string | yes | Track id |

### split

Cut clips at a time. Without clip_ids, cuts every clip under that time on unlocked tracks.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `at` | number | yes | Seconds (0..) |
| `clip_ids` | string[] |  | Only these clips |

### split_at_times

Split a video or audio clip at several SOURCE times (seconds into its media file, the way scene detection reports them). Times on or outside the clip's edges are ignored; a detached audio clip lined up with it splits too. For a cut at a timeline time use split.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `times` | number[] | yes | Source seconds |

### trim_clip

Move a clip's start or end edge to a time. Limited by the source media and neighbors; ripple=true shifts later clips instead of stopping at them.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `edge` | "start" \| "end" | yes | Which edge |
| `to` | number | yes | Seconds (0..) |
| `ripple` | boolean |  | Shift later clips |

### move_clip

Move a clip to a time and (optionally) another track of the same kind. Overwrites whatever is under its new position.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `start` | number | yes | Seconds (0..) |
| `track_id` | string |  | Destination track id |

### nudge_clips

Move clips by whole frames on their tracks (negative is earlier). Nothing moves when a clip would pass the start, cover another clip or sits on a locked track.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips |
| `frames` | number | yes | Frames to move (-100000..100000) |

### duplicate_clips

Copy clips with everything on them (effects, keyframes, animations, style), the earliest copy starting at `at` seconds (default: right after the last of them ends), each on its own clip's track or a new track above where that is taken. Answers with the copies. The way to repeat a styled title or a lower third.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to copy |
| `at` | number |  | Seconds where the earliest copy starts (0..) |

### delete_clips

Remove clips. ripple=true closes the gaps they leave on their tracks.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to remove |
| `ripple` | boolean |  | Close the gaps |

### lift_range

Take a timeline range out of every unlocked track (Premiere's Lift and Extract): clips crossing its edges are cut; ripple=false leaves a gap, ripple=true closes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `start` | number | yes | Seconds (0..) |
| `end` | number | yes | Seconds (0..) |
| `ripple` | boolean |  | Close the gap (Extract) |

### close_gaps

Close empty space on a track by rippling later clips left: the gap at `at` seconds, or every gap (packing the track from 0) when `at` is left out.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `track_id` | string | yes | Track id |
| `at` | number |  | Timeline seconds inside the gap |

### cut_ranges

Remove parts of a video or audio clip. Ranges are SOURCE seconds (seconds into the clip's media file, the way silence detection and transcripts report them; describeProject lists each media clip's in/out), so one list stays valid however the clip is cut. ripple (default true) closes the gaps; a detached audio clip lined up with it is cut too. The primitive behind silence and filler removal.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `ranges` | { start, end }[] | yes | Source ranges to remove; overlaps merge, parts outside the clip are ignored |
| `ranges[].start` | number | yes | Source seconds (0..) |
| `ranges[].end` | number | yes | Source seconds (0..) |
| `ripple` | boolean |  | Close the gaps (default true) |

### split_scenes

Find every shot change in a video clip and split there (or drop markers). Returns the cut times in source seconds.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `sensitivity` | number |  | 0..1, default 0.5 (0..1) |
| `output` | "split" \| "markers" |  | Default split |

### group_clips

Group two or more clips so they select, move, copy and delete together (Premiere's Group). They keep their tracks and settings.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips, two or more |

### ungroup_clips

Break up the groups the given clips belong to.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips |

### set_clip_label

Color-label clips (Premiere's Label): the timeline paints them with it. "none" removes the label.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to label |
| `label` | "red" \| "orange" \| "yellow" \| "green" \| "cyan" \| "blue" \| "purple" \| "pink" \| "none" | yes | A label color, or none |

### freeze_frame

Insert a still of the frame at a time inside a video clip, pushing the rest of the track right.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video clip id |
| `at` | number | yes | Timeline seconds |
| `duration` | number |  | Seconds to hold (0.04..) |

### detach_audio

Move a video clip's sound to its own audio clip (for J/L cuts or separate audio edits).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video clip id |

### sync_to_clip

Move a clip (a separately recorded sound) into sync with another (the camera clip of the same take), given where their sources line up: source second t of to_clip_id plays with source second t + offset of clip_id. Exact to the sample: the in-point takes up what a whole frame cannot; sound that would fall before 0 is trimmed off its head; a taken spot puts it on a new track. mute_reference sets to_clip_id's volume to 0. sync_audio finds the offset by waveform.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The clip to move: usually an audio clip |
| `to_clip_id` | string | yes | The clip it syncs to: usually the camera's video |
| `offset` | number | yes | Seconds: clip_id's source time minus to_clip_id's for the same moment |
| `mute_reference` | boolean |  | Silence to_clip_id's own sound (default false) |

### create_compound_clip

Put clips into one compound clip (CapCut's Create compound clip, Premiere's Nest), on the lowest of their video tracks, spanning them all. The clips move into a nested timeline (describeProject lists it under compounds) at the same times relative to each other; the compound clip then plays it like a video clip plays a file, and its own transform, opacity, blend, color, effects, speed and volume act on the whole. Needs a clip on a video track, and nothing else on that track inside the span.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to put inside, on any tracks |
| `name` | string |  | Name shown on the clip (default Compound clip N) |

### break_compound_clip

Break a compound clip apart (Resolve's Decompose in place, CapCut's Undo compound clip): the clips inside go back on this timeline at the frames the compound clip showed them, trimmed to what it showed, on its track and the tracks above. The compound clip's own settings go with it. Needs speed 1.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Compound clip id |

### edit_compound

Run another command inside a compound's nested timeline (compound_id from compounds in describeProject, not the compound clip's id). Clip and track ids, and times, are the nested timeline's own. Every compound clip that plays it shows the change.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `compound_id` | string | yes | Compound id |
| `command` | string | yes | Command to run inside, e.g. move_clip or set_param |
| `args` | object |  | That command's arguments |

### rename_compound

Rename a compound; every compound clip that plays it shows the new name.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `compound_id` | string | yes | Compound id |
| `name` | string | yes | New name |

### batch

Run several commands in order as one edit (one undo step), all or nothing: set_animation on many clips, a run of add_keyframe, a whole title sequence. Each step sees what the steps before it did; a failing step names its number and nothing changes.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `commands` | { command, args }[] | yes | The steps, in order |
| `commands[].command` | string | yes | Command name, e.g. set_animation |
| `commands[].args` | object |  | That command's arguments |

Example:

```json
{"name":"batch","arguments":{"commands":[{"command":"set_animation","args":{"clip_id":"c_1","slot":"in","type":"rise","duration":0.5}},{"command":"set_animation","args":{"clip_id":"c_1","slot":"out","type":"fade","duration":0.3}}]}}
```

### undo

Undo the last edit; returns what that changed back.

No parameters.

### redo

Redo the last undone edit; returns what changed.

No parameters.

### seek

Move the playhead to a time in seconds: what the viewer shows and where tools that act at the playhead (the Tracking box) start.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `at` | number | yes | Seconds (0..) |

## Music, beats and markers

Read the music's structure, cut and hit on it, fit it to the picture; mark moments.

### analyze_music

Read a music clip's structure on this computer, as Final Cut's beat grid shows it (song parts, bars, beats), to cut to: bpm; every beat; downbeats (each bar's first beat, 4 beats a bar, from where the accents fall); phrases (every 4 bars); sections, each {start, end, label, energy} with label intro, verse, build, drop, breakdown or outro and energy 0..1 (1 the loudest part); beat_energy (0..1 per beat); hits (strong onsets on or off the beat: drum hits, stabs); and drop (where the biggest rise into a loud section lands, or null). All times are TIMELINE seconds, inside the clip. markers also drops markers: beats (label Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (Drop), one undo step; cut_to_beats then cuts on them (grid bars or phrases), add_beat_hits hits them (marker_label Bar or Drop) and fit_music moves the drop. Example: {"clip_id": "c_3", "markers": ["bars", "drop"]}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The music clip (audio, or a video with sound) |
| `markers` | "beats" \| "bars" \| "phrases" \| "sections" \| "drop"[] |  | Kinds of markers to add (default none) |

Example:

```json
{"name":"analyze_music","arguments":{"clip_id":"c_3","markers":["beats","bars","drop"]}}
```

### cut_to_beats

Cut a montage to the music in one call: lay shots end to end on the main track so every cut lands on the beat grid. The grid is the Beat markers (mark_beats or analyze_music), Bar or Phrase markers (grid bars or phrases, from analyze_music with markers ["bars"] or ["phrases"]), or beats: your own timeline seconds. Each shot lasts `every` grid steps (default 2 beats, or 1 bar or phrase), or the steps in `pattern` in turn ([4, 4, 2, 2, 1, 1] speeds up), or its own `beats`. The first shot starts at `start`; when no grid point is there, the first one after it counts as beat one, so an intro stays inside the first shot. A shot reads its media from `in` (default: where the last shot of the same file ended, so one long clip gives many different shots), slid back inside the file if it would run past the end; media too short for its slot ends on an earlier grid point. Stops when the shots or the grid run out, or at `end`; clips already there are overwritten. Video shots are muted (mute false keeps their sound). Example: {"media": [{"asset_id": "a_1"}, {"asset_id": "a_2", "in": 3}, {"asset_id": "a_1", "beats": 4}], "pattern": [2, 2, 1, 1]}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `media` | { asset_id, in, beats }[] | yes | The shots in order; the same asset may appear many times |
| `media[].asset_id` | string | yes | Video or picture asset id (import_media) |
| `media[].in` | number |  | Source seconds the shot starts at (default: where this media's previous shot ended, else 0) (0..) |
| `media[].beats` | integer |  | Grid steps this shot lasts, overriding pattern and every (1..) |
| `grid` | "beats" \| "bars" \| "downbeats" \| "phrases" |  | Which markers make the grid: beats (Beat, default), bars or downbeats (Bar: each bar's first beat), phrases (Phrase: every 4 bars) |
| `beats` | number[] |  | The grid as timeline seconds instead of markers, e.g. analyze_music's downbeats |
| `marker_label` | string |  | Use the markers with this label as the grid instead |
| `every` | integer |  | Grid steps per shot (default 2 for beats, 1 for bars or phrases) (1..64) |
| `pattern` | integer[] |  | Grid steps per shot, cycling: [4, 4, 2, 2, 1, 1] |
| `start` | number |  | Timeline seconds the first shot starts (default 0) (0..) |
| `end` | number |  | Timeline seconds to stop by: no cut after it (0..) |
| `track_id` | string |  | A video track instead of the main track |
| `mute` | boolean |  | Mute the shots' own sound (default true: the music carries a montage) |

Example:

```json
{"name":"cut_to_beats","arguments":{"media":[{"asset_id":"a_1","in":2},{"asset_id":"a_2"},{"asset_id":"a_1","in":9,"beats":4}],"grid":"beats","pattern":[4,4,2,2,1,1]}}
```

### add_beat_hits

Punch up beats with short hits: flash (blown out to white), zoom (a zoom punch), shake (camera shake), rgb_split, glow or zoom_blur, several at once as one layer (["flash", "zoom"]). Each hit is an adjustment layer on a Hits track above the footage (below bars and titles), at its peak on the beat and easing out over `duration` (default 0.2 to 0.35 s by effect), keyframed, so preview and export match. Times: `times` (timeline seconds), the main track's cuts (at_cuts true), or the Beat markers (or marker_label's, e.g. Bar or Drop), between from and to, thinned to every Nth. intensity 0..1 (default 1, strong). Photosensitivity: flashes keep to at most 3 in any second (WCAG 2.3.1); a beat that would break that gets its other effects without the flash, or nothing. Example: {"effects": ["zoom", "rgb_split"], "marker_label": "Bar"}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `effect` | "flash" \| "zoom" \| "shake" \| "rgb_split" \| "glow" \| "zoom_blur" |  | One hit |
| `effects` | "flash" \| "zoom" \| "shake" \| "rgb_split" \| "glow" \| "zoom_blur"[] |  | Several hits on each beat, as one layer |
| `times` | number[] |  | Timeline seconds of the hits |
| `at_cuts` | boolean |  | Hit every cut of the main track instead |
| `marker_label` | string |  | Hit the markers with this label (default Beat) |
| `every` | integer |  | Only every Nth time, from the first (default 1) (1..64) |
| `from` | number |  | Timeline seconds: no hit before (0..) |
| `to` | number |  | Timeline seconds: no hit at or after (0..) |
| `duration` | number |  | Seconds each hit lasts (0.04..2) |
| `intensity` | number |  | 0..1, default 1 (0..1) |

Example:

```json
{"name":"add_beat_hits","arguments":{"effects":["flash","zoom"],"marker_label":"Drop"}}
```

### fit_music

Fit a music clip to the cut. With drop_at, first slide the music so its drop plays at drop_at (timeline seconds): drop is where the drop plays now (analyze_music's drop; default the Drop marker on the clip), anything that would fall before 0 is cut off, and its Beat, Bar, Phrase and section markers move with it. Then end it with the picture (end video, default), on the last Beat or Bar marker before the picture ends (end beat or bar), or at end_at, fading out over fade_out seconds (default 1). trim_picture cuts the picture there too, so both stop together. Align the drop before cut_to_beats: the cuts follow the markers. Example: {"clip_id": "c_2", "drop_at": 4.0, "end": "bar", "fade_out": 1.5}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The music clip (audio, or a video's sound) |
| `drop_at` | number |  | Timeline seconds the drop should land on (0..) |
| `drop` | number |  | Timeline seconds where the drop plays now (default the Drop marker on the clip) (0..) |
| `end` | "video" \| "beat" \| "bar" |  | Where the music ends: video (the picture's end, default), beat or bar (the last Beat or Bar marker before it) |
| `end_at` | number |  | Timeline seconds to end at instead (0..) |
| `fade_out` | number |  | Seconds of fade-out (default 1) (0..30) |
| `fade_in` | number |  | Seconds of fade-in (default unchanged) (0..30) |
| `trim_picture` | boolean |  | Also cut the picture (every video track) at the music's end |

Example:

```json
{"name":"fit_music","arguments":{"clip_id":"c_3","drop_at":8.4,"end":"bar","fade_out":1.5}}
```

### mark_beats

Drop a timeline marker on the beat of a music clip. Returns the BPM and beat count.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `every` | 1 \| 2 \| 4 |  | Marker on every Nth beat (default 1) |

Example:

```json
{"name":"mark_beats","arguments":{"clip_id":"c_123","every":1}}
```

### add_marker

Drop a marker at a time (chapters, beats, notes).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `at` | number | yes | Seconds (0..) |
| `label` | string |  | Text |
| `color` | string |  | CSS color |

### add_markers

Drop several markers at once at TIMELINE seconds (beats, scene cuts, chapters). A time that already has a marker with the same label is skipped, so running a detector twice does not double its markers.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `times` | number[] | yes | Timeline seconds |
| `label` | string |  | Text for every marker |
| `color` | string |  | CSS color |

### update_marker

Edit a timeline marker's position, label or color without moving clips. Times are seconds.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `marker_id` | string | yes | Marker id |
| `at` | number |  | Timeline seconds (0..) |
| `label` | string |  | Text |
| `color` | string |  | CSS color |

### delete_markers

Delete the specified timeline markers together. Unknown ids reject the whole edit.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `marker_ids` | string[] | yes | Marker ids |

## Picture and motion

Position, scale, crop, mask, key and animate pictures; keyframes for anything numeric.

### set_param

Set a numeric clip parameter by path, e.g. opacity (0..1), volume (1 = 0 dB), transform.x / transform.y (canvas fractions from center), transform.scale (1 = fit; the horizontal scale when not uniform), transform.scaleY (vertical scale; setting it makes the scale non-uniform), transform.rotation (degrees), adjust.exposure / adjust.contrast / adjust.saturation / adjust.temperature (-100..100), grade values such as adjust.hsl.red.saturation, adjust.wheels.gain.y (-100..100) and adjust.lut.intensity (0..1). If the path has keyframes, sets a keyframe at `at` instead. Sound fades are frames here; set_fades takes seconds.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips |
| `path` | string | yes | Parameter path |
| `value` | number | yes | New value |
| `at` | number |  | Timeline seconds, for keyframed paths |

Example:

```json
{"name":"set_param","arguments":{"clip_ids":["c_123"],"path":"transform.scale","value":1.2}}
```

### add_keyframe

Animate a parameter: add a keyframe at a timeline time. Two or more keyframes on a path interpolate between them.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string | yes | Parameter path (see set_param) |
| `at` | number | yes | Timeline seconds |
| `value` | number | yes | Value at that time |
| `ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" |  | Curve toward the next keyframe |

Example:

```json
{"name":"add_keyframe","arguments":{"clip_id":"c_123","path":"transform.scale","at":0,"value":1,"ease":"easeInOut"}}
```

### move_keyframe

Retime a keyframe and/or change its value. at is the keyframe's current timeline time, to the new one (seconds). It stays inside the clip and replaces a keyframe already at its new time on that path.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string | yes | Parameter path (see set_param) |
| `at` | number | yes | Timeline seconds of the keyframe now |
| `to` | number |  | Timeline seconds to move it to |
| `value` | number |  | New value |

### set_keyframe_ease

Shape the curve leaving keyframes toward the next one. ease is a preset (linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate); bezier [x1, y1, x2, y2] is a CSS cubic-bezier (x in 0..1, y may overshoot) and overrides it. Without path, applies to every parameter keyed at that time; without at, to every keyframe on the path(s).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string |  | Parameter path; omit for all keyed parameters |
| `at` | number |  | Timeline seconds of the keyframe; omit for all keyframes |
| `ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" |  | Preset name |
| `bezier` | number[] |  | [x1, y1, x2, y2] |

### remove_keyframes

Remove keyframes from a clip. at lists timeline times in seconds (omit for every time); path limits it to one parameter (omit for all). A parameter left with no keyframes goes back to its static value.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string |  | Parameter path; omit for all keyed parameters |
| `at` | number[] |  | Timeline seconds of the keyframes to remove |

### frame_region

Show one part of a video or picture full screen, as a zoom on a screen recording does: region is a rectangle in fractions of the source picture (x, y its top-left corner; {x:0.5,y:0,w:0.5,h:1} is the right half). fill (default) covers the canvas, fit shows all of the region. The picture slides back where it would leave an empty band. With to_region, it moves from the one to the other between from and to (default the whole clip), easing in and out. Replaces the clip's scale and position keyframes.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or image clip id |
| `region` | { x, y, w, h } | yes | The part of the picture to show (or to start from when to_region is given): fractions, x and y its top-left corner |
| `region.x` | number | yes | Left edge, a fraction of the picture's width (0..1) |
| `region.y` | number | yes | Top edge, a fraction of its height (0..1) |
| `region.w` | number | yes | Width, a fraction of the picture's width (0.01..1) |
| `region.h` | number | yes | Height, a fraction of its height (0.01..1) |
| `to_region` | { x, y, w, h } |  | Where the move ends: the part of the picture shown at `to` |
| `to_region.x` | number | yes | Left edge, a fraction of the picture's width (0..1) |
| `to_region.y` | number | yes | Top edge, a fraction of its height (0..1) |
| `to_region.w` | number | yes | Width, a fraction of the picture's width (0.01..1) |
| `to_region.h` | number | yes | Height, a fraction of its height (0.01..1) |
| `mode` | "fill" \| "fit" |  | How the region meets the canvas |
| `from` | number |  | Timeline seconds the move starts; default the clip's start |
| `to` | number |  | Timeline seconds the move ends; default the clip's end |

Example:

```json
{"name":"frame_region","arguments":{"clip_id":"c_123","region":{"x":0.25,"y":0.2,"w":0.5,"h":0.5},"to_region":{"x":0.1,"y":0.1,"w":0.8,"h":0.8},"from":0,"to":3}}
```

### frame_clips

Frame pictures on the canvas, centered: fit shows the whole picture, fill covers the canvas and crops the overflow, stretch covers it exactly, ignoring proportions.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `mode` | "fit" \| "fill" \| "stretch" | yes | How to frame |
| `at` | number |  | Timeline seconds, for animated scale |

### align_clips

Align pictures on the canvas, as CapCut's Transform align row does: one clip against the canvas edge or center, several against their combined bounds. left, center and right move horizontally; top, middle and bottom vertically. Animated positions get a keyframe at `at` (default: each clip's first frame).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `align` | "left" \| "center" \| "right" \| "top" \| "middle" \| "bottom" | yes | Where to align |
| `at` | number |  | Timeline seconds, for animated positions |
| `margin` | number |  | One clip: stop this far inside the canvas edge, a fraction of its size (0.05 is the title-safe inset), so titles of any width share one left edge (0..0.4) |

### distribute_clips

Space three or more pictures evenly on the canvas: the outermost two stay, the rest move so the gaps between neighbors are equal.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips, three or more |
| `axis` | "horizontal" \| "vertical" | yes | Direction |
| `at` | number |  | Timeline seconds, for animated positions |

### set_uniform_scale

CapCut's Uniform scale switch. false: the vertical scale (transform.scaleY) separates from transform.scale, starting equal; true: it goes and the picture takes transform.scale.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `uniform` | boolean | yes | Scale both directions together |

### set_flip

Mirror pictures: horizontal flips left-right, vertical flips upside down. A direction left out keeps its state.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `horizontal` | boolean |  | Flipped left-right |
| `vertical` | boolean |  | Flipped upside down |

### set_crop

Crop pictures, as CapCut's Crop does. left, top, right and bottom are fractions of the source trimmed from each edge (0 keeps the edge; each pair must leave at least 5% of the picture); edges left out keep their value. Or give ratio instead for the largest centered crop of that shape on each clip's source (original: uncropped). The crop is cut from the source before flips, scale and rotation, and the part kept stays where it was.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `left` | number |  | Fraction trimmed from the source's left (0..0.95) |
| `top` | number |  | Fraction trimmed from the top (0..0.95) |
| `right` | number |  | Fraction trimmed from the right (0..0.95) |
| `bottom` | number |  | Fraction trimmed from the bottom (0..0.95) |
| `ratio` | "original" \| "16:9" \| "9:16" \| "1:1" \| "4:3" \| "3:4" \| "4:5" \| "21:9" |  | Crop to this shape, centered |

### set_mask

CapCut's mask on pictures: shape linear (keeps above a line), mirror (a band), circle, rectangle, heart or star; none removes it. x and y move its center from the picture's center, width and height size it, all as fractions of the visible picture's width and height; rotation in degrees turns it; feather 0..1 softens the edge; radius 0..1 rounds a rectangle's corners; invert keeps the outside. A new mask starts centered at 0.6 of the picture (hearts and stars square). Values left out keep theirs; animated values get a keyframe at `at`.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `shape` | "none" \| "linear" \| "mirror" \| "circle" \| "rectangle" \| "heart" \| "star" |  | Mask shape |
| `x` | number |  | Center offset, fraction of the picture's width (-1..1) |
| `y` | number |  | Center offset, fraction of the picture's height (-1..1) |
| `width` | number |  | Fraction of the picture's width (0.01..2) |
| `height` | number |  | Fraction of the picture's height (0.01..2) |
| `rotation` | number |  | Degrees, clockwise (-360..360) |
| `feather` | number |  | Edge softness (0..1) |
| `radius` | number |  | Rectangle corner roundness (0..1) |
| `invert` | boolean |  | Keep the outside instead |
| `at` | number |  | Timeline seconds, for animated values |

### set_blend

How a picture mixes with what is under it (the inspector's Blend). screen or add for light leaks, flares and glows shot on black; multiply for textures and paper on white; overlay or softLight for grain and grunge. normal undoes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `mode` | "normal" \| "darken" \| "multiply" \| "colorBurn" \| "lighten" \| "screen" \| "colorDodge" \| "add" \| "overlay" \| "softLight" \| "hardLight" \| "difference" \| "exclusion" | yes | Blend mode |

Example:

```json
{"name":"set_blend","arguments":{"clip_ids":["c_123"],"mode":"screen"}}
```

### set_chroma_key

Key out a color (green or blue screen) so what is below shows through, as CapCut's Chroma key. color is the backdrop's color (#00b140 is studio green); similarity 0..1 (default 0.4) is how close a pixel must be to vanish, smoothness 0..1 (default 0.1) softens edges, spill 0..1 (default 0.5) takes the green cast off the subject. enabled=false turns it off and keeps the settings.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or image clips |
| `color` | string |  | Key color, CSS hex |
| `similarity` | number |  | 0..1 (0..1) |
| `smoothness` | number |  | 0..1 (0..1) |
| `spill` | number |  | 0..1 (0..1) |
| `enabled` | boolean |  | Keying on (default true) |

### set_canvas_fill

What fills the canvas around a picture that does not cover it (CapCut's Canvas): blur (the clip itself, scaled to cover and blurred; amount 0..100, default 50), color (a solid color), or none. The usual fix for horizontal footage on a vertical canvas without cropping it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or image clips |
| `fill` | "blur" \| "color" \| "none" | yes | Kind of fill |
| `amount` | number |  | Blur strength 0..100 (0..100) |
| `color` | string |  | Fill color, CSS hex |

Example:

```json
{"name":"set_canvas_fill","arguments":{"clip_ids":["c_123"],"fill":"blur","amount":60}}
```

### set_background_removal

Turn Remove background on or off for video clips that already have a background matte (the person stays, everything behind them becomes see-through, so lower tracks show). The remove_background tool (window.videoEditor.ai.removeBackground) makes the matte on this machine; turning it off keeps the matte, so turning it back on is instant.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video clips |
| `enabled` | boolean | yes | On or off |

### remove_background

Remove the background of a video clip of a person or object (CapCut's Remove BG): a segmentation model on this machine makes a matte for every frame (seconds to minutes; the first run downloads the model), then the subject plays over whatever is on the tracks below. One undoable edit; set_background_removal turns it off and on again instantly.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video clip id |

### set_animation

Set a clip's intro (in), outro (out) or looping (loop) animation; type 'none' clears the slot. Whole clip, in/out: fade, zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown, rise, drop, pop, spin, tilt, blurIn; loop: pulse, sway, float, shake, flicker, heartbeat. Titles only (kinetic typography), in/out: typewriter (letters appear one by one behind a caret; as out it deletes from the end), letterRise, letterFade, wordPop, wordRise, wordSlide, lineRise (each letter, word or line moves on its own), highlightSweep (a marker box sweeps behind the words) and underlineWipe (an underline draws across them), both in the title's style.accent color. On a title, unit plays any in, out or loop animation per letter, word or line instead (rise by word; a float loop by letter is a wave); stagger spreads the units over the duration and order picks which goes first. duration is the whole animation in seconds, every unit included (a typewriter over 1.5 s suits a 25-letter line); for a loop, one cycle. Example: {clip_id, slot: 'in', type: 'rise', unit: 'word', stagger: 0.6, duration: 0.8}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `slot` | "in" \| "out" \| "loop" | yes | Which animation |
| `type` | "fade" \| "zoomIn" \| "zoomOut" \| "slideLeft" \| "slideRight" \| "slideUp" \| "slideDown" \| "rise" \| "drop" \| "pop" \| "spin" \| "tilt" \| "blurIn" \| "pulse" \| "sway" \| "float" \| "shake" \| "flicker" \| "heartbeat" \| "typewriter" \| "letterRise" \| "letterFade" \| "wordPop" \| "wordRise" \| "wordSlide" \| "lineRise" \| "highlightSweep" \| "underlineWipe" \| "none" | yes | Animation |
| `duration` | number |  | Seconds for the whole animation (loops: one cycle); default 0.5 (0.05..) |
| `unit` | "letter" \| "word" \| "line" |  | Titles only: play it by each letter, word or line instead of the whole title (the kinetic presets have their own; this overrides it) |
| `stagger` | number |  | Titles, per unit: 0 moves every unit together, 1 one after another; default the preset's, else 0.5 (0..1) |
| `order` | "forward" \| "backward" \| "center" \| "random" |  | Titles, per unit: which unit moves first; default forward (a typewriter's out: backward) |

Example:

```json
{"name":"set_animation","arguments":{"clip_id":"c_123","slot":"in","type":"pop","duration":0.4}}
```

### add_cinematic_bars

Cinematic bars: letterbox the picture to a wide ratio, 2.39 (scope, default), 2.35, 2 or 1.85 (pillarboxed when the canvas is already wider), on any canvas shape. An adjustment layer with the letterbox effect on a Bars track above the footage and hits, below titles, from start (default 0) to end (default the picture's end); animate_in and animate_out slide the bars in and out over that many seconds. Calling it again over the same time replaces the bars. Example: {"ratio": 2.39, "start": 4.0, "animate_in": 0.4}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `ratio` | number |  | Width over height of the picture left between the bars (default 2.39) (1..4) |
| `start` | number |  | Timeline seconds (default 0) (0..) |
| `end` | number |  | Timeline seconds (default the end of the picture) (0..) |
| `animate_in` | number |  | Seconds the bars take to slide in (default 0: there at once) (0..10) |
| `animate_out` | number |  | Seconds they take to slide out at the end (default 0) (0..10) |

Example:

```json
{"name":"add_cinematic_bars","arguments":{"ratio":2.39,"animate_in":0.6}}
```

### track_motion

Pin a title, sticker or picture to a moving subject in the video under it (CapCut's Tracking): follows the subject from `at` to the end of the shorter clip on this computer and writes the layer's position keyframes, keeping the layer's offset from the subject. box is the subject in fractions of the video's picture (x, y its top-left corner); without it, a box around the layer's own center. One undoable edit.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The layer to pin (title, sticker, picture or video) |
| `at` | number |  | Timeline seconds to start from; default the playhead (0..) |
| `box` | { x, y, w, h } |  | The subject, as a rectangle of the video's picture |
| `box.x` | number | yes | Left edge, a fraction of the picture's width |
| `box.y` | number | yes | Top edge, a fraction of its height |
| `box.w` | number | yes | Width, a fraction of the picture's width |
| `box.h` | number | yes | Height, a fraction of its height |
| `video_clip_id` | string |  | The video to follow; default the one under the layer (main track first) |

### auto_reframe

Reframe a wide video into another shape on this computer (CapCut's and Premiere's Auto reframe): the canvas takes the ratio (its short side kept), the subject is followed through the clip and the clip fills the canvas with position keyframes that keep it centered. box is the subject in fractions of the picture (x, y its top-left corner) on the clip's first frame; default a square at the center. One undoable edit.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The video clip |
| `ratio` | "9:16" \| "1:1" \| "4:5" \| "keep" |  | Canvas shape; keep reframes in the current one |
| `box` | { x, y, w, h } |  | The subject, as a rectangle of the video's picture |
| `box.x` | number | yes | Left edge, a fraction of the picture's width |
| `box.y` | number | yes | Top edge, a fraction of its height |
| `box.w` | number | yes | Width, a fraction of the picture's width |
| `box.h` | number | yes | Height, a fraction of its height |

Example:

```json
{"name":"auto_reframe","arguments":{"clip_id":"c_123","ratio":"9:16"}}
```

### stabilize_clip

Smooth a shaky video clip on this computer (CapCut's Stabilize): measures the camera's shake and moves each frame onto a smooth path, zooming slightly to hide the edges. level: least-crop, recommended (default), most-stable, or off to remove it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `level` | "least-crop" \| "recommended" \| "most-stable" \| "off" |  | How strongly to smooth |

## Speed

Constant speed, ramps, reverse and smoother slow motion.

### set_speed

Constant speed for a video or audio clip (2 = twice as fast, 0.5 = slow motion). The clip's length changes; later clips on its track move with it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `speed` | number | yes | Multiplier (0.05..100) |

### set_speed_curve

Ramp a video or audio clip's speed (CapCut's Curve speed): a preset, or points over the clip with t from 0 (its start) to 1 (its end) and speed 0.1..10. The rate changes smoothly (exponentially) between points. The clip keeps its source range, so its length becomes source length / mean speed and later clips on its track move. preset 'none' returns to the constant speed.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `preset` | "none" \| "custom" \| "montage" \| "hero" \| "bullet" \| "jumpCut" \| "flashIn" \| "flashOut" |  | A ready-made ramp |
| `points` | { t, speed }[] |  | Speed points across the clip; used when no preset is given |
| `points[].t` | number | yes | 0 = clip start, 1 = clip end (0..1) |
| `points[].speed` | number | yes | Rate there (0.1..10) |

Example:

```json
{"name":"set_speed_curve","arguments":{"clip_id":"c_123","preset":"hero"}}
```

### set_speed_ramp

Velocity edit: ramp a video clip's speed so its slow-motion moment (moment slow, default) or its fast moment (fast) lands exactly on a beat at `at` (timeline seconds; default the Beat marker nearest the clip's middle). The clip keeps its start and length, so cuts made on the beat stay there; the ramp reads more or less of the media instead (the in-point moves earlier when the file would run out). Without a preset: speed 0.1..10 at the moment (default 0.3 slow, 3 fast), base elsewhere (default 2 slow, 1 fast), easing over `ease` seconds (default 0.12) into the beat and holding `hold` seconds (default 0.25). Or preset (montage, hero, bullet, jumpCut, flashIn, flashOut): its slowest (or fastest) point is moved onto the beat. set_speed_curve ramps a whole clip without aligning it. Example: {"clip_id": "c_5", "at": 3.75}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `at` | number |  | Timeline seconds of the beat, inside the clip (0..) |
| `moment` | "slow" \| "fast" |  | Which moment lands on the beat |
| `speed` | number |  | Speed at the moment (0.1..10) |
| `base` | number |  | Speed before and after it (0.1..10) |
| `hold` | number |  | Seconds the moment holds after the beat (0..10) |
| `ease` | number |  | Seconds the speed takes to change into and out of the moment (0.02..5) |
| `preset` | "montage" \| "hero" \| "bullet" \| "jumpCut" \| "flashIn" \| "flashOut" |  | A ready-made ramp to align instead |

Example:

```json
{"name":"set_speed_ramp","arguments":{"clip_id":"c_7","at":8.4,"moment":"slow"}}
```

### set_reverse

Play a video or audio clip backward (reverse=true) or forward again. The clip keeps its length and source range; its sound reverses too.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `reverse` | boolean | yes | Backward |

### set_preserve_pitch

Keep a sped-up or slowed-down clip's pitch natural (preserve=true, the default) or let it rise and fall with the speed like tape (preserve=false, CapCut's Change pitch).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `preserve` | boolean | yes | Keep the original pitch |

### set_frame_blending

Frame blending (Premiere's): a slowed video clip, or one whose source rate differs from the project's, mixes neighboring source frames instead of repeating them, so slow motion looks smoother.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video clips |
| `on` | boolean | yes | Blend frames |

## Text and captions

Titles, templates, stickers, captions and the transcript.

### add_text

Add a text (title) clip. Position x/y are offsets from the canvas center as fractions of its width/height (y=0.35 is near the bottom).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | The words to show; \n for line breaks |
| `start` | number | yes | Seconds (0..) |
| `duration` | number | yes | Seconds (0.001..) |
| `x` | number |  | Horizontal offset, -0.5..0.5 |
| `y` | number |  | Vertical offset, -0.5..0.5 |
| `style` | { font, size, color, bold, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text) |
| `style.font` | string |  | Font family |
| `style.size` | number |  | Pixels at 1080p canvas height (4..) |
| `style.color` | string |  | CSS color |
| `style.bold` | boolean |  | Bold |
| `style.italic` | boolean |  | Italic |
| `style.align` | "left" \| "center" \| "right" |  | Alignment |
| `style.highlight` | string |  | Captions: color of the word being spoken; an empty string turns it off |
| `style.case` | "none" \| "upper" \| "lower" \| "title" |  | Letter case as shown (the text is kept): none, upper, lower or title |
| `style.background` | { color, padding, radius } |  | A box behind the text, so it reads over busy footage; an empty color removes it |
| `style.background.color` | string | yes | CSS color, e.g. rgba(0,0,0,0.6) |
| `style.background.padding` | number |  | Pixels (0..) |
| `style.background.radius` | number |  | Corner radius, pixels (0..) |
| `style.stroke` | { color, width } |  | An outline around the letters (6-10 for titles over footage); width 0 or an empty color removes it |
| `style.stroke.color` | string | yes | CSS color |
| `style.stroke.width` | number |  | Pixels (0..) |
| `style.stroke2` | { color, width } |  | A second outline outside the first, for a sticker-like double edge |
| `style.stroke2.color` | string | yes | CSS color |
| `style.stroke2.width` | number |  | Pixels beyond the first outline; default 6 (0..) |
| `style.shadow` | { color, blur, x, y } |  | A drop shadow; an empty color removes it |
| `style.shadow.color` | string | yes | CSS color |
| `style.shadow.blur` | number |  | Pixels (0..) |
| `style.shadow.x` | number |  | Pixels |
| `style.shadow.y` | number |  | Pixels |
| `style.glow` | { color, blur, strength } |  | A neon glow around the letters |
| `style.glow.color` | string | yes | CSS color, e.g. #00e5ff |
| `style.glow.blur` | number |  | Pixels, default 24 (0..) |
| `style.glow.strength` | number |  | 1..3, how bright; default 1 (1..3) |
| `style.gradient` | { from, to, angle } |  | A two-color fill instead of color |
| `style.gradient.from` | string | yes | CSS color at the start |
| `style.gradient.to` | string | yes | CSS color at the end |
| `style.gradient.angle` | number |  | Degrees: 0 left to right (default), 90 top to bottom (-360..360) |
| `style.accent` | string |  | Color the highlightSweep marker and the underlineWipe line draw in; an empty string returns to the default |
| `style.letterSpacing` | number |  | Pixels between letters at 1080p (wide-tracked labels: 6 to 20) (-20..200) |
| `style.maxWidth` | number |  | Lines wrap past this fraction of the canvas width (default 0.9) (0.1..1) |
| `role` | "headline" \| "subhead" \| "body" \| "label" \| "cta" \| "badge" |  | Style it from the brand kit (set_brand) first, then apply style on top: headline (heading font, about 9% of the frame high, with a shadow), subhead, body, label (small capitals in the accent color), cta (a pill button in the primary color) or badge (a box in the accent color) |
| `track_id` | string |  | Track id |

Example:

```json
{"name":"add_text","arguments":{"text":"50% OFF","start":1,"duration":2.5,"y":-0.1,"style":{"size":160,"bold":true,"color":"#ffffff","font":"Arial Black","stroke":{"color":"#000000","width":8}}}}
```

### set_text

Change a text clip's words and/or style.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Text clip id |
| `text` | string |  | New words |
| `style` | { font, size, color, bold, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text) |
| `style.font` | string |  | Font family |
| `style.size` | number |  | Pixels at 1080p canvas height (4..) |
| `style.color` | string |  | CSS color |
| `style.bold` | boolean |  | Bold |
| `style.italic` | boolean |  | Italic |
| `style.align` | "left" \| "center" \| "right" |  | Alignment |
| `style.highlight` | string |  | Captions: color of the word being spoken; an empty string turns it off |
| `style.case` | "none" \| "upper" \| "lower" \| "title" |  | Letter case as shown (the text is kept): none, upper, lower or title |
| `style.background` | { color, padding, radius } |  | A box behind the text, so it reads over busy footage; an empty color removes it |
| `style.background.color` | string | yes | CSS color, e.g. rgba(0,0,0,0.6) |
| `style.background.padding` | number |  | Pixels (0..) |
| `style.background.radius` | number |  | Corner radius, pixels (0..) |
| `style.stroke` | { color, width } |  | An outline around the letters (6-10 for titles over footage); width 0 or an empty color removes it |
| `style.stroke.color` | string | yes | CSS color |
| `style.stroke.width` | number |  | Pixels (0..) |
| `style.stroke2` | { color, width } |  | A second outline outside the first, for a sticker-like double edge |
| `style.stroke2.color` | string | yes | CSS color |
| `style.stroke2.width` | number |  | Pixels beyond the first outline; default 6 (0..) |
| `style.shadow` | { color, blur, x, y } |  | A drop shadow; an empty color removes it |
| `style.shadow.color` | string | yes | CSS color |
| `style.shadow.blur` | number |  | Pixels (0..) |
| `style.shadow.x` | number |  | Pixels |
| `style.shadow.y` | number |  | Pixels |
| `style.glow` | { color, blur, strength } |  | A neon glow around the letters |
| `style.glow.color` | string | yes | CSS color, e.g. #00e5ff |
| `style.glow.blur` | number |  | Pixels, default 24 (0..) |
| `style.glow.strength` | number |  | 1..3, how bright; default 1 (1..3) |
| `style.gradient` | { from, to, angle } |  | A two-color fill instead of color |
| `style.gradient.from` | string | yes | CSS color at the start |
| `style.gradient.to` | string | yes | CSS color at the end |
| `style.gradient.angle` | number |  | Degrees: 0 left to right (default), 90 top to bottom (-360..360) |
| `style.accent` | string |  | Color the highlightSweep marker and the underlineWipe line draw in; an empty string returns to the default |
| `style.letterSpacing` | number |  | Pixels between letters at 1080p (wide-tracked labels: 6 to 20) (-20..200) |
| `style.maxWidth` | number |  | Lines wrap past this fraction of the canvas width (default 0.9) (0.1..1) |

Example:

```json
{"name":"set_text","arguments":{"clip_id":"c_123","style":{"background":{"color":"#000000b3","padding":18,"radius":12}}}}
```

### add_text_template

Add a text template: a title design of text and box layers with in/out/loop animations, stacked above everything at that time. Templates: lowerThird, nameTag, subscribe, chapter, quote, countdown, location, opener, news, social, endCard, linkInBio. Word art (one styled text): neonPink, neonBlue, retro, comic, hollow, gold, fire, frost, yellow, hardShadow, candy, sticker, chroma, minimal, typewriter, highlight. texts replaces the template's words, text layers in order (bottom first).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Template key or label |
| `start` | number | yes | Seconds (0..) |
| `texts` | string[] |  | Words for the text layers, in order |

Example:

```json
{"name":"add_text_template","arguments":{"name":"lowerThird","start":2,"texts":["Jordan Lee","Head of Design"]}}
```

### apply_word_art

Restyle text clips with a word-art look (fill, stroke, shadow, box), keeping their words, size and position. name is a Word art key from add_text_template.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Text clips |
| `name` | string | yes | Word art key or label |

### add_sticker

Add a sticker from the built-in library (emoji, or drawn arrows, circles, underlines, bubbles, badges) as an image overlay above everything at that time. name is a sticker id, label or the emoji itself: 'fire', 'thumbs-up', 'curved-arrow-red', 'circle-yellow', 'subscribe', '🎉'. window.videoEditor.stickers() lists them; window.videoEditor.exec draws the sticker's image before placing it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | Sticker id, label or emoji |
| `start` | number | yes | Seconds (0..) |
| `duration` | number |  | Seconds; default 3 (0.04..) |
| `x` | number |  | Horizontal offset from center, -0.5..0.5 |
| `y` | number |  | Vertical offset from center, -0.5..0.5 |
| `scale` | number |  | 1 = fit the canvas; default 0.3 (0.01..) |
| `motion` | "still" \| "pop" \| "float" \| "pulse" \| "sway" \| "heartbeat" |  | Entrance and loop animation |

### add_captions

Add captions (subtitles) as caption text clips on a Captions track. Times are timeline seconds. replace=true removes existing captions first. Captions export as SRT/VTT and restyle together.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `captions` | { start, end, text, words }[] | yes | The captions, in order |
| `captions[].start` | number | yes | Seconds (0..) |
| `captions[].end` | number | yes | Seconds (0..) |
| `captions[].text` | string | yes | Words shown |
| `captions[].words` | number[] |  | Seconds each word of text starts, for the spoken-word highlight |
| `style` | { font, size, color, bold, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text) |
| `style.font` | string |  | Font family |
| `style.size` | number |  | Pixels at 1080p canvas height (4..) |
| `style.color` | string |  | CSS color |
| `style.bold` | boolean |  | Bold |
| `style.italic` | boolean |  | Italic |
| `style.align` | "left" \| "center" \| "right" |  | Alignment |
| `style.highlight` | string |  | Captions: color of the word being spoken; an empty string turns it off |
| `style.case` | "none" \| "upper" \| "lower" \| "title" |  | Letter case as shown (the text is kept): none, upper, lower or title |
| `style.background` | { color, padding, radius } |  | A box behind the text, so it reads over busy footage; an empty color removes it |
| `style.background.color` | string | yes | CSS color, e.g. rgba(0,0,0,0.6) |
| `style.background.padding` | number |  | Pixels (0..) |
| `style.background.radius` | number |  | Corner radius, pixels (0..) |
| `style.stroke` | { color, width } |  | An outline around the letters (6-10 for titles over footage); width 0 or an empty color removes it |
| `style.stroke.color` | string | yes | CSS color |
| `style.stroke.width` | number |  | Pixels (0..) |
| `style.stroke2` | { color, width } |  | A second outline outside the first, for a sticker-like double edge |
| `style.stroke2.color` | string | yes | CSS color |
| `style.stroke2.width` | number |  | Pixels beyond the first outline; default 6 (0..) |
| `style.shadow` | { color, blur, x, y } |  | A drop shadow; an empty color removes it |
| `style.shadow.color` | string | yes | CSS color |
| `style.shadow.blur` | number |  | Pixels (0..) |
| `style.shadow.x` | number |  | Pixels |
| `style.shadow.y` | number |  | Pixels |
| `style.glow` | { color, blur, strength } |  | A neon glow around the letters |
| `style.glow.color` | string | yes | CSS color, e.g. #00e5ff |
| `style.glow.blur` | number |  | Pixels, default 24 (0..) |
| `style.glow.strength` | number |  | 1..3, how bright; default 1 (1..3) |
| `style.gradient` | { from, to, angle } |  | A two-color fill instead of color |
| `style.gradient.from` | string | yes | CSS color at the start |
| `style.gradient.to` | string | yes | CSS color at the end |
| `style.gradient.angle` | number |  | Degrees: 0 left to right (default), 90 top to bottom (-360..360) |
| `style.accent` | string |  | Color the highlightSweep marker and the underlineWipe line draw in; an empty string returns to the default |
| `style.letterSpacing` | number |  | Pixels between letters at 1080p (wide-tracked labels: 6 to 20) (-20..200) |
| `style.maxWidth` | number |  | Lines wrap past this fraction of the canvas width (default 0.9) (0.1..1) |
| `y` | number |  | Vertical offset from center as a canvas fraction; 0.36 sits near the bottom |
| `replace` | boolean |  | Remove existing captions first |

### set_caption_look

Give every caption one of the built-in looks (CapCut's caption templates): classic, yellow (bold yellow capitals), boxed, pop (capitals with the spoken word highlighted), neon or minimal. Sets the whole caption style and its height; words and timings stay.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `look` | "classic" \| "yellow" \| "boxed" \| "pop" \| "neon" \| "minimal" | yes | Look |

Example:

```json
{"name":"set_caption_look","arguments":{"look":"pop"}}
```

### replace_caption_text

Find and replace in every caption's text (CapCut's caption Find and replace), e.g. to fix a name speech recognition misspelled. Any case unless match_case; whole_word skips matches inside longer words.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `find` | string | yes | Text to find |
| `replace` | string | yes | Replacement (may be empty) |
| `match_case` | boolean |  | Match case |
| `whole_word` | boolean |  | Whole words only |

### get_transcript

Hear a video or audio clip's speech on this machine (Whisper) and return its words with source-second times. Delete words by passing their spans to cut_ranges (Premiere's text-based editing).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |

## Brand and ad elements

A brand kit every part of an ad draws from, built ad elements, and titles behind the subject.

### set_brand

Set the project's brand kit, which add_text's role, apply_brand and add_ad_element draw with, so every part of an ad agrees: colors by role (CSS colors), a heading and a body font (at most two families), logo pictures by variant (asset ids from import_media; a PNG with transparency works best), the brand's name, website and tagline. Only what is given changes; an empty string removes a logo, name, url or tagline; reset clears the kit. describe_project shows it. Example: {primary: '#ff3366', accent: '#ffd23f', background: '#14101f', heading_font: 'Arial Black', body_font: 'Segoe UI', logo: 'a_123', url: 'shop.example.com'}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | Brand name (a wordmark when there is no logo) |
| `primary` | string |  | Main color: buttons, bars |
| `secondary` | string |  | Second color: panels, a lower third's second line |
| `accent` | string |  | Highlight color: badges, labels, marker sweeps |
| `background` | string |  | Behind end cards and text boxes (usually dark) |
| `text` | string |  | Text over footage and the background (usually white) |
| `heading_font` | string |  | Font family for headlines, buttons, badges |
| `body_font` | string |  | Font family for everything else |
| `logo` | string |  | Main logo: an image asset id |
| `logo_light` | string |  | Logo for dark backgrounds: an image asset id |
| `logo_dark` | string |  | Logo for light backgrounds: an image asset id |
| `logo_icon` | string |  | The mark alone: an image asset id |
| `url` | string |  | Website shown on end cards, e.g. shop.example.com |
| `tagline` | string |  | A short line: end cards and lower thirds use it by default |
| `reset` | boolean |  | Clear the brand kit (then apply the rest of this call) |

Example:

```json
{"name":"set_brand","arguments":{"name":"Northwind","primary":"#1f6feb","accent":"#ffd23f","background":"#0d1117","text":"#ffffff","heading_font":"Arial Black","body_font":"Segoe UI","logo":"a_9","url":"northwind.example","tagline":"Run further"}}
```

### apply_brand

Restyle clips with the brand kit, keeping their words, timing and place. Titles: with role, that role's whole look and size (headline, subhead, body, label, cta, badge, as add_text's role); without, only fonts and colors change (the heading font for bold display type; a box takes the primary color with a readable label; plain type the brand's text color; glows, gradients, sweeps and spoken-word highlights the accent). Solid color clips: role primary, secondary, accent, background or text sets their color (default primary).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Text or color clips |
| `role` | "headline" \| "subhead" \| "body" \| "label" \| "cta" \| "badge" \| "primary" \| "secondary" \| "accent" \| "background" \| "text" |  | A text role, or a color role for solids |

### add_ad_element

Add a finished ad element in the brand kit's colors and fonts (set_brand first; neutral defaults otherwise), laid out inside the title-safe area (on 9:16, clear of the apps' buttons and captions), animated in, its clips grouped and stacked above everything at that time. Elements: end_card (a solid card, background brand/primary/scrim/none, with the logo, headline, a call-to-action button and the url; always centered; put it last), lower_third (a name in a box over a title or role in the primary color; hold it 3 to 6 s), offer_badge (headline is the offer, e.g. '-30%' or '$49', in an accent box, tilted, pulsing; subline a small tag under it, e.g. 'Today only'), cta_button (a pill button, e.g. 'Shop now', pulsing; subline or url a line under it), logo_reveal (the logo pops in, optional glow flare and white flash, with headline or the brand name as a wordmark and the tagline). Every part is an ordinary clip to edit afterwards. Example: {element: 'end_card', start: 12, headline: 'Fresh roast, every morning', cta: 'Order now'}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `element` | "end_card" \| "lower_third" \| "offer_badge" \| "cta_button" \| "logo_reveal" | yes | Which element |
| `start` | number | yes | Timeline seconds (0..) |
| `duration` | number |  | Seconds; default end_card 3, lower_third 4, offer_badge 3, cta_button 3, logo_reveal 2.5 (0.2..) |
| `headline` | string |  | end_card headline; lower_third name; offer_badge offer; logo_reveal wordmark (default the brand name when there is no logo) |
| `subline` | string |  | lower_third title or role; offer_badge tag; cta_button line under it; logo_reveal line under the wordmark (default the tagline) |
| `cta` | string |  | Button words for end_card and cta_button; default 'Shop now' |
| `url` | string |  | end_card and cta_button: website line; default the brand's url |
| `logo` | "auto" \| "main" \| "light" \| "dark" \| "icon" \| "none" |  | Which logo variant: auto (light on dark, dark on light), main, light, dark, icon, or none |
| `position` | "top-left" \| "top" \| "top-right" \| "left" \| "center" \| "right" \| "bottom-left" \| "bottom" \| "bottom-right" |  | Where in the safe area: lower_third default bottom-left, offer_badge top-right, cta_button bottom, logo_reveal center (end_card is always centered) |
| `background` | "brand" \| "primary" \| "scrim" \| "none" |  | end_card (default brand) and logo_reveal (default none): brand background color, primary color, scrim (60% black over the footage) or none |
| `glow` | boolean |  | logo_reveal: a glow that flares as the logo lands |
| `flash` | boolean |  | logo_reveal: a white flash as the logo lands |

Example:

```json
{"name":"add_ad_element","arguments":{"element":"end_card","start":12,"headline":"Run further","cta":"Shop now"}}
```

### text_behind_subject

Put titles (or stickers) behind the person or product in a video or picture clip, the 'text behind the subject' look: the clip's background is removed on this computer (a video's matte as Remove background makes it; a picture is cut out once into a new picture; the first run downloads the model), and a copy showing only the subject goes on a new track above the titles, silent and grouped with the original so they move together. Titles below the clip are lifted above it first. Works best when a large title overlaps the subject. One undoable edit; answers the copy's id (subjectClipId).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The video or picture clip with the person or product |
| `text_clip_ids` | string[] | yes | The titles (or stickers) to put behind the subject; they must play while the video does |

Example:

```json
{"name":"text_behind_subject","arguments":{"clip_id":"c_2","text_clip_ids":["c_5"]}}
```

## Effects, transitions and color

Effects stacks, transitions at cuts, looks and the color grade.

### add_effect

Add a video effect to a visual or adjustment clip. params override the effect's defaults. Keep the strobe flash (flash) at 3 flashes a second or slower: faster flashing can trigger seizures (WCAG 2.3.1).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `type` | "blur" \| "zoomBlur" \| "pixelate" \| "rgbSplit" \| "glitch" \| "vhs" \| "grain" \| "scanlines" \| "invert" \| "posterize" \| "duotone" \| "mirror" \| "kaleidoscope" \| "fisheye" \| "shake" \| "zoomPulse" \| "zoom" \| "flash" \| "glow" \| "lightLeak" \| "denoise" \| "motionBlur" \| "sketch" \| "halftone" \| "letterbox" \| "magnify" | yes | Effect |
| `params` | object |  | Effect parameters |

Example:

```json
{"name":"add_effect","arguments":{"clip_id":"c_123","type":"glow","params":{"amount":60,"threshold":55}}}
```

### edit_effects

Manage a clip's effect stack. Move/reset/remove need effect_id; enable/disable without it affects all effects. Clear removes the entire stack. Reset/remove/clear also remove the affected effect keyframes; other settings stay unchanged.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `action` | "move_up" \| "move_down" \| "reset" \| "remove" \| "clear" \| "enable" \| "disable" | yes | Stack action |
| `effect_id` | string |  | Effect id from effectStack in describeProject |

### copy_effects

Append a source clip's effect stack and effect keyframes to target clips. Each copy gets fresh effect IDs; existing effects, grading, transforms and clip timing stay intact. Animation keeps clip-relative timing, including keys beyond a shorter target's end. Locked or nonvisual targets are rejected.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `source_clip_id` | string | yes | Clip whose effects to reuse |
| `clip_ids` | string[] | yes | Target visual or adjustment clip IDs |

### apply_effect_preset

Append a serialized effect preset (id, name, stack with effects/keyframes/fps) to visual clips. Validates catalog parameters, remaps effect IDs and converts animation timing.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Target clips |
| `preset_json` | string | yes | Effect preset JSON |

### paste_attributes

Copy selected groups from a source clip to targets. Replaces those settings/keyframes; effects append by default. Keeps timing/source offsets and respects locks.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `source_clip_id` | string | yes | Source clip |
| `clip_ids` | string[] | yes | Target clips |
| `groups` | "transform" \| "color" \| "audio" \| "effects"[] | yes | Which attributes to paste: transform, color, audio, effects |
| `replace_effects` | boolean |  | Replace target effect stacks |

### set_transition

Put a transition on the cut after a clip (the next clip must touch it). type 'none' removes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The clip before the cut |
| `type` | "dissolve" \| "dipBlack" \| "dipWhite" \| "wipeLeft" \| "wipeRight" \| "wipeUp" \| "wipeDown" \| "circleOpen" \| "clockWipe" \| "slideLeft" \| "slideRight" \| "pushLeft" \| "pushUp" \| "zoomIn" \| "zoomOut" \| "spin" \| "blur" \| "pixelate" \| "glitch" \| "flash" \| "whipLeft" \| "whipRight" \| "zoomPunch" \| "spinBlur" \| "none" | yes | Transition |
| `duration` | number |  | Seconds (0.05..) |

Example:

```json
{"name":"set_transition","arguments":{"clip_id":"c_123","type":"dissolve","duration":0.5}}
```

### set_filter

Apply a color look (filter) to a visual or adjustment clip at an intensity 0..1. type 'none' removes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `type` | "vivid" \| "bright" \| "warm" \| "cool" \| "golden" \| "teal" \| "film" \| "vintage" \| "matte" \| "cinematic" \| "moody" \| "dreamy" \| "neon" \| "forest" \| "mono" \| "noir" \| "silver" \| "none" | yes | Filter (look) |
| `intensity` | number |  | 0..1 (0..1) |

Example:

```json
{"name":"set_filter","arguments":{"clip_id":"c_123","type":"teal","intensity":0.8}}
```

### auto_adjust

Correct a video or picture clip's exposure, white balance and levels from its frame at the playhead (CapCut's Auto adjust), setting its Basic adjustment sliders.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or image clip |

### set_hsl

Adjust one of CapCut's eight HSL color ranges on a visual or adjustment clip; only pixels of that color change. hue turns the range up to 30° toward its neighbors, saturation -100 makes it gray, lightness darkens or lightens it; each -100..100, omitted values stay. band 'all' sets every range. reset=true zeroes the band(s) first. Animate with add_keyframe on adjust.hsl.<band>.hue|saturation|lightness.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Visual or adjustment clip id |
| `band` | "red" \| "orange" \| "yellow" \| "green" \| "cyan" \| "blue" \| "purple" \| "magenta" \| "all" | yes | Color range |
| `hue` | number |  | -100..100 (-100..100) |
| `saturation` | number |  | -100..100 (-100..100) |
| `lightness` | number |  | -100..100 (-100..100) |
| `reset` | boolean |  | Zero the band(s) before applying the values given |

### set_curve

Set a tone curve on a visual or adjustment clip. channel luma maps R, G and B alike (Lumetri's white curve); r, g, b are per channel. points are [input, output] pairs in 0..1, joined by a monotone cubic that never overshoots; include [0,0] and [1,1] to pin the ends. Omit points or pass [] to reset the channel. Gentle S-curve: [[0,0],[0.25,0.2],[0.75,0.8],[1,1]].

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Visual or adjustment clip id |
| `channel` | "luma" \| "r" \| "g" \| "b" | yes | Which curve |
| `points` | number[][] |  | [input, output] pairs, each 0..1 |

### set_color_wheel

Resolve-style color wheels on a visual or adjustment clip: lift (shadows; white stays put), gamma (midtones), gain (highlights; black stays put), offset (everything). y is the wheel's luminance ring; r/g/b its color balance; each -100..100. Or give hue (degrees: 0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta) and amount (0..100) to push the balance toward a color, e.g. lift hue 200 amount 12 for teal shadows. reset=true returns the wheel to neutral first. Animate with add_keyframe on adjust.wheels.<wheel>.r|g|b|y.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Visual or adjustment clip id |
| `wheel` | "lift" \| "gamma" \| "gain" \| "offset" | yes | Which wheel |
| `r` | number |  | Red balance, -100..100 (-100..100) |
| `g` | number |  | Green balance, -100..100 (-100..100) |
| `b` | number |  | Blue balance, -100..100 (-100..100) |
| `y` | number |  | Luminance, -100..100 (-100..100) |
| `hue` | number |  | Push the balance toward this hue, degrees (0..360) |
| `amount` | number |  | How far toward hue, 0..100 (default 20) (0..100) |
| `reset` | boolean |  | Neutral before applying the values given |

### apply_lut

Apply a .cube LUT to a visual or adjustment clip, mixed in at intensity 0..1 (default 1). lut_id is from the project's luts (describeProject lists them; files are imported with window.videoEditor.importLuts or by dropping a .cube on the app). lut_id 'none' removes it. Animate with add_keyframe on adjust.lut.intensity.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Visual or adjustment clip id |
| `lut_id` | string | yes | LUT id, or 'none' |
| `intensity` | number |  | 0..1 (0..1) |

## Sound

Voice, music, effects and the mix.

### add_voiceover

Narrate a script: every line is spoken on this computer (Kokoro) and placed one after another at its real length on a new Voiceover track, with a caption for each timed to its voice, as one undo step. A line's at pins it to a time. Answers each line's start, end and clip ids, so the footage can be cut to the voice. Voices: af_heart, af_bella, af_nicole, am_michael, am_fenrir, bf_emma, bm_george, bm_fable. The first use downloads the speech model (about 90 MB); a line takes a second or two.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `lines` | { text, at }[] | yes | The script, one sentence or two per line |
| `lines[].text` | string | yes | Words to say (and show) |
| `lines[].at` | number |  | Timeline seconds; default right after the line before (0..) |
| `voice` | string |  | Voice id, default af_heart |
| `speed` | number |  | 1 is natural (0.5..2) |
| `start` | number |  | Seconds the first line starts, default 0 (0..) |
| `gap` | number |  | Seconds between lines, default 0.4 (0..) |
| `captions` | boolean |  | A caption per line (default true) |
| `enhance` | boolean |  | Even out each voice with the Enhance voice compressor (default true) |
| `caption_style` | { font, size, color, bold, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, maxWidth } |  | The captions' look: the same fields as add_text's style |
| `caption_style.font` | string |  | Font family |
| `caption_style.size` | number |  | Pixels at 1080p canvas height (4..) |
| `caption_style.color` | string |  | CSS color |
| `caption_style.bold` | boolean |  | Bold |
| `caption_style.italic` | boolean |  | Italic |
| `caption_style.align` | "left" \| "center" \| "right" |  | Alignment |
| `caption_style.highlight` | string |  | Captions: color of the word being spoken; an empty string turns it off |
| `caption_style.case` | "none" \| "upper" \| "lower" \| "title" |  | Letter case as shown (the text is kept): none, upper, lower or title |
| `caption_style.background` | { color, padding, radius } |  | A box behind the text, so it reads over busy footage; an empty color removes it |
| `caption_style.background.color` | string | yes | CSS color, e.g. rgba(0,0,0,0.6) |
| `caption_style.background.padding` | number |  | Pixels (0..) |
| `caption_style.background.radius` | number |  | Corner radius, pixels (0..) |
| `caption_style.stroke` | { color, width } |  | An outline around the letters (6-10 for titles over footage); width 0 or an empty color removes it |
| `caption_style.stroke.color` | string | yes | CSS color |
| `caption_style.stroke.width` | number |  | Pixels (0..) |
| `caption_style.stroke2` | { color, width } |  | A second outline outside the first, for a sticker-like double edge |
| `caption_style.stroke2.color` | string | yes | CSS color |
| `caption_style.stroke2.width` | number |  | Pixels beyond the first outline; default 6 (0..) |
| `caption_style.shadow` | { color, blur, x, y } |  | A drop shadow; an empty color removes it |
| `caption_style.shadow.color` | string | yes | CSS color |
| `caption_style.shadow.blur` | number |  | Pixels (0..) |
| `caption_style.shadow.x` | number |  | Pixels |
| `caption_style.shadow.y` | number |  | Pixels |
| `caption_style.glow` | { color, blur, strength } |  | A neon glow around the letters |
| `caption_style.glow.color` | string | yes | CSS color, e.g. #00e5ff |
| `caption_style.glow.blur` | number |  | Pixels, default 24 (0..) |
| `caption_style.glow.strength` | number |  | 1..3, how bright; default 1 (1..3) |
| `caption_style.gradient` | { from, to, angle } |  | A two-color fill instead of color |
| `caption_style.gradient.from` | string | yes | CSS color at the start |
| `caption_style.gradient.to` | string | yes | CSS color at the end |
| `caption_style.gradient.angle` | number |  | Degrees: 0 left to right (default), 90 top to bottom (-360..360) |
| `caption_style.accent` | string |  | Color the highlightSweep marker and the underlineWipe line draw in; an empty string returns to the default |
| `caption_style.letterSpacing` | number |  | Pixels between letters at 1080p (wide-tracked labels: 6 to 20) (-20..200) |
| `caption_style.maxWidth` | number |  | Lines wrap past this fraction of the canvas width (default 0.9) (0.1..1) |
| `caption_y` | number |  | Captions' vertical offset from center, canvas fraction (default 0.36) |

Example:

```json
{"name":"add_voiceover","arguments":{"lines":[{"text":"Meet the lightest bottle we have ever made."},{"text":"Cold for 24 hours."}],"voice":"af_heart"}}
```

### text_to_speech

Read a title aloud in a voice made on this computer (Kokoro), placing the voice on an audio track at the title's start. Voices: af_heart, af_bella, af_nicole, am_michael, am_fenrir, bf_emma, bm_george, bm_fable. The first use downloads the speech model (about 90 MB).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The title (text clip) |
| `voice` | string |  | Voice id, default af_heart |
| `speed` | number |  | 1 is natural (0.5..2) |

### add_sound_effect

Add a built-in sound effect, made on this computer: whoosh (Whoosh, 0.8 s), swish (Swish, 0.35 s), pop (Pop, 0.15 s), click (Click, 0.06 s), ding (Ding, 1.4 s), success (Success, 0.5 s), rise (Riser, 2 s), impact (Impact, 1.2 s), subDrop (Sub drop, 1.8 s), braam (Braam, 3 s), reverseCymbal (Reverse cymbal, 2 s), glitch (Glitch, 0.5 s), shutter (Camera shutter, 0.25 s), swooshUp (Swoosh up, 0.9 s), boom (Boom, 1.5 s). It lands on an audio track at `start` (default the playhead), or so that it ENDS at `end_at`: a riser or reverse cymbal then peaks exactly there (put end_at on the drop or a cut); a hit, boom or sub drop goes at the beat with start. The file is made once per project and reused.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | "whoosh" \| "swish" \| "pop" \| "click" \| "ding" \| "success" \| "rise" \| "impact" \| "subDrop" \| "braam" \| "reverseCymbal" \| "glitch" \| "shutter" \| "swooshUp" \| "boom" | yes | Which effect (list_catalog section sound_effects has their lengths) |
| `start` | number |  | Timeline seconds the sound starts (0..) |
| `end_at` | number |  | Timeline seconds the sound ends instead (start = end_at - its length) (0..) |

Example:

```json
{"name":"add_sound_effect","arguments":{"name":"whoosh","start":3.9}}
```

### set_fades

Fade a clip's sound in and out, in SECONDS (a music bed: fade_in 1, fade_out 2). Works on audio clips and on video clips' own sound; a value left out keeps its fade, 0 removes it. Each fade is at most half the clip. Pictures fade with set_animation (slot in or out, type fade).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Audio or video clips |
| `fade_in` | number |  | Seconds (0..) |
| `fade_out` | number |  | Seconds (0..) |

Example:

```json
{"name":"set_fades","arguments":{"clip_ids":["c_123"],"fade_in":1,"fade_out":2}}
```

### set_audio_filter

Filter a video or audio clip's sound, 24 dB per octave. type lowpass keeps the lows (muffled, as through a wall or from the next room); highpass keeps the highs (thin, as on a phone or a small radio). cutoff in Hz, 20..20000 (a new filter starts at 500 Hz low-pass, 300 Hz high-pass); without sweep it is fixed (its keyframes go). resonance in dB, 0..24 (default 0, a smooth slope; 6..12 adds the whistling peak of a synth sweep). sweep moves the cutoff from cutoff at sweep.start to sweep.to at sweep.end (timeline seconds), on a log scale, holding before and after; it replaces the cutoff's keyframes. The trailer move "muffled build, open on the drop" at 5 s: {type: "lowpass", cutoff: 400, sweep: {to: 20000, start: 4.5, end: 5}}. add_keyframe on lowpass.cutoff or highpass.cutoff adds more points. off: true removes that filter and its keyframes.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `type` | "lowpass" \| "highpass" | yes | Which filter |
| `cutoff` | number |  | Hz (at sweep.start when sweeping) (20..20000) |
| `resonance` | number |  | Peak at the cutoff, dB; 0 = smooth (0..24) |
| `sweep` | { to, start, end, ease } |  | Move the cutoff from cutoff to `to` between two times (a filter sweep): keyframes, so it plays the same in preview and export |
| `sweep.to` | number | yes | Cutoff at the end of the sweep, Hz (20..20000) |
| `sweep.start` | number | yes | Timeline seconds the sweep begins (0..) |
| `sweep.end` | number | yes | Timeline seconds it arrives (0..) |
| `sweep.ease` | "linear" \| "easeIn" \| "easeOut" \| "easeInOut" |  | Curve of the sweep (default linear: the same octaves each second) |
| `off` | boolean |  | Remove this filter |

Example:

```json
{"name":"set_audio_filter","arguments":{"clip_ids":["c_3"],"type":"lowpass","cutoff":400,"sweep":{"to":18000,"start":6,"end":8.4,"ease":"easeIn"}}}
```

### set_reverb

Put a video or audio clip's sound in a room (a convolution reverb). preset room (small and close), hall (a concert hall; what a new reverb starts as) or cathedral (huge and long, for trailers and epic edits). size 0..1 (pre-delay 5 to 50 ms, slower build), decay: seconds for the tail to fall 60 dB (0.1..10), mix: wet share 0..1 at equal power, so the clip stays as loud (0.2 subtle, 0.5 drenched). It comes after the clip's volume and its tail rings on past the clip's end, so a voice's last word hangs in the room. Values left out keep theirs, or the preset's. A reverb throw on one word: add_keyframe on reverb.mix. off: true removes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `preset` | "room" \| "hall" \| "cathedral" |  | Starting point |
| `size` | number |  | Room size, 0..1 (0..1) |
| `decay` | number |  | Seconds to fall 60 dB (RT60) (0.1..10) |
| `mix` | number |  | Wet share, 0..1 (0..1) |
| `off` | boolean |  | Remove the reverb |

Example:

```json
{"name":"set_reverb","arguments":{"clip_ids":["c_9"],"preset":"hall","mix":0.25}}
```

### set_echo

Repeat a video or audio clip's sound (a delay). time: seconds between repeats, 0.01..2 (0.08-0.15 a slapback, 0.3-0.5 an echo; on music 60/BPM lands on the beat). feedback: each repeat's level against the one before, 0..0.9 (0.4 gives a few repeats, 0.8 a long trail). mix: wet share 0..1 at equal power. A new echo is 0.35 s, 0.4, 0.3; values left out keep theirs. It comes after the clip's volume, so the repeats ring on past the clip's end: an echo on a short hit or sound effect trails off after it. Echo one word only: add_keyframe on echo.mix. off: true removes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `time` | number |  | Seconds between repeats (0.01..2) |
| `feedback` | number |  | Each repeat's level against the one before (0..0.9) |
| `mix` | number |  | Wet share, 0..1 (0..1) |
| `off` | boolean |  | Remove the echo |

Example:

```json
{"name":"set_echo","arguments":{"clip_ids":["c_9"],"time":0.375,"feedback":0.4,"mix":0.3}}
```

### set_tape_stop

Make a video or audio clip's sound slow to a stop over its last `duration` seconds, its pitch diving with it, as a turntable or tape machine losing power: the classic ending, or a cut into silence before a drop. duration 0.05..10 seconds (default 1; 0.5 a quick stop, 2-3 a long wind-down; never more than the clip). Only the sound stops; a video's picture plays on. Splitting the clip keeps it on the part with the end. off: true removes it.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `duration` | number |  | Seconds the stop takes (0.05..10) |
| `off` | boolean |  | Remove the tape stop |

Example:

```json
{"name":"set_tape_stop","arguments":{"clip_ids":["c_3"],"duration":0.8}}
```

### set_compressor

Even out a clip's sound with a compressor after its EQ (CapCut's Enhance voice, Premiere's Dynamics): preset voice (speech; the usual choice), gentle, strong, or off. threshold (dBFS), ratio, knee (dB), attack and release (seconds) and makeup (dB) adjust it. normalize_loudness measures through it, and export loudness reaches its target with far less limiting.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `preset` | "voice" \| "gentle" \| "strong" \| "off" |  | Starting point |
| `threshold` | number |  | dBFS where compression starts (-60..0) |
| `ratio` | number |  | dB in over the threshold per dB out (1..20) |
| `knee` | number |  | Soft knee, dB (0..40) |
| `attack` | number |  | Seconds (0..1) |
| `release` | number |  | Seconds (0..1) |
| `makeup` | number |  | Extra dB after the compressor's own makeup gain (presets: 0) (0..24) |

### set_channel_fill

Play one channel of a video's or audio clip's sound on both sides (Premiere's Fill Left / Fill Right), e.g. a lav mic recorded on one channel. both = as recorded.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clips |
| `fill` | "both" \| "left" \| "right" | yes | Which channel fills both |

### normalize_loudness

Measure clips' loudness (EBU R128) and set their volume to reach a target without their true peak passing the ceiling (-1 dBTP; -2 for ATSC). -14 LUFS suits social video, -16 podcasts, -23 European broadcast, -24 US TV. spec names a delivery spec instead (its target and ceiling). Each clip is measured alone: measure_loudness checks the mix.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clip ids |
| `target` | number |  | LUFS, default -14 (-40..-5) |
| `spec` | "online" \| "ebu_r128" \| "atsc_a85" |  | online (-14 LUFS, -1 dBTP), ebu_r128 (-23 LUFS, -1 dBTP) or atsc_a85 (-24 LKFS, -2 dBTP); overrides target |

### duck_under_speech

Lower a music clip wherever the other clips with sound under it have speech, as editable volume keyframes (replaces its volume keyframes).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The music clip |
| `depth` | number |  | dB to lower, default 12 (1..40) |

Example:

```json
{"name":"duck_under_speech","arguments":{"clip_id":"c_music","depth":12}}
```

### reduce_noise

Take steady background noise (hiss, hum, fans, room tone) out of a clip's sound on this computer; the clip then plays a cleaned copy (a video's sound is extracted to an audio clip first).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `strength` | number |  | 0.5 gentle, 0.75 default, 1 strong (0..1) |

### sync_audio

Line up a separately recorded sound (a lav, a recorder) with the camera clip of the same take by matching their waveforms on this computer (CapCut's Sync video and audio, Resolve's Auto Sync Audio), then move the audio clip into sync, exact to the sample (one undo step; sound before 0 is trimmed off its head). Answers the offset (audio source seconds minus video source seconds) and a confidence; refuses when the sounds do not clearly match. sync_to_clip places it by a known offset instead.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The audio clip to move |
| `video_clip_id` | string |  | The camera clip; default the video with sound that plays with it longest |
| `mute_camera` | boolean |  | Set the video's volume to 0 (default false) |

### remove_silences

Find the pauses in a clip's speech and cut them out, closing the gaps (one undo step). Returns the silent source ranges and seconds saved.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `sensitivity` | number |  | 0..1, default 0.5 (0..1) |
| `min_silence` | number |  | Shortest pause to cut, seconds (default 0.4) (0..) |
| `padding` | number |  | Kept around speech, seconds (default 0.1) (0..) |

### remove_filler_words

Transcribe a clip's speech on this machine (Whisper) and cut its filler words (um, hmm, ah) with the hesitation around each, closing the gaps (one undo step). Whisper does not transcribe "uh", so those stay. Returns the source ranges cut and the words heard.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip id |
| `model` | string |  | Whisper model id (default onnx-community/whisper-base.en_timestamped) |

## Check and deliver

Look at the media and the result, check it against the rules, then export.

### preview_media

Look inside an imported video before cutting it: a contact sheet of its own frames at source seconds (times), or `count` frames spread over the whole file (default 12). Use it to choose the in-points and moments worth using (a hero shot, a reaction, the action).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string | yes | A video asset id from describe_project or import_media |
| `times` | number[] |  | Source seconds, up to 24 |
| `count` | integer |  | Frames spread over the file when times is not given; default 12 (2..24) |
| `columns` | integer |  | Default 4 (1..6) |
| `tile_width` | integer |  | Default 320 (120..640) |

Example:

```json
{"name":"preview_media","arguments":{"asset_id":"a_123","count":12}}
```

### preview_frames

See several moments at once: one PNG contact sheet of the frames at the given times, each stamped with its time. Check a whole edit in one call, then preview_frame a moment that needs a closer look.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `times` | number[] | yes | Seconds, up to 24 |
| `columns` | integer |  | Default 4 (1..6) |
| `tile_width` | integer |  | Width of each frame, default 320 (120..640) |

Example:

```json
{"name":"preview_frames","arguments":{"times":[0.5,2,4,6,8,10,12,14]}}
```

### preview_motion

See movement and timing: consecutive frames of a stretch of the timeline (default 8 a second, at most 36) as one contact sheet, plus, as text, the cuts on the main track and the markers (beats) in that stretch. Use it to check that cuts land on the beat, a move is smooth, or a transition reads; preview_frames is for whole-video overviews.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `start` | number | yes | Timeline seconds (0..) |
| `end` | number |  | Timeline seconds; default start + 2 (0..) |
| `fps` | number |  | Frames a second, default 8 (1..30) |
| `columns` | integer |  | Default 6 (1..8) |
| `tile_width` | integer |  | Default 240 (120..480) |

Example:

```json
{"name":"preview_motion","arguments":{"start":7.5,"end":9.5,"fps":10}}
```

### preview_frame

See the composited picture at a time: returns a PNG image of the frame exactly as it would export.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `at` | number | yes | Seconds (0..) |
| `max_width` | integer |  | Image width, default 640 (64..1920) |

### check_project

Check the edit against professional rules before exporting: text outside the 90% title-safe area or under the vertical apps' buttons, text too small or too short to read, captions over 20 characters a second, more than two fonts, flashes over 3 a second (seizure risk), black gaps on the main track, music ending without a fade, and by kind: an ad's end card, an epic edit's cuts on the beat. Each finding names the clip, the time and the tool that fixes it. Run it, fix, run it again.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `kind` | "ad" \| "epic_edit" \| "social_short" \| "any" |  | What is being made; default any |

Example:

```json
{"name":"check_project","arguments":{"kind":"ad"}}
```

### measure_loudness

Measure the mix the way export renders it (48 kHz stereo, every clip's effects, tails and fades) and check it against a delivery spec before exporting. Answers integrated_lufs (BS.1770), loudness_range_lu (EBU Tech 3342 LRA), short_term_max_lufs (loudest 3 s), momentary_max_lufs (loudest 400 ms), true_peak_dbtp (4x oversampled) and sample_peak_dbfs, then pass and the problems against spec: online (-14 LUFS ±1, at most -1 dBTP: YouTube, Spotify, TikTok), ebu_r128 (-23 LUFS ±0.5, at most -1 dBTP: European broadcast) or atsc_a85 (-24 LKFS ±2, at most -2 dBTP: US TV); all three when spec is left out. loudness measures what export_video with that loudness delivers (the mix raised or lowered, its true peak held by the limiter), so a failing mix can be checked as exported: {spec: "ebu_r128", loudness: -23}. start and end (timeline seconds) measure part of it. It takes about a quarter of the mix's length to run (a 60 s mix, some 15 s), twice that with loudness.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `spec` | "online" \| "ebu_r128" \| "atsc_a85" |  | Delivery spec to check; default all three |
| `loudness` | number |  | Measure as export_video with this loudness (LUFS) delivers it; default as mixed (-40..-5) |
| `start` | number |  | Timeline seconds, default 0 (0..) |
| `end` | number |  | Timeline seconds, default the end (0..) |

Example:

```json
{"name":"measure_loudness","arguments":{"spec":"online","loudness":-14}}
```

### export_video

Export the open project to a video file in the user's Videos folder (in a folder named after the app), with no dialog; an existing file is never replaced. Returns the file's path when done. loudness brings the mix to an integrated LUFS with its true peak held under -1 dBTP: -14 for YouTube, TikTok and Spotify, -23 for EBU R128 broadcast, -24 for ATSC A/85 US TV (held under -2 dBTP); the answer's loudness says what the mix reached. Exports that take over about four minutes answer state running: follow them with export_status.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | File name without extension; default the project's name |
| `format` | "mp4" \| "mov" \| "webm" \| "mkv" \| "gif" |  | Default mp4 (H.264 + AAC) |
| `resolution` | "480p" \| "720p" \| "1080p" \| "2k" \| "4k" |  | Short side; default from the project |
| `quality` | "lower" \| "recommended" \| "higher" |  | Default recommended |
| `loudness` | number |  | Integrated LUFS for the mix; default as mixed (-40..-5) |
| `start` | number |  | Export from this second (0..) |
| `end` | number |  | Export to this second (0..) |

Example:

```json
{"name":"export_video","arguments":{"name":"spring-sale-16x9","resolution":"1080p","quality":"higher","loudness":-14}}
```

### export_versions

Export the deliverables of an ad in one call, each a separate file in the user's Videos folder (in a folder named after the app; on the web, a save dialog per file), the project left exactly as it is. A version is a ratio (16:9, 9:16, 1:1, 4:5, or original), optionally a duration in seconds (a cut-down: the opening and the end card are kept, the middle cut out, the music fading at the new end) and textless (titles and captions off: the master that other languages are cut from). Footage that fills the frame keeps filling it (fit fill), or fits over a blurred copy of itself (blur) or over the background (fit); titles, logos and badges keep their size against the frame's short side and are moved inside its title-safe area (on 9:16 clear of the apps' buttons and captions). Ask with versions, or with ratios and durations (every ratio at every duration) plus textless for one textless master. check: true answers one contact sheet of every version (three moments each) and exports nothing: look at it first. Exports that take over about four minutes answer state running: follow them with export_status. Example: {ratios: ['16:9', '9:16', '1:1'], durations: [15, 6], textless: true, loudness: -14}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `versions` | { ratio, duration, textless, fit, name }[] |  | Versions spelled out, e.g. [{ratio: '9:16', duration: 6}] |
| `versions[].ratio` | "16:9" \| "9:16" \| "1:1" \| "4:5" \| "original" | yes | Frame shape; original keeps the project's |
| `versions[].duration` | number |  | Seconds; shorter than the project makes a cut-down (1..) |
| `versions[].textless` | boolean |  | Titles and captions off |
| `versions[].fit` | "fill" \| "blur" \| "fit" |  | How full-frame footage meets a new shape: fill (default), blur, fit |
| `versions[].name` | string |  | File name without extension; default the project's name and the version, e.g. 'Roast 9x16 6s' |
| `ratios` | "16:9" \| "9:16" \| "1:1" \| "4:5" \| "original"[] |  | Every one of these shapes... |
| `durations` | number[] |  | ...at every one of these lengths in seconds (one as long as the project is the full version); e.g. [30, 15, 6] |
| `textless` | boolean |  | Also a textless version, in the first ratio |
| `fit` | "fill" \| "blur" \| "fit" |  | For every version that does not say: fill (default), blur or fit |
| `keep_end` | number |  | Seconds of the end every cut-down keeps; default the end card's length (add_ad_element end_card), else 0 (0..) |
| `check` | boolean |  | true: answer a contact sheet of every version and export nothing |
| `format` | "mp4" \| "mov" \| "webm" \| "mkv" |  | Default mp4 (H.264 + AAC) |
| `resolution` | "480p" \| "720p" \| "1080p" \| "2k" \| "4k" |  | Short side; default from the project |
| `quality` | "lower" \| "recommended" \| "higher" |  | Default recommended |
| `loudness` | number |  | Integrated LUFS for every version's mix, e.g. -14; default as mixed (-40..-5) |

Example:

```json
{"name":"export_versions","arguments":{"ratios":["16:9","9:16","1:1"],"durations":[15,6],"textless":true,"loudness":-14,"check":true}}
```

### export_status

The last export_video: running (fraction done, eta seconds), done (path, bytes, seconds) or failed (message).

No parameters.
