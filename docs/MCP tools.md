# MCP tools

<!-- Generated from src/lib/mcpGuide.ts and the tool definitions by
     `UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts` in openframe-application/;
     npm test fails when this file is out of date. Do not edit by hand. -->

Every tool the editor offers an AI model over MCP, 167 in all, in the order a video gets made. How to connect is in [[Automation]]; the playbooks are in [[Agent playbook]]. Every edit is undoable; times are seconds; ids come from describe_project.

## What the server tells a model first

The server's instructions, kept short because some clients copy them into every tool's description ([[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]]):

```text
You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable. Call help first: the steps that make a video, tool by tool; help with topic ad, epic_edit, voiceover or social_short is a playbook, with a tool's name its parameters and an example. Times are seconds; positions are fractions of the canvas from its center (x right, y down); rectangles (box, region) are a top-left corner and a size, fractions of the picture. Work in a new_project: the user's own projects stay untouched.
```

## The guide (help's overview)

```text
You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable (undo).
Conventions: times are seconds; positions are fractions of the canvas from its center (x right, y down; 0.35 is near the bottom), but rectangles (box, region) are a top-left corner and a size, fractions of the picture; scale 1 fits a picture inside the canvas; ids come from describe_project and stay stable (new_project answers its tracks' ids; describe_project clips false lists the tracks alone). Edits answer with only what they changed; four or more clips in a list give what they all share once, in added_clips_common or changed_clips_common, and markers that moved with their clip are counted in moved_markers; describe_project has the whole timeline.
The main track (the bottom video track) and what sits on it: a gap on it stays until a call closes it (ripple: true, close_gaps, lift_range); a black pause is safest as a color clip in it (add_color_clip color #000000, track_id the main track's). A clip on another track that sits on a main-track shot (over more than half of the clip: a title, a picture-in-picture, a sound effect) moves with that shot whenever an edit moves it: a ripple trim, an insert, a ripple delete, a closed gap, a speed change, a move; a clip across several shots (a voice line, a caption, a grade) moves when everything under it moved by one amount, as through an insert or a freeze before it, and stays when they moved apart; a music track's clips stay, the song being the grid the picture is cut to. Every clip an edit moves is in its answer's changed_clips, and a gap that closes is named in its notes.
Before you start: help (the tools by step), help with topic ad, epic_edit, voiceover or social_short (playbooks), help with topic design (the design rules they all follow), list_catalog (every effect, transition, animation, template, look, sound effect, voice and font by name), help with a tool's name (its parameters and an example).
To make a video:
1. new_project, so the user's projects stay untouched (open_project returns to one; list_projects finds them); set_project for the canvas shape.
2. import_media the footage, music, logo and pictures by absolute path; preview_media shows what is inside each video, to choose the moments worth using.
3. Write the script and add_voiceover (help topic voiceover: casting, pace, pauses, pronunciations): the voice and matching captions, timed to the real speech; it answers where each line landed. review_voiceover hears it back line by line; retake_voiceover fixes a line in place.
4. Lay shots under each line with add_media_clip; frame_region zooms a shot onto the part that matters and moves between regions (moves); on a screen recording add_callout rings the part the voice names and stays on it through the zooms; for music-driven edits, Music-synced below.
5. Titles: add_text (style.stroke, style.shadow or style.background keep it readable over footage), then set_animation in and out; add_text_template for lower thirds and end cards.
6. set_transition between shots; one look over everything (set_filter or apply_lut on an adjustment clip); music on an audio track, duck_under_speech under the voice, set_fades at the end; add_sound_effect on reveals, add_ambience for the place's own sound (wind, water, rain, a city, a rocket's rumble, room tone).
7. Make many small edits at once with batch: one call, one undo step.
8. Check: preview_frames (a contact sheet of many moments), preview_motion around cuts and moves (frames in a row, with the beats), preview_audio to hear the mix or one stem (an MP3 and its measurements), check_project (the design rules, each finding naming the tool that fixes it); fix, then check again.
9. export_video writes the file to the user's Videos folder (or the absolute folder you name) and returns its path; loudness -14 suits online video.
Music: generate_music composes an original score fitted to the edit (sections with bars or times, a drop where the climax is, the final hit on the end card) and answers its cue sheet; plan_music tries a form first.
Music-synced (epic, hype, velocity) edits: add the music, analyze_music (markers bars and drop), fit_music drop_at to place the drop, cut_to_beats the shots, add_beat_hits, set_speed_ramp a shot onto a beat, add_cinematic_bars, add_sound_effect end_at (a riser into the drop), then fit_music to end it.
Sound design: set_audio_filter (a low-pass sweep opening on the drop), set_reverb, set_echo, set_tape_stop; measure_loudness checks the mix against online, ebu_r128 or atsc_a85 before export.

For an ad: set_brand first (colors, two fonts, logo), then add_text with a role, set_animation per word or letter (wordPop, typewriter, unit), add_ad_element for lower thirds, offers, calls to action and the end card, text_behind_subject for a title behind a person, set_fades on the music, and export_versions for every shape and cut-down (check: true shows them first).
```

## Contents

- **Start here**: `help`, `describe_project`, `list_catalog`
- **Projects**: `list_projects`, `open_project`, `new_project`, `save_project_copy`, `open_project_file`, `collect_project`, `set_project`
- **Media**: `import_media`, `remove_media`, `relink_media`, `replace_clip`, `rename_media`, `edit_media_folder`, `organize_media`
- **Timeline**: `add_media_clip`, `add_color_clip`, `add_adjustment_clip`, `add_track`, `update_track`, `move_track`, `delete_track`, `split`, `split_at_times`, `trim_clip`, `roll_edit`, `slip_clip`, `move_clip`, `nudge_clips`, `duplicate_clips`, `delete_clips`, `lift_range`, `close_gaps`, `cut_ranges`, `split_scenes`, `group_clips`, `ungroup_clips`, `transform_group`, `set_clip_enabled`, `set_clip_label`, `rename_clip`, `freeze_frame`, `detach_audio`, `sync_to_clip`, `create_compound_clip`, `break_compound_clip`, `edit_compound`, `rename_compound`, `batch`, `undo`, `redo`, `seek`
- **Music, beats and markers**: `generate_music`, `plan_music`, `analyze_music`, `set_music_grid`, `cut_music`, `cut_to_beats`, `add_beat_hits`, `fit_music`, `mark_beats`, `add_marker`, `add_markers`, `update_marker`, `delete_markers`
- **Picture and motion**: `set_param`, `add_keyframe`, `move_keyframe`, `move_motion_point`, `set_keyframe_ease`, `remove_keyframes`, `frame_region`, `frame_clips`, `apply_layout`, `align_clips`, `distribute_clips`, `set_uniform_scale`, `set_flip`, `set_crop`, `set_mask`, `set_blend`, `set_chroma_key`, `set_canvas_fill`, `set_background_removal`, `remove_background`, `set_animation`, `add_cinematic_bars`, `track_motion`, `auto_reframe`, `stabilize_clip`
- **Graphics and compositing**: `add_shape`, `set_shape`, `add_callout`, `set_anchor`, `set_shadow`, `set_border`, `set_tilt`, `set_track_matte`, `set_motion_blur`, `set_edge_mode`, `set_wiggle`
- **Speed**: `set_speed`, `set_speed_curve`, `set_speed_ramp`, `set_reverse`, `set_preserve_pitch`, `set_frame_blending`
- **Text and captions**: `add_text`, `set_text`, `style_text_range`, `animate_text_style`, `add_text_template`, `apply_word_art`, `add_sticker`, `add_captions`, `set_caption_look`, `replace_caption_text`, `get_transcript`
- **Brand and ad elements**: `set_brand`, `apply_brand`, `add_ad_element`, `text_behind_subject`
- **Effects, transitions and color**: `add_effect`, `edit_effects`, `copy_effects`, `apply_effect_preset`, `paste_attributes`, `set_transition`, `set_filter`, `auto_adjust`, `set_hsl`, `set_curve`, `set_color_wheel`, `apply_lut`, `set_colorize`
- **Sound**: `add_voiceover`, `review_voiceover`, `retake_voiceover`, `text_to_speech`, `add_sound_effect`, `add_ambience`, `set_fades`, `set_audio_filter`, `set_reverb`, `set_echo`, `set_tape_stop`, `set_compressor`, `set_channel_fill`, `set_crossfade`, `normalize_loudness`, `duck_under_speech`, `reduce_noise`, `sync_audio`, `remove_silences`, `remove_filler_words`
- **Check and deliver**: `preview_media`, `preview_frames`, `preview_motion`, `preview_frame`, `preview_audio`, `check_project`, `measure_loudness`, `export_video`, `export_versions`, `export_status`

## Start here

Read before editing: the guide, the timeline and the names the tools accept.

### help

The guide to these tools. topic: overview (the tools by step; start here), ad, epic_edit, voiceover or social_short (step-by-step playbooks), design (the rules of thumb every playbook follows, given once here), catalog, params (set_param paths), or any tool's name for its parameters and an example call.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `topic` | string |  | overview (default), design, ad, epic_edit, voiceover, social_short, catalog, params, or a tool's name |

Example:

```json
{"name":"help","arguments":{"topic":"ad"}}
```

### describe_project

Read the timeline: canvas, fps, duration, assets, tracks and clips with ids and times in seconds (a media clip's in/out and speed, keyframes, effects and look), markers and compound clips' nested timelines. Call this first and after edits. A long project's timeline runs to thousands of tokens, so ask for less: clip_ids (one clip's in-point and keyframes), track_ids or a stretch (start, end) narrow the clips (a stretch lists every track, those with nothing in it empty), and the media and markers listed follow them; clips false answers the tracks alone (ids, names, kinds, which is main, how many clips each holds) for a few hundred bytes; shown says how much of each list is in the answer. Example: {"clip_ids": ["c_12"]}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] |  | Only these clips, each under its track (or its compound) |
| `track_ids` | string[] |  | Only these tracks, each listed empty or not |
| `start` | number |  | Only clips still playing after this timeline second (0..) |
| `end` | number |  | Only clips starting before this timeline second; the same as start: what plays at that moment (0..) |
| `assets` | boolean |  | false: no media list; true: all of it (default: all, or the clips' own when narrowed) |
| `markers` | boolean |  | false: no markers; true: all (default: all, or those in the stretch or on the clips shown) |
| `compounds` | boolean |  | false: no nested timelines (default: all, or those the clips shown play) |
| `clips` | boolean |  | false: the tracks alone, each with its clip count instead of its clips (the cheap way to learn track ids); media, markers and nested timelines then only when asked true |
| `brand` | boolean |  | The brand kit (set_brand): given with the whole timeline, left out of a narrowed answer unless true; false leaves it out of the whole one |

### list_catalog

Every name the edit tools accept. With no section: an index of all sections (effects, transitions, animations, filters, text_templates, caption_looks, speed_presets, sound_effects, ambience, voices, blend_modes, mask_shapes, fonts, canvas_ratios, export_presets, sticker_motions, stickers, param_paths). With a section: its details, such as each effect's parameters with ranges and defaults, or each voice's accent, gender, grade, character and what to cast it for. section stickers with a query searches the sticker library.

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

Save the project in the editor and open another, by id or by name (any case; the most recently edited wins a tie). Answers a summary (name, canvas, fps, duration, counts, and each track's id, name, kind and clip count); describe_project has the timeline.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `project` | string | yes | Project id or name |

### new_project

Save the project in the editor and start a new, empty one (1920x1080, 30 fps; set_project changes them). Work in one to leave the user's projects untouched. Answers a summary with its tracks' ids (the main track's among them); describe_project has the timeline.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | Project name; default: the date and time |

Example:

```json
{"name":"new_project","arguments":{"name":"Spring sale ad"}}
```

### save_project_copy

Save the open project as a copy under a new name, sharing its media, and open the copy (default) or stay. For a variant worked by hand, or a try that may be thrown away; the original stays as it was. For another shape of the same film, export_versions with save_projects saves it already laid out in that shape, to fine-tune.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | The copy's name, e.g. 'Ember Roast 16x9' |
| `open` | boolean |  | Open the copy to edit it (default true) |

Example:

```json
{"name":"save_project_copy","arguments":{"name":"Ember Roast 16x9","open":true}}
```

### open_project_file

Open a project JSON as a new project identity. Desktop resolves relative media beside the file; missing media can be relinked. Omit path to use the picker. Answers a summary (name, canvas, fps, duration, counts); describe_project has the timeline.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `path` | string |  | Absolute desktop path to a project JSON file; omit for the native or browser picker |

### collect_project

Copy the project JSON and its local media (proxies, LUTs and cutouts too) into a new folder named after the project (numbered when the name is taken), so it opens on another computer; nothing existing is overwritten. folder (an absolute path, created if missing) is where that new folder goes; without it the native dialog asks. Desktop only (the web downloads the JSON from File > Collect files). Answers the collected project.json's path.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `folder` | string |  | Absolute folder the collected project's new folder goes in, created if missing (desktop only); default: ask in the native dialog |

### set_project

Change project settings: name, canvas size (pixels), frame rate, background color, master volume.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | Project name |
| `width` | integer |  | Canvas width in pixels (16..8192) |
| `height` | integer |  | Canvas height in pixels (16..8192) |
| `background` | string |  | CSS hex color behind all layers |
| `master_volume` | number |  | Master linear gain; 1 is unity (0..4) |
| `fps` | "23.976" \| "24" \| "25" \| "29.97" \| "30" \| "50" \| "59.94" \| "60" |  | Frame rate; clips keep their times |

Example:

```json
{"name":"set_project","arguments":{"width":1080,"height":1920,"fps":"30"}}
```

## Media

Bring files in and keep the library tidy.

### import_media

Import media files into the project by absolute path (desktop) or URL. What a file is comes from the file (its path's or address's extension, else its contents), never from name, which is only the label the library shows. Answers one entry per file, in the order given: the new asset (id, name, kind, duration, width, height) for add_media_clip, a .cube LUT as {lut_id, name, kind: lut} for apply_lut, or {src, name, error} saying why that file failed; when every file fails, the call is an error naming each reason.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `files` | { src, name }[] | yes | Files to import |
| `files[].src` | string | yes | Absolute path or URL |
| `files[].name` | string |  | The name the library shows (default the file's name); any text, it does not decide the format |

Example:

```json
{"name":"import_media","arguments":{"files":[{"src":"C:/Footage/product.mp4","name":"Product hero"},{"src":"C:/Music/track.mp3"}]}}
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

### rename_media

Rename an imported media file in the project's library; the file on disk keeps its name. Clips without a name of their own show the new name.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string | yes | Media id from assets in describe_project |
| `name` | string | yes | The new name, 1 to 120 characters |

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

Place an imported asset (video, audio or image) on the timeline. Omit track_id to let the editor choose (main track if free, otherwise an overlay/audio track). Overwrite reports overwritten: [{id, kind, what: removed or trimmed}]. Use another track to preserve existing clips.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string | yes | Asset id, from import_media or describe_project |
| `start` | number | yes | Timeline position in seconds (0..) |
| `duration` | number |  | Length in seconds; defaults to the whole source (one loop for animated images, 5 s for stills) (0.001..) |
| `in` | number |  | Seconds into the source where the clip begins (0..) |
| `track_id` | string |  | Track id |
| `mode` | "overwrite" \| "insert" |  | overwrite replaces what is under the clip; insert pushes later clips right |

Example:

```json
{"name":"add_media_clip","arguments":{"asset_id":"a_123","start":0,"duration":3.5,"in":12}}
```

### add_color_clip

Add a solid color layer (backgrounds, flashes, title cards). Overwrite reports overwritten: [{id, kind, what: removed or trimmed}]. Use another track to preserve existing clips.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `color` | string | yes | CSS color: '#ff3366', '#00000080' (with alpha, see-through), 'rgba(0,0,0,0.5)', 'white' |
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

Add an empty video (visual) or audio track. Video tracks stack above existing ones, under a row of captions on top (captions stay the top layer; move_track above_track_id puts a track over them); audio tracks go at the bottom. role makes an audio track a stem: dialog, music, effects or ambience (measure_loudness, preview_audio and new sounds go by it).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `kind` | "video" \| "audio" | yes | Track kind |
| `name` | string |  | Track name |
| `role` | "dialog" \| "music" \| "effects" \| "ambience" |  | Audio tracks: the stem it is |

### update_track

Mute, solo, hide, lock, rename, resize, color, or set the volume, pan or role of a track. role (audio tracks: dialog, music, effects, ambience) says which stem it is; a track without one is judged by its files (a spoken line is dialog, a sound effect effects, an imported song music), never by its name.

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
| `color` | "none" \| "red" \| "orange" \| "yellow" \| "green" \| "cyan" \| "blue" \| "purple" \| "pink" |  | Track tint; a clip label takes precedence; none clears it |
| `height` | "small" \| "normal" \| "large" |  | Row height on the timeline |
| `role` | "dialog" \| "music" \| "effects" \| "ambience" \| "auto" |  | Audio tracks: the stem it is (auto clears it: judged by its files) |

### move_track

Move a track up or down the stack, next to another track of its kind: above_track_id or below_track_id. tracks[0] in describe_project is the top. Higher pictures cover lower ones, and an adjustment clip grades every track below it, so a grade's track goes under the titles' and captions'. The main track stays the bottom video track.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `track_id` | string | yes | The track to move |
| `above_track_id` | string |  | Put it just above this track |
| `below_track_id` | string |  | Put it just below this track |

Example:

```json
{"name":"move_track","arguments":{"track_id":"t_grade","below_track_id":"t_captions"}}
```

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

Move a clip's start or end edge to a time. Limited by the source media and neighbors (the answer says where it stopped and why); ripple=true shifts later clips instead of stopping at them.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `edge` | "start" \| "end" | yes | Which edge |
| `to` | number | yes | Seconds (0..) |
| `ripple` | boolean |  | Shift later clips |

### roll_edit

Roll edit (the timeline's Roll tool): move the cut between a clip and the clip touching it to `to` (timeline seconds), the cut at its end by default (with the next clip) or at its start with edge start (with the clip before). One clip grows by what the other loses, so nothing else on the timeline moves: one call puts a cut on a beat, where two trim_clip calls had to come in the right order. Each clip keeps the pictures it shows at every other time; limited by both clips' source and by each keeping a frame (the answer says where it stopped and why). A cut with a gap at it has nothing to roll: trim_clip moves one edge.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | A clip on one side of the cut |
| `to` | number | yes | Timeline seconds the cut moves to (0..) |
| `edge` | "start" \| "end" |  | Which of the clip's cuts: end (default, with the next clip) or start (with the clip before) |

Example:

```json
{"name":"roll_edit","arguments":{"clip_id":"c_7","to":8}}
```

### slip_clip

Slip a video or audio clip: play a later (by > 0) or earlier (by < 0) part of its source, keeping its place and length on the timeline, as when a shot's cut lands right but its moment is wrong. by is seconds of the source file, like in and cut_ranges, at any speed or ramp: in moves by exactly that much. Stops at the ends of the source, and says so.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or audio clip |
| `by` | number | yes | Seconds of source to move by (the in-point moves this much, whatever the clip's speed): positive shows later material |

Example:

```json
{"name":"slip_clip","arguments":{"clip_id":"c_4","by":1.5}}
```

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

Copy clips with everything on them (effects, keyframes, animations, style), the earliest copy starting at `at` seconds (default: right after the last of them ends), each on its own clip's track or a new track above where that is taken. Answers with the copies. The way to repeat a styled title or a lower third. A compound clip's copy plays the same nested timeline (an edit inside shows in both) unless unique is true: then it gets its own copy of the timeline, and of every compound nested in it (answered under added_compounds), a template to change with edit_compound, e.g. replace_clip to put other footage in a styled window.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to copy |
| `at` | number |  | Seconds where the earliest copy starts (0..) |
| `unique` | boolean |  | Compound clips: copy their nested timelines too (and the compounds nested in them), so each copy can change on its own (default false: shared) |

Example:

```json
{"name":"duplicate_clips","arguments":{"clip_ids":["c_window"],"at":6,"unique":true}}
```

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

Remove parts of a video or audio clip. Ranges are SOURCE seconds (seconds into the clip's media file, the way silence detection and transcripts report them; describeProject lists each media clip's in/out), so one list stays valid however the clip is cut. ripple (default true) closes the gaps; a detached audio clip lined up with it is cut too. The clip keeps its id on the first piece left, its head cut or not; the other pieces get new ids. The primitive behind silence and filler removal.

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

### transform_group

Move, scale and rotate visual group members about their combined bounds in canvas pixels, preserving their arrangement. Audio members stay unchanged. Specify group_id or clip_ids. at creates keys for every member transform at timeline seconds; omitted, evaluate at the latest member start and update existing keyed paths there. Times outside a member clamp to its first or last frame. One undo step.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `group_id` | string |  | Existing group id; use this or clip_ids |
| `clip_ids` | string[] |  | Explicit members; at least two visuals |
| `x` | number |  | Horizontal offset as a fraction of canvas width; default 0 |
| `y` | number |  | Vertical offset as a fraction of canvas height; default 0 |
| `scale` | number |  | Uniform multiplier about the group center; default 1 (0.01..) |
| `rotation` | number |  | Clockwise rotation offset in degrees; default 0 |
| `at` | number |  | Timeline seconds to key every member; clamped to each member span (0..) |

### set_clip_enabled

Turn clips off or on (Premiere's Enable): an off clip stays on the timeline, in place, but preview and export skip it (describe_project marks it disabled). A textless version's titles, or a clip an export_versions override hid, come back on with enabled true.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips |
| `enabled` | boolean | yes | false: off, skipped by preview and export; true: on |

### set_clip_label

Color-label clips (Premiere's Label): the timeline paints them with it. "none" removes the label.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to label |
| `label` | "red" \| "orange" \| "yellow" \| "green" \| "cyan" \| "blue" \| "purple" \| "pink" \| "none" | yes | A label color, or none |

### rename_clip

Name clips (Premiere's Rename): the timeline shows the name instead of the media's file name or a title's words. An empty name gives each clip its default name back. The media file keeps its name.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips to name |
| `name` | string | yes | The name, up to 120 characters; empty clears it |

### freeze_frame

Hold the frame at a time inside a video clip as a still for `duration` seconds (default 3). mode insert (the default, CapCut's Freeze) splits the clip there and pushes the rest of its track right by the hold, the clips sitting on those shots (titles, captions, voice lines, effects) with them; at the clip's last frame the still takes that frame's place, so no one-frame piece is left after it. mode overwrite lays the still over what is there instead (the rest of the shot, a gap left on the main track for it, the next shot's head) and moves nothing: the freeze for a pause already cut to the music.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video clip id |
| `at` | number | yes | Timeline seconds |
| `duration` | number |  | Seconds to hold (0.04..) |
| `mode` | "insert" \| "overwrite" |  | insert pushes the rest of the track right; overwrite covers what is there and moves nothing |

Example:

```json
{"name":"freeze_frame","arguments":{"clip_id":"c_7","at":6.267,"duration":1.733,"mode":"overwrite"}}
```

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

Run several commands in order as one edit (one undo step), all or nothing: set_animation on many clips, a run of add_keyframe, a whole title sequence. Each step sees what the steps before it did; a failing step names its number and nothing changes. A step can name what an earlier step added: "$2" is the first clip step 2 added, "$2.2" its second, "$2.track" the track it added (steps count from 1), anywhere in args, e.g. [{command: 'add_text', args: {text: 'SALE', start: 1, duration: 2}}, {command: 'set_animation', args: {clip_id: '$1', slot: 'in', type: 'pop'}}]. Only editing commands batch; tools that run on this computer or look (add_sound_effect, add_voiceover, the AI tools, import_media, previews, checks, export) are called on their own.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `commands` | { command, args }[] | yes | The steps, in order |
| `commands[].command` | string | yes | Command name, e.g. set_animation |
| `commands[].args` | object |  | That command's arguments |

Example:

```json
{"name":"batch","arguments":{"commands":[{"command":"add_text","args":{"text":"SALE","start":1,"duration":2,"style":{"size":140,"bold":true}}},{"command":"set_animation","args":{"clip_id":"$1","slot":"in","type":"pop","duration":0.4}},{"command":"set_animation","args":{"clip_id":"$1","slot":"out","type":"fade","duration":0.3}}]}}
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

Compose an original score that fits the edit, or read an imported track's structure; cut and hit on it, fit it to the picture; mark moments.

### generate_music

Compose and render an original, royalty-free score on this computer (no samples, nothing downloaded; about 10-15 s for a minute of music), imported as a WAV and placed on an audio track. The same arguments and seed give the same music. Styles: launch (Product launch: modern electronic, driving: four on the floor, pumping supersaw pad, sub bass, arp and a bright hook; 120 BPM); cinematic (Cinematic: big and swelling: string ostinato, legato strings and horns, choir, taiko and big hits, long hall reverb; 90 BPM); corporate (Upbeat corporate: bright and positive: piano eighths, plucked guitar strums, glockenspiel hook, claps, shaker and an eighth-note bass; 116 BPM); lofi (Lo-fi chill: laid back: swung boom-bap drums, Rhodes sevenths and ninths, round bass, sparse melody, vinyl crackle and tape wow; 80 BPM); ambient (Ambient: calm and spacious: evolving pads, glassy bells, a sub drone and a soft pulse, long hall reverb; 92 BPM). Give a length, or sections to fit the edit: [{name: "intro", bars: 4}, {name: "build", bars: 4}, {name: "drop", at: 8}, {name: "breakdown", bars: 4}, {name: "drop"}, {name: "outro", end_at: 56}]; names set what plays (intro, verse, build, drop/chorus/climax, breakdown/bridge, outro); times (at, end_at, seconds, length) land on bar lines by nudging the tempo (at most max_nudge), and fit says how close each came. Mastered to loudness (-14 LUFS) with the true peak under -1 dBTP. ending ring lets the final chord ring out over the last section (an outro: the final hit lands on its first beat, the end card's moment); stop ends on a short hit. stems also imports drums, bass, harmony and lead (they add up to the mix); place stems puts those on four grouped tracks instead of the mix. Answers the cue sheet in timeline seconds: bpm, key, chords, the beat and bar lengths with counts of each (detail full lists every bar and beat), the sections, the drops, final_hit, breaths (silences before drops), cut_points (drop, section, phrase, bar), fit, measured loudness and spectrum, the new asset and clip ids. markers adds analyze_music's markers. plan_music answers the same cue sheet without rendering: plan first, then generate with the seed it names. Placing and marking is one undo step (the files stay in the media); it cannot go in batch.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `style` | "launch" \| "cinematic" \| "corporate" \| "lofi" \| "ambient" | yes | launch (product launch: electronic, driving), cinematic (big, swelling), corporate (upbeat corporate), lofi (lo-fi chill), ambient |
| `bpm` | number |  | Tempo; default the style's (launch 120, cinematic 90, corporate 116, lofi 80, ambient 92) (40..220) |
| `key` | string |  | The tonic, such as A, F# or Bb; Am or A minor also sets the mode (default the style's) |
| `mode` | "major" \| "minor" \| "dorian" \| "mixolydian" \| "lydian" \| "phrygian" \| "harmonic_minor" |  | major, minor, dorian, mixolydian, lydian, phrygian or harmonic_minor (default the style's) |
| `length` | number |  | Seconds in all, when no sections are given: the style's form is fitted to it (default 60, at most 300) (2..300) |
| `sections` | { name, bars, seconds, at, end_at, energy, seed }[] |  | The form, in order; any mix of bars, seconds and fixed times |
| `sections[].name` | string | yes | intro, verse, build, drop (or chorus, climax), breakdown (or bridge), outro, or any name (its energy then decides) |
| `sections[].bars` | integer |  | Its length in bars of 4 beats (1..128) |
| `sections[].seconds` | number |  | Its length in seconds instead, rounded to whole bars (0.5..) |
| `sections[].at` | number |  | Seconds into the music where it must start (a drop at the edit's climax) (0..) |
| `sections[].end_at` | number |  | Seconds into the music where it must end (the outro at the video's end) (0.5..) |
| `sections[].energy` | number |  | How full and loud, 0..1 (default by name: drop 1, build 0.65, verse 0.5, breakdown 0.35, intro and outro 0.3) (0..1) |
| `sections[].seed` | integer |  | Regenerate only this section's drums, fills and touches with another seed (0..) |
| `seed` | integer |  | The same seed and arguments give the same music; default a new one, answered (0..) |
| `ending` | "ring" \| "stop" |  | ring (default): the final chord rings out over the last section; stop: a short final hit, then silence |
| `fx` | boolean |  | Risers, impacts, reverse cymbals and braams into and on the drops (default true) |
| `max_nudge` | number |  | How far the tempo may move to land asked-for times on bar lines, a fraction (default 0.06) (0..0.2) |
| `start` | number |  | Timeline seconds the music starts at (default 0); the answer's times include it (0..) |
| `detail` | "summary" \| "full" |  | summary (default): the bars and beats as counts on the even grid (bar n at start + n x bar); full: every bar and beat listed |
| `brightness` | number |  | The master's tilt about 1 kHz: 1 lifts the highs 6 dB from 3 kHz and lowers the lows 3 dB under 300 Hz, -1 the other way (darker, under a busy voice), loudness and true peak held; default the style's (launch 0.4, the rest 0) (-1..1) |
| `loudness` | number |  | Integrated loudness to master to, LUFS (default -14, online video) (-30..-8) |
| `stems` | boolean |  | Also import the drums, bass, harmony and lead stems (default false) |
| `place` | "mix" \| "stems" \| "none" |  | mix (default): the mix on an audio track at start; stems: the four stems on four grouped tracks; none: import only |
| `markers` | "beats" \| "bars" \| "phrases" \| "sections" \| "drop"[] |  | Markers to add, as analyze_music names them: beats (Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (Drop) |
| `name` | string |  | The media's name (default style, tempo, key and seed) |

Example:

```json
{"name":"generate_music","arguments":{"style":"launch","key":"Am","sections":[{"name":"intro","bars":2},{"name":"build","bars":2},{"name":"drop","at":8},{"name":"breakdown","bars":4},{"name":"build","bars":2},{"name":"drop","bars":8},{"name":"outro","end_at":56}],"seed":7,"stems":true,"markers":["bars","drop"]}}
```

### plan_music

The cue sheet generate_music would answer for these arguments, at once and without rendering or changing anything: the tempo after fitting, every section's start and end, the bar and beat grid (detail full lists every bar and beat), drops, final_hit, cut_points and how each asked-for time fit, plus the chord of every bar. Use it to try section lengths and times against the edit, then call generate_music with the same arguments and the seed it answers.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `style` | "launch" \| "cinematic" \| "corporate" \| "lofi" \| "ambient" | yes | launch (product launch: electronic, driving), cinematic (big, swelling), corporate (upbeat corporate), lofi (lo-fi chill), ambient |
| `bpm` | number |  | Tempo; default the style's (launch 120, cinematic 90, corporate 116, lofi 80, ambient 92) (40..220) |
| `key` | string |  | The tonic, such as A, F# or Bb; Am or A minor also sets the mode (default the style's) |
| `mode` | "major" \| "minor" \| "dorian" \| "mixolydian" \| "lydian" \| "phrygian" \| "harmonic_minor" |  | major, minor, dorian, mixolydian, lydian, phrygian or harmonic_minor (default the style's) |
| `length` | number |  | Seconds in all, when no sections are given: the style's form is fitted to it (default 60, at most 300) (2..300) |
| `sections` | { name, bars, seconds, at, end_at, energy, seed }[] |  | The form, in order; any mix of bars, seconds and fixed times |
| `sections[].name` | string | yes | intro, verse, build, drop (or chorus, climax), breakdown (or bridge), outro, or any name (its energy then decides) |
| `sections[].bars` | integer |  | Its length in bars of 4 beats (1..128) |
| `sections[].seconds` | number |  | Its length in seconds instead, rounded to whole bars (0.5..) |
| `sections[].at` | number |  | Seconds into the music where it must start (a drop at the edit's climax) (0..) |
| `sections[].end_at` | number |  | Seconds into the music where it must end (the outro at the video's end) (0.5..) |
| `sections[].energy` | number |  | How full and loud, 0..1 (default by name: drop 1, build 0.65, verse 0.5, breakdown 0.35, intro and outro 0.3) (0..1) |
| `sections[].seed` | integer |  | Regenerate only this section's drums, fills and touches with another seed (0..) |
| `seed` | integer |  | The same seed and arguments give the same music; default a new one, answered (0..) |
| `ending` | "ring" \| "stop" |  | ring (default): the final chord rings out over the last section; stop: a short final hit, then silence |
| `fx` | boolean |  | Risers, impacts, reverse cymbals and braams into and on the drops (default true) |
| `max_nudge` | number |  | How far the tempo may move to land asked-for times on bar lines, a fraction (default 0.06) (0..0.2) |
| `start` | number |  | Timeline seconds the music starts at (default 0); the answer's times include it (0..) |
| `detail` | "summary" \| "full" |  | summary (default): the bars and beats as counts on the even grid (bar n at start + n x bar); full: every bar and beat listed |
| `brightness` | number |  | The master's tilt about 1 kHz: 1 lifts the highs 6 dB from 3 kHz and lowers the lows 3 dB under 300 Hz, -1 the other way (darker, under a busy voice), loudness and true peak held; default the style's (launch 0.4, the rest 0) (-1..1) |

Example:

```json
{"name":"plan_music","arguments":{"style":"cinematic","length":45,"ending":"stop"}}
```

### analyze_music

Read a music clip's structure on this computer, as Final Cut's beat grid shows it (song parts, bars, beats), to cut to: bpm; grid, the beats as an even grid (first_beat, beat_seconds, bar_seconds, and off_grid: the beats more than 25 ms off it); downbeats (each bar's first beat, 4 beats a bar, from where the accents fall); phrases (every 4 bars); sections, each {start, end, label, energy} with label intro, verse, build, drop, breakdown or outro and energy 0..1 (1 the loudest part); drops (every qualifying rise after a dip) and drop (the biggest the clip plays, or null); counts of beats, bars, phrases and hits. detail full also lists every beat (beats), each beat's energy 0..1 (beat_energy) and hits (strong onsets on or off the beat: drum hits, stabs), about 2-3 KB a minute of music. Sections may be as short as two bars and their bounds follow bars or phrases. The whole music file is read (once; the reading is kept for every clip of it) and placed through the clip's in-point, speed and position, so a trimmed clip keeps the file's bar phase and drops; source says what was read. All times are TIMELINE seconds, inside the clip. confidence (0..1) says how sure the tempo, the bar lines and the sections are, with a note naming the hint to give when one is low. When the music's structure is known (a cue sheet, the composer's notes), give it in the file's own seconds: bpm, first_downbeat (a bar's first beat) and cues (each part's start and label) replace what would be detected. markers also drops markers: beats (label Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (a Drop marker for every drop), one undo step; they follow the clip through moves, trims, splits and speed changes (a second the clip no longer plays loses its marker), and a second reading replaces the clip's own markers of those kinds instead of adding to them; cut_to_beats then cuts on them (grid bars or phrases), add_beat_hits hits them (marker_label Bar or Drop) and fit_music moves the drop. bpm is the tempo as the clip plays it (file_bpm, the file's own, when it is sped up). When the reading is wrong for good (bars between the kicks, a drop missed), set_music_grid keeps the right grid with the file, and every later reading uses it. Example: {"clip_id": "c_3", "markers": ["bars", "drop"]}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The music clip (audio, or a video with sound) |
| `markers` | "beats" \| "bars" \| "phrases" \| "sections" \| "drop"[] |  | Kinds of markers to add (default none) |
| `bpm` | number |  | The tempo, when known: beats are tracked at it (40..240) |
| `first_downbeat` | number |  | A bar's first beat, in the music file's own seconds (0 for a score that starts on a bar): sets where bars start; with bpm, the whole grid (0..) |
| `cues` | { at, label }[] |  | The parts, when known, in the music file's own seconds: each starts at its at and runs to the next; a drop cue after another part is a drop. [{at: 0, label: 'intro'}, {at: 4, label: 'build'}, {at: 8, label: 'drop'}, {at: 32, label: 'breakdown'}, {at: 36, label: 'drop'}, {at: 48, label: 'outro'}] |
| `cues[].at` | number | yes | Source seconds the part starts (0..) |
| `cues[].label` | "intro" \| "verse" \| "build" \| "drop" \| "breakdown" \| "outro" | yes | What the part is |
| `detail` | "summary" \| "full" |  | summary (default): the grid, bars, phrases, parts and drops with counts; full: also every beat, hit and beat's energy |

Example:

```json
{"name":"analyze_music","arguments":{"clip_id":"c_3","markers":["beats","bars","drop"]}}
```

### set_music_grid

Give a song's grid yourself, when analyze_music reads it wrong (its confidence is low, the bars fall between the kicks, the drop is missed or early) or when it is known (a cue sheet, the composer's notes): the tempo, a bar's first beat and, if known, its parts (a drop after another part is a drop), all in the music file's own seconds, four beats a bar. The grid is kept with the file: analyze_music, mark_beats and check_project read the song through it instead of guessing, on every clip of it, through trims, moves and speed changes. markers places the grid's markers on this clip now (Beat, Bar, Phrase, each part by name, Drop), following the clip as analyze_music's do and replacing the clip's own earlier ones of those kinds; by default the kinds it is marked with already (parts and the drop only when sections are given). The answer's note says where the grid plays on the timeline. clear: true forgets the grid. Example: {clip_id: 'c_3', bpm: 128, first_downbeat: 0, sections: [{at: 0, label: 'intro'}, {at: 7.5, label: 'build'}, {at: 15, label: 'drop'}, {at: 33.75, label: 'outro'}], markers: ['beats', 'bars', 'drop']}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The music clip (audio, or a video with sound); the grid is kept with its file |
| `bpm` | number |  | Beats a minute, in the file's own time (a clip sped up plays it faster) (40..240) |
| `first_downbeat` | number |  | A bar's first beat, in the music file's own seconds (0 for a song that starts on a bar) (0..) |
| `sections` | { at, label }[] |  | The parts, if known, in the music file's own seconds: each starts at its at and runs to the next |
| `sections[].at` | number | yes | File seconds the part starts (0..) |
| `sections[].label` | "intro" \| "verse" \| "build" \| "drop" \| "breakdown" \| "outro" | yes | What the part is |
| `markers` | "beats" \| "bars" \| "phrases" \| "sections" \| "drop"[] |  | Markers to place on this clip from the grid: beats, bars, phrases, sections, drop (default: the kinds the clip is marked with already; [] none) |
| `clear` | boolean |  | Forget the grid: analysis guesses again |

Example:

```json
{"name":"set_music_grid","arguments":{"clip_id":"c_3","bpm":128,"first_downbeat":0.12,"sections":[{"at":0,"label":"intro"},{"at":7.62,"label":"build"},{"at":15.12,"label":"drop"}],"markers":["beats","bars","drop"]}}
```

### cut_music

Cut bars out of a song and join it without a click: from and to are the music file's seconds (as cut_ranges takes them), each moved to the song's nearest bar line (snap beat: beat; none: as given) from its grid (set_music_grid; analyze_music reads bpm and the first downbeat to give it), the stretch removed and the gap closed. The piece after plays on exactly whole bars later in the file, so the beat runs on, and the two pieces meet with a short equal-power crossfade that ends on the downbeat (crossfade, default 0.03 s; 0 for a butt cut, which plays a few milliseconds of near-silence at the join). The answer's note says the file seconds cut and where the pieces meet; preview_audio's edges then measure the join. Example: {"clip_id": "c_3", "from": 14, "to": 30}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The song's audio clip |
| `from` | number | yes | File seconds to cut from (moved to the nearest bar line) (0..) |
| `to` | number | yes | File seconds to cut to (moved to the nearest bar line) (0..) |
| `snap` | "bar" \| "beat" \| "none" |  | Where from and to land: bar (default), beat, or none (as given) |
| `crossfade` | number |  | Seconds the pieces crossfade over, ending at the cut (default 0.03; 0 a butt cut) (0..2) |

Example:

```json
{"name":"cut_music","arguments":{"clip_id":"c_3","from":14,"to":30}}
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

Punch up beats with short hits: flash (blown out to white), zoom (a zoom punch), shake (camera shake), rgbSplit, glow or zoomBlur, several at once as one layer (["flash", "zoom"]). Each hit is an adjustment layer on a Hits track above the footage (below bars and titles), at its peak on the beat and easing out over `duration` (default 0.2 to 0.35 s by effect), keyframed, so preview and export match. Times: `times` (timeline seconds), the main track's cuts (at_cuts true), or the Beat markers (or marker_label's, e.g. Bar or Drop), between from and to, thinned to every Nth. intensity 0..1 (default 1, strong). Photosensitivity: flashes keep to at most 3 in any second (WCAG 2.3.1); a beat that would break that gets its other effects without the flash, or nothing. Example: {"effects": ["zoom", "rgb_split"], "marker_label": "Bar"}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `effect` | "flash" \| "zoom" \| "shake" \| "rgbSplit" \| "glow" \| "zoomBlur" |  | One hit |
| `effects` | "flash" \| "zoom" \| "shake" \| "rgbSplit" \| "glow" \| "zoomBlur"[] |  | Several hits on each beat, as one layer |
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

Mark a music clip's beats (every Nth) with Beat markers, from the whole song's reading (analyze_music's beats, read through the grid set_music_grid gave the file), placed where the clip plays them: trimmed, moved or sped up, the markers stand on the song's beats, and they follow the clip through later edits, replacing its earlier Beat markers. Answers bpm as the clip plays it (file_bpm, the file's own, when it is sped up or slowed), the beats marked in timeline seconds and how many markers it added (0 when they were there already: a second call replaces them, never doubles them).

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

Edit a timeline marker's position, label or color without moving clips. Times are seconds. A marker that follows a clip (describe_project names its clip) stops following it when moved; detach: true stops it where it stands.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `marker_id` | string | yes | Marker id |
| `at` | number |  | Timeline seconds (0..) |
| `label` | string |  | Text |
| `color` | string |  | CSS color |
| `detach` | boolean |  | Stop following its clip, staying where it is |

### delete_markers

Delete the specified timeline markers together. Unknown ids reject the whole edit.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `marker_ids` | string[] | yes | Marker ids |

## Picture and motion

Position, scale, crop, mask, key and animate pictures; keyframes for anything numeric.

### set_param

Set a numeric clip parameter by path, e.g. opacity (0..1), volume (1 = 0 dB), transform.x / transform.y (canvas fractions from center), transform.scale (1 = fit; the horizontal scale when not uniform), transform.scaleY (vertical scale; setting it makes the scale non-uniform), transform.rotation (degrees), adjust.exposure / adjust.contrast / adjust.saturation / adjust.temperature (-100..100), grade values such as adjust.hsl.red.saturation, adjust.wheels.gain.y (-100..100) and adjust.lut.intensity (0..1). If the path has keyframes, sets a keyframe at `at` instead (without at it is refused: remove_keyframes first to set one value), which ramps from the key before; hold true keeps what plays before `at` as it was (a key on the frame before holds it) and changes the value there, as a step (on a path without keys it makes those two keys). An effect's parameter: effects.<index>.<param> (its place in the stack, from 0), effects.<id>.<param> or effects.<type>.<param>, e.g. effects.0.amount; list_catalog section effects has each one's parameters. Sound fades are frames here; set_fades takes seconds.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Clips |
| `path` | string | yes | Parameter path |
| `value` | number | yes | New value |
| `at` | number |  | Timeline seconds, for keyframed paths |
| `hold` | boolean |  | With at: hold the value before at until the frame before it, so the change is a step there and not a ramp from the key before |

Example:

```json
{"name":"set_param","arguments":{"clip_ids":["c_123"],"path":"transform.scale","value":1.2}}
```

### add_keyframe

Animate a parameter: add a keyframe at a timeline time. Two or more keyframes on a path interpolate between them, each shaped toward the next by its ease. Only paths that animate on the clip are accepted (help topic params lists them); any other is refused with the list.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string | yes | Parameter path that animates on this clip, e.g. transform.x, opacity, effects.0.amount (help topic params) |
| `at` | number | yes | Timeline seconds |
| `value` | number |  | Value at that time |
| `color` | string |  | For a color path (style.color): the CSS color at that time, instead of value |
| `ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" \| "spring" \| "elastic" \| "bounce" |  | Curve toward the next keyframe: linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate, spring, elastic, bounce. fastIn is the modern expo-out (arrives fast, glides to rest); spring, elastic and bounce overshoot and settle |
| `bezier` | number[] |  | [x1, y1, x2, y2], a CSS cubic-bezier (x1 and x2 in 0..1, y may overshoot); overrides ease |

Example:

```json
{"name":"add_keyframe","arguments":{"clip_id":"c_123","path":"transform.x","at":1,"value":0.75,"ease":"fastIn"}}
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

### move_motion_point

Move an existing position-key point in one undo step. Sets x and y keys at its time, preserving ease and other keys. Use add_keyframe to create a new time first.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Visual clip id |
| `at` | number | yes | Timeline seconds of an existing x or y key (0..) |
| `x` | number | yes | Position as a fraction of canvas width from center |
| `y` | number | yes | Position as a fraction of canvas height from center |

### set_keyframe_ease

Shape the curve leaving keyframes toward the next one. ease is a preset (linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate, spring, elastic, bounce); bezier [x1, y1, x2, y2] is a CSS cubic-bezier (x in 0..1, y may overshoot) and overrides it. Without path, applies to every parameter keyed at that time; without at, to every keyframe on the path(s).

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Clip id |
| `path` | string |  | Parameter path; omit for all keyed parameters |
| `at` | number |  | Timeline seconds of the keyframe; omit for all keyframes |
| `ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" \| "spring" \| "elastic" \| "bounce" |  | Curve toward the next keyframe: linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate, spring, elastic, bounce. fastIn is the modern expo-out (arrives fast, glides to rest); spring, elastic and bounce overshoot and settle |
| `bezier` | number[] |  | [x1, y1, x2, y2], a CSS cubic-bezier (x1 and x2 in 0..1, y may overshoot); overrides ease |

### remove_keyframes

Remove keyframes from clip_ids (or clip_id). at lists timeline seconds (omit for every time); path limits it to one parameter (omit for all). A parameter left with no keys returns to its static value. No matching keys is a reported no-op, including in a batch.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string |  | Clip id; alternatively use clip_ids |
| `clip_ids` | string[] |  | Clips whose matching keys are removed |
| `path` | string |  | Parameter path; omit for all keyed parameters |
| `at` | number[] |  | Timeline seconds of the keyframes to remove |

Example:

```json
{"name":"remove_keyframes","arguments":{"clip_ids":["c_title"],"path":"opacity"}}
```

### frame_region

Show one part of a video or picture full screen, as a zoom on a screen recording does: region is a rectangle in fractions of the source picture (x, y its top-left corner; {x:0.5,y:0,w:0.5,h:1} is the right half). fill (default) covers the canvas, fit shows all of the region. The picture slides back where it would leave an empty band. With to_region, it moves from the one to the other between from and to (default the whole clip), easing in and out. moves, instead of region, is any number of moves in one call: each region is shown at its at (timeline seconds), the picture moving there from the move before (ease, default easeInOut); before the first it holds the first, and a hold is the same region again, so a push-in and a later pan is [{region: whole, at: 12.9}, {region: A, at: 13.7}, {region: A, at: 15.4}, {region: B, at: 15.8}]. Replaces the clip's scale and position keyframes; titles, shapes and callouts pinned to the clip (anchor, add_callout) follow.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Video or image clip id |
| `region` | { x, y, w, h } |  | The part of the picture to show (or to start from when to_region is given): fractions, x and y its top-left corner |
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
| `moves` | { region, at, ease }[] |  | Instead of region, to_region, from and to: the regions in order, each shown at its at, moving there from the one before |
| `moves[].region` | { x, y, w, h } | yes | The part shown at at |
| `moves[].region.x` | number | yes | Left edge, a fraction of the picture's width (0..1) |
| `moves[].region.y` | number | yes | Top edge, a fraction of its height (0..1) |
| `moves[].region.w` | number | yes | Width, a fraction of the picture's width (0.01..1) |
| `moves[].region.h` | number | yes | Height, a fraction of its height (0.01..1) |
| `moves[].at` | number | yes | Timeline seconds the region fills the frame (0..) |
| `moves[].ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" \| "spring" \| "elastic" \| "bounce" |  | How the move into this region goes: linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate, spring, elastic, bounce; default easeInOut |

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

### apply_layout

Arrange 2 to 4 overlapping visual clips in input order. fit cover (default) fills each cell, cropping the picture; contain shows the whole picture centered in its cell (screen recordings, slides), with background filling the cell behind it. Triptych needs 3. PIP keeps the first clip full frame and stacks the remaining cards above it. The clips move to Layout tracks directly above the highest of their tracks, so titles already above them stay on top. Resets transform, crop and mask keys and clip animations to fit the cells. Optional borders and backgrounds are editable shape layers grouped with their pictures. One undo step.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | 2 to 4 distinct visual clip ids in cell order; PIP main first |
| `layout` | "split-vertical" \| "split-horizontal" \| "grid-2x2" \| "triptych" \| "pip-top-right" \| "pip-top-left" \| "pip-bottom-right" \| "pip-bottom-left" \| "pip-center-card" | yes | Cell arrangement |
| `gap` | number |  | Gutter as fraction of the shorter canvas side; default 0.02 (0..0.3) |
| `margin` | number |  | Outer margin as fraction of the shorter canvas side; default 0.04 (0..0.4) |
| `radius` | number |  | Rounded mask radius, 0 square to 1 half the shorter cell side; default 0 (0..1) |
| `border` | { width, color } |  | Optional editable border shapes |
| `border.width` | number | yes | Stroke width in pixels at 1080p (0..100) |
| `border.color` | string | yes | CSS border color |
| `animate` | "none" \| "slide" \| "scale" |  | Entrance over 0.4 seconds, clipped to clip duration; default none |
| `fit` | "cover" \| "contain" |  | cover (default): fill each cell, cropping the picture; contain: the whole picture, centered in its cell (the PIP's full-frame picture always covers) |
| `background` | string |  | With fit contain: a CSS color filling each cell behind its picture, as an editable shape |

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

CapCut's mask on pictures: shape linear (keeps above a line), mirror (a band), circle, rectangle, heart or star; none removes it. x and y move its center from the picture's center, width and height size it, all as fractions of the visible picture's width and height (so on a 16:9 picture width 0.44 with height 0.44 is an oval: aspect 1 makes a round circle or a square, its height following its width, or its width a height given alone); rotation in degrees turns it; feather 0..1 softens the edge; radius 0..1 rounds a rectangle's corners; invert keeps the outside. A new mask starts centered at 0.6 of the picture (hearts and stars square). A circle, rectangle, heart or star reaching past the picture's edge is cut flat there: the answer's notes name the edge and the x, y or size that keeps it whole. Values left out keep theirs. With at (timeline seconds), the values given are keyed there: one with no keys yet first gets a key at the clip's start holding what it was, so two calls (the same values at the moment it leaves, the new ones where it lands) move the mask; on a mask this call makes, at is not used (the answer says so). A spotlight that follows a screen recording's zooms is add_callout.

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
| `aspect` | number |  | The mask's width over its height in pixels (1: a round circle, a square); its height follows from width, or its width from a height given alone (0.05..20) |
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

## Graphics and compositing

Shapes (bars, boxes, lines that draw on, soft glows), callouts that ring a part of a screen recording and follow its zooms, overlays pinned to footage, drop shadows, borders and perspective tilt for floating windows and picture-in-picture, track mattes, motion blur, mirrored edges and camera shake.

### add_shape

Add a shape layer: a rectangle, rounded_rectangle, ellipse or line, with a solid or two-color gradient fill, an outline and a draw-on amount. The pieces of lower thirds, callouts, CTA buttons (a rounded_rectangle with radius 1 is a pill), progress bars and end cards. It lands above everything at that time (or on track_id), so add a box before the text that sits on it. Sizes are fractions of the canvas; x and y move its center from the canvas center. Every number animates: set_param or add_keyframe on shape.width, shape.height, shape.radius, shape.stroke.width, shape.draw, shape.feather, shape.gradient.angle, shape.gradient.x, shape.gradient.y, shape.gradient.radius, plus the usual transform.*, opacity. Draw a line or outline on by keying shape.draw from 0 to 1. Soft light without image files: an ellipse with feather (a soft edge, pixels) or a radial gradient to transparent is a glow; add a blur effect (amount up to 500) for more. Example lower-third bar: {kind: 'rectangle', start: 1, duration: 4, x: -0.25, y: 0.33, width: 0.4, height: 0.09, color: '#101418'}; a background glow: {kind: 'ellipse', start: 0, duration: 8, width: 0.6, height: 0.8, gradient: {kind: 'radial', from: '#6a5cffcc', to: 'transparent'}, feather: 120}. Overwrite reports overwritten: [{id, kind, what: removed or trimmed}]. Use another track to preserve existing clips.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `kind` | "rectangle" \| "rounded_rectangle" \| "ellipse" \| "line" | yes | Shape |
| `start` | number | yes | Seconds (0..) |
| `duration` | number | yes | Seconds (0.001..) |
| `x` | number |  | Center's horizontal offset from the canvas center, fraction of its width (-0.5 left edge .. 0.5 right edge; default 0) |
| `y` | number |  | Center's vertical offset, fraction of the canvas height (-0.5 top .. 0.5 bottom; 0.35 is lower-third height; default 0) |
| `width` | number |  | Width, fraction of the canvas width (a line's length); default 0.3, an ellipse 0.2 (0.001..4) |
| `height` | number |  | Height, fraction of the canvas height (unused by lines); default 0.1, an ellipse a circle as wide as width (0.001..4) |
| `color` | string |  | Fill color, CSS: '#ff3366', '#00000099' (with alpha), 'rgba(0,0,0,0.6)', 'white'; a line's color. Default #ffffff |
| `gradient` | { from, to, angle, kind, x, y, radius } |  | A two-color fill instead of color: linear (default) or radial |
| `gradient.from` | string | yes | Color at the start (radial: the center) |
| `gradient.to` | string | yes | Color at the end (radial: the rim); 'transparent' fades out |
| `gradient.angle` | number |  | Linear: degrees, 0 runs left to right (default), 90 top to bottom, 45 diagonal |
| `gradient.kind` | "linear" \| "radial" |  | linear (default) or radial: from at the center to `to` at the rim, an ellipse fitting the box |
| `gradient.x` | number |  | Radial: the center's move from the box's middle, a fraction of its width (default 0) (-2..2) |
| `gradient.y` | number |  | Radial: the center's move, a fraction of the box's height, down positive (default 0) (-2..2) |
| `gradient.radius` | number |  | Radial: where `to` is reached, a fraction of the box's half size (default 1, its sides) (0.001..10) |
| `fill` | boolean |  | false draws only the outline (give stroke_width); default true |
| `stroke_color` | string |  | Outline color, CSS; default white, or color when fill is false |
| `stroke_width` | number |  | Outline width in pixels at a 1080-pixel-tall canvas, centered on the edge; a line's thickness (default 8). Default no outline (0..400) |
| `radius` | number |  | Rectangle corner roundness: 0 square, 1 a pill (radius half the shorter side); rounded_rectangle defaults to 0.35 (0..1) |
| `draw` | number |  | Share of the outline or line drawn, 0..1, from the top center clockwise (a line: from its left end), as After Effects' Trim Paths End; fills are not trimmed. Default 1 (0..1) |
| `feather` | number |  | Soft edge: the shape blurred, its edge fading over this many pixels at 1080p, centered on it, with a Gaussian falloff (0 crisp, default); a feather wider than the shape also dims its middle, as a blur would. An ellipse feathered by half its size or more is a soft glow (0..1000) |
| `rotation` | number |  | Degrees, clockwise (turn a line to any angle) |
| `opacity` | number |  | 0..1, default 1 (0..1) |
| `track_id` | string |  | Track id; default above everything at that time |
| `anchor` | { clip_id, x, y } |  | Pin it to a point of a clip's picture instead of giving x and y: its center goes there and follows that clip's position, scale and keys (frame_region zooms and pans included) through later edits |
| `anchor.clip_id` | string | yes | The clip whose picture it follows (the screen recording or shot under it), on the same timeline |
| `anchor.x` | number | yes | The point across that clip's source picture: 0 its left edge, 1 its right (frame_region's units) (-1..2) |
| `anchor.y` | number | yes | The point down it: 0 its top, 1 its bottom (-1..2) |

Example:

```json
{"name":"add_shape","arguments":{"kind":"rounded_rectangle","start":2,"duration":3,"x":-0.25,"y":0.32,"width":0.4,"height":0.1,"color":"#14101fcc","radius":0.3}}
```

### set_shape

Change shape layers made with add_shape (same meanings and units). Values left out keep theirs. Numbers that are animated (have keyframes) get a keyframe at `at` instead; to start animating one, use add_keyframe on its path (shape.width, shape.height, shape.radius, shape.stroke.width, shape.draw, shape.feather, shape.gradient.angle, shape.gradient.x, shape.gradient.y, shape.gradient.radius). gradient with an empty from removes it; stroke_width 0 removes the outline; feather 0 makes the edge crisp.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Shape clips |
| `kind` | "rectangle" \| "rounded_rectangle" \| "ellipse" \| "line" |  | Shape |
| `width` | number |  | Fraction of the canvas width (0.001..4) |
| `height` | number |  | Fraction of the canvas height (0.001..4) |
| `color` | string |  | Fill color, CSS |
| `gradient` | { from, to, angle, kind, x, y, radius } |  | A two-color fill instead of color: linear or radial |
| `gradient.from` | string | yes | Start color (radial: the center); empty removes the gradient |
| `gradient.to` | string |  | End color (radial: the rim) |
| `gradient.angle` | number |  | Linear: degrees, 0 left to right |
| `gradient.kind` | "linear" \| "radial" |  | linear (default) or radial: from at the center to `to` at the rim, an ellipse fitting the box |
| `gradient.x` | number |  | Radial: the center's move from the box's middle, a fraction of its width (default 0) (-2..2) |
| `gradient.y` | number |  | Radial: the center's move, a fraction of the box's height, down positive (default 0) (-2..2) |
| `gradient.radius` | number |  | Radial: where `to` is reached, a fraction of the box's half size (default 1, its sides) (0.001..10) |
| `fill` | boolean |  | false: outline only |
| `stroke_color` | string |  | Outline color, CSS |
| `stroke_width` | number |  | Pixels at 1080p; 0 removes the outline (0..400) |
| `radius` | number |  | Rectangle corners 0..1 (0..1) |
| `draw` | number |  | Share drawn 0..1 (0..1) |
| `feather` | number |  | Soft edge, pixels at 1080p; 0 crisp (0..1000) |
| `at` | number |  | Timeline seconds, for animated values |

Example:

```json
{"name":"set_shape","arguments":{"clip_ids":["c_8"],"draw":1,"at":2.6}}
```

### add_callout

Point at a part of a screen recording or shot, as explainers do: a ring, box or rounded box that draws on around region, with the rest of the frame dimmed through a hole the same shape, both pinned to clip_id's picture, so they stay on the part through that clip's zooms and pans (frame_region, keys) and any later edit of them; to glides them on to other parts. region is in fractions of that clip's source picture, as frame_region takes it (x, y its top-left corner): give the part itself, the ring is drawn a few pixels clear of it. Two shape layers, the dim under the ring, grouped (they move, copy and delete together; each edits like any shape), above everything at that time. Example, the Split button of a 2560x1440 recording, then the clip's edge: {clip_id: 'c_1', region: {x: 0.102, y: 0.542, w: 0.018, h: 0.03}, at: 14.2, duration: 4.3, to: [{region: {x: 0.515, y: 0.825, w: 0.06, h: 0.095}, at: 15.83}], sound: true}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The footage it points at (a video or picture clip on the same timeline) |
| `region` | { x, y, w, h } | yes | The part to point at, in fractions of that clip's source picture: x, y its top-left corner |
| `region.x` | number | yes | Left edge, a fraction of the picture's width (0..1) |
| `region.y` | number | yes | Top edge, a fraction of its height (0..1) |
| `region.w` | number | yes | Width, a fraction of the picture's width (0.01..1) |
| `region.h` | number | yes | Height, a fraction of its height (0.01..1) |
| `shape` | "ring" \| "box" \| "rounded" |  | ring (an ellipse around it), box, or rounded (a box with round corners; default) |
| `dim` | number |  | How dark the rest of the frame goes, 0 (no dim, only the ring) .. 1; default 0.5 (0..1) |
| `draw_on` | number |  | Seconds the ring takes to draw on around it; 0 shows it whole at once. Default 0.35 (0..5) |
| `at` | number | yes | Timeline seconds it starts (0..) |
| `duration` | number |  | Seconds it stays; default 2 (0.1..) |
| `to` | { region, at, glide }[] |  | Glides, in order: each reaches its region at its at (timeline seconds), moving there from where it was over glide seconds |
| `to[].region` | { x, y, w, h } | yes | The next part, in the same clip's source fractions |
| `to[].region.x` | number | yes | Left edge, a fraction of the picture's width (0..1) |
| `to[].region.y` | number | yes | Top edge, a fraction of its height (0..1) |
| `to[].region.w` | number | yes | Width, a fraction of the picture's width (0.01..1) |
| `to[].region.h` | number | yes | Height, a fraction of its height (0.01..1) |
| `to[].at` | number | yes | Timeline seconds it arrives there (0..) |
| `to[].glide` | number |  | Seconds the move takes, ending at at; default 0.4 (0.03..10) |
| `color` | string |  | The ring's color, CSS; default the brand kit's accent |
| `stroke_width` | number |  | The ring's outline, pixels at 1080p; default 6 (1..40) |
| `sound` | boolean |  | A soft click as the ring draws on, on the effects track (default false). Made on this computer: not inside a batch unless the project has a click already |

Example:

```json
{"name":"add_callout","arguments":{"clip_id":"c_rec","region":{"x":0.102,"y":0.542,"w":0.018,"h":0.03},"at":14.2,"duration":4.3,"dim":0.5,"to":[{"region":{"x":0.515,"y":0.825,"w":0.06,"h":0.095},"at":15.83}],"sound":true}}
```

### set_anchor

Pin titles, shapes or stickers to a point of a clip's picture (anchor {clip_id, x, y}, source fractions as frame_region takes them), so they follow its zooms and pans; or none true to unpin them where they are. A pinned clip moved by hand (a drag, set_param on its position) is pinned again where it lands. describe_project shows each clip's anchor.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | The clips to pin or unpin (a callout's two parts: give both) |
| `anchor` | { clip_id, x, y } |  | Pin it to a point of a clip's picture instead of giving x and y: its center goes there and follows that clip's position, scale and keys (frame_region zooms and pans included) through later edits |
| `anchor.clip_id` | string | yes | The clip whose picture it follows (the screen recording or shot under it), on the same timeline |
| `anchor.x` | number | yes | The point across that clip's source picture: 0 its left edge, 1 its right (frame_region's units) (-1..2) |
| `anchor.y` | number | yes | The point down it: 0 its top, 1 its bottom (-1..2) |
| `none` | boolean |  | true: unpin them; they stay where they are now |

### set_shadow

A drop shadow under a picture: a video, image, title, shape or compound clip. It is cast by the finished picture, after its mask, crop, effects and track matte, so a rounded mask casts a rounded shadow and a compound clip (a floating UI window built from footage, a border and a bar) casts one shadow for the whole window. color (CSS, default black), blur: softness in pixels at 1080p, 0..600 (twice the Gaussian's sigma, as CSS box-shadow; default 60), x and y: how far it falls, pixels at 1080p, y down (default 0, 24), opacity 0..1 (default 0.5). A floating window: {blur: 80, y: 30, opacity: 0.55}; a contact shadow: {blur: 12, y: 4, opacity: 0.6}. Values left out keep theirs (or the defaults for a new shadow). Animate with add_keyframe on shadow.blur, shadow.x, shadow.y, shadow.opacity; values that are keyframed get a key at `at` instead. off: true removes it and its keyframes. Titles also have style.shadow, drawn with the letters; this one is cast by the whole title, box included.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `color` | string |  | CSS color; its alpha multiplies opacity |
| `blur` | number |  | Softness, pixels at 1080p (0 hard-edged) (0..600) |
| `x` | number |  | Horizontal fall, pixels at 1080p, right positive (-2000..2000) |
| `y` | number |  | Vertical fall, pixels at 1080p, down positive (-2000..2000) |
| `opacity` | number |  | 0..1 (0..1) |
| `off` | boolean |  | Remove the shadow and its keyframes |
| `at` | number |  | Timeline seconds, for keyframed values |

Example:

```json
{"name":"set_shadow","arguments":{"clip_ids":["c_6"],"blur":80,"y":30,"opacity":0.55}}
```

### set_border

A border (stroke) around a picture: a video, image, title, shape or compound clip, as picture-in-picture shots and social layouts frame theirs. It follows the finished picture's edge, after its mask, crop, effects and track matte, outside it: a rounded mask gets a rounded border, a circle mask a ring, a compound clip one border around the whole window; set_shadow's shadow is cast by the picture and its border together. color (CSS, default white), width: pixels at 1080p outside the edge, 0..200 (default 8; it stays that wide however the clip is scaled), opacity 0..1 (default 1; the clip's opacity fades it too). A framed inset: {width: 10, color: '#ffffff'}; a thin dark keyline: {width: 2, color: '#000000', opacity: 0.6}. Values left out keep theirs (or the defaults for a new border). Animate with add_keyframe on border.width, border.opacity; values that are keyframed get a key at `at` instead. off: true removes it and its keyframes. Titles and shapes also have their own outline (style.stroke, stroke_width), drawn with the letters or the shape; this one goes around the whole finished picture, a title's box included.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `color` | string |  | CSS color; its alpha multiplies opacity |
| `width` | number |  | Pixels at 1080p outside the picture's edge (0 shows none) (0..200) |
| `opacity` | number |  | 0..1 (0..1) |
| `off` | boolean |  | Remove the border and its keyframes |
| `at` | number |  | Timeline seconds, for keyframed values |

Example:

```json
{"name":"set_border","arguments":{"clip_ids":["c_6"],"width":10,"color":"#ffffff"}}
```

### set_tilt

Tilt a picture in perspective, as product films turn floating UI windows in depth (CSS rotateX and rotateY): x tips the top away (negative: the bottom), y turns the right side away (negative: the left), in degrees, seen from perspective pixels at 1080p in front of the canvas center (default 2000; 800 is dramatic, 4000 gentle). A window at rest, three-quarter view: {y: -18, x: 6}. Values left out keep theirs; x and y 0 lay it flat. Animate with add_keyframe on transform.rotateX, transform.rotateY, transform.perspective (a window swinging into place: y from -35 to 0); keyframed values get a key at `at`. A compound clip tilts as one picture, its shadow (set_shadow) cast by the tilted window.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `x` | number |  | Degrees about the horizontal axis: positive tips the top away (-89..89) |
| `y` | number |  | Degrees about the vertical axis: positive turns the right side away (-89..89) |
| `perspective` | number |  | The camera's distance, pixels at 1080p (default 2000): nearer is stronger (100..100000) |
| `at` | number |  | Timeline seconds, for keyframed values |

Example:

```json
{"name":"set_tilt","arguments":{"clip_ids":["c_6"],"y":-18,"x":6}}
```

### set_track_matte

Cut a clip with a track matte (After Effects'): it shows only where another clip's picture is, the basis of video inside text, logo reveals and wipe reveals. mode alpha (default) keeps where the matte is opaque, alphaInverted where it is transparent, luma where it is bright, lumaInverted where it is dark. matte_clip_id: a visual clip of the same timeline (text, shape, picture, video), 'above' for whatever is on the video track directly above at each frame (keeps working after cuts), or 'none' to remove the matte; left out, the current matte stays (a new one uses 'above'). The matte clip is not drawn itself but keeps its transform, animations and keyframes, so animating the matte animates the reveal. Example, video inside big text: add_text {text: 'SUMMER', style: {size: 420}} then set_track_matte {clip_id: <video>, matte_clip_id: <text>}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The clip to cut (it is what shows) |
| `matte_clip_id` | string |  | The matte clip's id, 'above' (the video track directly above) or 'none' |
| `mode` | "alpha" \| "alphaInverted" \| "luma" \| "lumaInverted" |  | alpha: show where the matte is opaque (default); alphaInverted: where it is not; luma: where it is bright; lumaInverted: where it is dark |

Example:

```json
{"name":"set_track_matte","arguments":{"clip_id":"c_2","matte_clip_id":"above","mode":"alpha"}}
```

### set_motion_blur

Motion blur from movement (After Effects'): while a clip moves (position, scale or rotation keyframes, wiggle, in/out animations, and moving transitions such as slides, pushes, zooms and spins), its picture is averaged over the camera's shutter, so fast moves streak instead of strobing. shutter_angle in degrees: 180 (default; film's and After Effects') blurs over half a frame centered on it, 360 a whole frame (heavier), 90 crisper. Still frames cost nothing; export and the paused viewer use up to 32 samples, playback fewer.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `on` | boolean | yes | Motion blur on or off |
| `shutter_angle` | number |  | Degrees, 1..720; default 180 (1..720) |

Example:

```json
{"name":"set_motion_blur","arguments":{"clip_ids":["c_4","c_5"],"on":true,"shutter_angle":180}}
```

### set_edge_mode

What fills the canvas around a picture that is moved, shrunk, spun or shaken off it (After Effects' Motion Tile with Mirror Edges): mirror reflects the picture at its edges, seamless, the usual choice under camera shake, zoom-out and spin moves; repeat tiles it; none (default) leaves the canvas empty there. Pairs with set_wiggle and with scale below 1.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `edge` | "none" \| "mirror" \| "repeat" | yes | Edge mode |

Example:

```json
{"name":"set_edge_mode","arguments":{"clip_ids":["c_4"],"edge":"mirror"}}
```

### set_wiggle

Organic shake or drift (After Effects' wiggle): seeded smooth noise added to a clip's position, x, y, rotation or scale, for handheld camera shake, a nervous title or a floating logo. frequency is wiggles per second (camera shake 2..6, a slow drift 0.3..1); amplitude is the largest offset: pixels for position/x/y, degrees for rotation, percent for scale (a light shake: position 12 px and rotation 0.6 degrees at 4 Hz; an impact: position 40 px). amplitude 0 removes it. strength 0..1 (default 1) scales it: with at, it is keyed there, so two calls ramp a shake in or out (or add_keyframe on wiggle.x.strength, wiggle.y.strength, wiggle.rotation.strength, wiggle.scale.strength). The same seed repeats the same path. A shaken picture uncovers the canvas edge: set_edge_mode mirror, or scale it up slightly.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual clips |
| `target` | "position" \| "x" \| "y" \| "rotation" \| "scale" | yes | What shakes: position is x and y together |
| `frequency` | number |  | Wiggles per second (Hz); default 3, or the current one (0.05..30) |
| `amplitude` | number |  | Largest offset: pixels (position, x, y), degrees (rotation) or percent (scale); 0 removes the wiggle (0..) |
| `strength` | number |  | 0..1, multiplies the amplitude; keyed at `at` when given (0..1) |
| `seed` | integer |  | Noise seed; default one per clip |
| `at` | number |  | Timeline seconds: key strength there |

Example:

```json
{"name":"set_wiggle","arguments":{"clip_ids":["c_4"],"target":"position","frequency":4,"amplitude":12}}
```

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

Add a text (title) clip. Position x/y are offsets from the canvas center as fractions of its width/height (y=0.35 is near the bottom). It lands above everything at that time (titles, shapes, a grade or beat hits), sharing a free titles track when one is there; on track_id it goes where asked, and the answer notes an adjustment layer above it (its grade or zoom applies to the title too). Overwrite reports overwritten: [{id, kind, what: removed or trimmed}]. Use another track to preserve existing clips. Lines wrap inside the title-safe area by default (style.maxWidth): a centered title within 90% of the width, on 9:16 within the column the apps' buttons leave, one off center within twice the room on its nearer side; 
 breaks a line where you choose.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `text` | string | yes | The words to show; \n for line breaks |
| `start` | number | yes | Seconds (0..) |
| `duration` | number | yes | Seconds (0.001..) |
| `x` | number |  | Horizontal offset, -0.5..0.5 |
| `y` | number |  | Vertical offset, -0.5..0.5 |
| `style` | { font, size, color, bold, weight, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, lineHeight, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text) |
| `style.font` | string |  | Font family |
| `style.size` | number |  | Pixels at 1080p canvas height (4..) |
| `style.color` | string |  | CSS color |
| `style.bold` | boolean |  | Bold (weight 700); setting it clears weight |
| `style.weight` | number |  | Font weight: 100 thin, 300 light, 400 regular, 500 medium, 600 semibold, 700 bold, 800 extra bold, 900 black. Wins over bold; a weight the font lacks draws its nearest face. Pair a heavy display line with a light one (100..900) |
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
| `style.lineHeight` | number |  | Line spacing, a multiple of the size (default 1.2; 0.9-1.0 for tight display headlines) (0.5..3) |
| `style.maxWidth` | number |  | Lines wrap past this fraction of the canvas width; a new title defaults to the safe width where it stands (0.9 centered, 0.62 centered on 9:16, clear of the apps' buttons) (0.1..1) |
| `role` | "headline" \| "subhead" \| "body" \| "label" \| "cta" \| "badge" |  | Style it from the brand kit (set_brand) first, then apply style on top: headline (heading font, about 9% of the frame high, with a shadow), subhead, body, label (small capitals in the accent color), cta (a pill button in the primary color) or badge (a box in the accent color) |
| `track_id` | string |  | Track id; default above everything at that time |
| `anchor` | { clip_id, x, y } |  | Pin it to a point of a clip's picture instead of giving x and y: its center goes there and follows that clip's position, scale and keys (frame_region zooms and pans included) through later edits |
| `anchor.clip_id` | string | yes | The clip whose picture it follows (the screen recording or shot under it), on the same timeline |
| `anchor.x` | number | yes | The point across that clip's source picture: 0 its left edge, 1 its right (frame_region's units) (-1..2) |
| `anchor.y` | number | yes | The point down it: 0 its top, 1 its bottom (-1..2) |

Example:

```json
{"name":"add_text","arguments":{"text":"50% OFF","start":1,"duration":2.5,"y":-0.1,"style":{"size":160,"bold":true,"color":"#ffffff","font":"Arial Black","stroke":{"color":"#000000","width":8}}}}
```

### set_text

Change text clips' style with clip_ids (or clip_id). New text requires exactly one clip. Styled runs keep their positions for same-length changes; otherwise surviving characters carry their style.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string |  | Text clip id; alternatively use clip_ids |
| `clip_ids` | string[] |  | Text clips receiving the same style; text requires one clip |
| `text` | string |  | New words; one clip only |
| `style` | { font, size, color, bold, weight, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, lineHeight, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text); its fields are add_text's style (help add_text) |

Example:

```json
{"name":"set_text","arguments":{"clip_ids":["c_123"],"style":{"background":{"color":"#000000b3","padding":18,"radius":12}}}}
```

### style_text_range

Style characters within a title. UTF-16 offsets are end-exclusive. Alternatively match a literal word or phrase (case-sensitive), choosing a 1-based occurrence or all matches. Later styles merge fields; a color replaces a gradient. clear removes styling in the range, or all runs if no range is supplied. describe_project reports runs.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Text clip id |
| `match` | string |  | Literal word or phrase to find |
| `occurrence` | number |  | 1-based match occurrence; default 1 (1..) |
| `all` | boolean |  | Style every match |
| `start` | number |  | Start UTF-16 character offset, inclusive (0..) |
| `end` | number |  | End UTF-16 character offset, exclusive (1..) |
| `color` | string |  | CSS fill color; replaces the range gradient |
| `gradient` | { from, to, angle } |  | Linear fill gradient |
| `gradient.from` | string | yes | Start CSS color |
| `gradient.to` | string | yes | End CSS color |
| `gradient.angle` | number | yes | Angle in degrees |
| `weight` | number |  | Font weight (100..900) |
| `italic` | boolean |  | Italic letters |
| `underline` | boolean |  | Underline letters |
| `scale` | number |  | Size multiplier relative to the base size (0.25..4) |
| `clear` | boolean |  | Remove styles from the range, or the entire title without a range |

### animate_text_style

Animate a title's size, letter spacing and color with keyframes: each key sets any of them at a timeline time, and the title moves between keys in the key's ease (the curve toward the next one). A tracking expand: [{at: 1, letter_spacing: 0, ease: 'easeOut'}, {at: 2.5, letter_spacing: 24}]; a title that grows and turns accent-colored: [{at: 0, size: 90, color: '#ffffff'}, {at: 0.6, size: 120, color: '#ffd23f'}]. Keys at a time that already has one replace it. size: pixels at 1080p; letter_spacing: pixels at 1080p; color: CSS (keyed colors are opaque: fade the title with opacity). add_keyframe also keys style.size and style.letterSpacing; style.color keys hold 0xRRGGBB numbers. remove_keyframes on style.size, style.letterSpacing or style.color stops one animating.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | Text clip id |
| `keys` | { at, size, letter_spacing, color, ease }[] | yes | Keys, each at a timeline time |
| `keys[].at` | number | yes | Timeline seconds |
| `keys[].size` | number |  | Font size, pixels at 1080p (4..) |
| `keys[].letter_spacing` | number |  | Pixels between letters at 1080p (-20..400) |
| `keys[].color` | string |  | CSS color |
| `keys[].ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" \| "spring" \| "elastic" \| "bounce" |  | Curve toward the next keyframe: linear, hold, easeIn, easeOut, easeInOut, smooth, fastIn, overshoot, anticipate, spring, elastic, bounce. fastIn is the modern expo-out (arrives fast, glides to rest); spring, elastic and bounce overshoot and settle |

Example:

```json
{"name":"animate_text_style","arguments":{"clip_id":"c_5","keys":[{"at":1,"letter_spacing":0,"ease":"easeOut"},{"at":2.5,"letter_spacing":24}]}}
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

Add a sticker from the built-in library (emoji, or drawn arrows, circles, underlines, bubbles, badges) as an image overlay above everything at that time. name is a sticker id, label or the emoji itself: 'fire', 'thumbs-up', 'curved-arrow-red', 'circle-yellow', 'subscribe', '🎉'. window.videoEditor.stickers() lists them; window.videoEditor.exec draws the sticker's image before placing it. Overwrite reports overwritten: [{id, kind, what: removed or trimmed}]. Use another track to preserve existing clips.

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
| `style` | { font, size, color, bold, weight, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, lineHeight, maxWidth } |  | The text's look; fields left out keep their value (or the default look for new text); its fields are add_text's style (help add_text) |
| `y` | number |  | Vertical offset from center as a canvas fraction; default 0.36 near the bottom, or 0.05 on a tall canvas, above the apps' captions and buttons |
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

Add a finished ad element in the brand kit's colors and fonts (set_brand first; neutral defaults otherwise), laid out inside the title-safe area (on 9:16, clear of the apps' buttons and captions) and clear of the captions showing then, animated in, its clips grouped on rows of their own above everything at that time and under the captions (no other clip shares them, so moving another track never reorders its parts). Elements: end_card (a solid card, background brand/primary/scrim/none, with the logo, headline, a call-to-action button and the url; always centered; put it last), lower_third (a name in a box over a title or role in the primary color; hold it 3 to 6 s), offer_badge (headline is the offer, e.g. '-30%' or '$49', in an accent box, tilted, pulsing; subline a small tag under it, e.g. 'Today only'), cta_button (a pill button, e.g. 'Shop now', pulsing; subline or url a line under it), logo_reveal (the logo pops in, optional glow flare and white flash, with headline or the brand name as a wordmark and the tagline). Centered elements sit on the frame's center line, a badge stays in its half, an element too big for its space is built smaller as a whole, and no text goes under the readable floor (4.5% of the frame's short side, 5% on a tall frame: size 49 on 16:9, 31 on 9:16). Every part is an ordinary clip to edit afterwards. Example: {element: 'end_card', start: 12, headline: 'Fresh roast, every morning', cta: 'Order now'}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `element` | "end_card" \| "lower_third" \| "offer_badge" \| "cta_button" \| "logo_reveal" | yes | Which element |
| `start` | number | yes | Timeline seconds (0..) |
| `duration` | number |  | Seconds; default end_card 3, lower_third 4, offer_badge 3, cta_button 3, logo_reveal 2.5 (0.2..) |
| `headline` | string |  | end_card headline; lower_third name; offer_badge offer; logo_reveal wordmark (default the brand name when there is no logo) |
| `subline` | string |  | lower_third title or role; offer_badge tag; cta_button line under it; logo_reveal line under the wordmark (default the tagline) |
| `cta` | string |  | Button words for end_card and cta_button; default 'Shop now' |
| `url` | string |  | end_card and cta_button: website line; default the brand's url |
| `logo` | "auto" \| "main" \| "light" \| "dark" \| "icon" \| "none" |  | Which logo variant: auto (light on dark, dark on light), main, light, dark, icon, or none. end_card and logo_reveal draw one by default (auto); lower_third only when given, left of the name and title and as tall as both; offer_badge and cta_button draw none and refuse it |
| `position` | "top-left" \| "top" \| "top-right" \| "left" \| "center" \| "right" \| "bottom-left" \| "bottom" \| "bottom-right" |  | Where in the safe area: lower_third default bottom-left, offer_badge top-right, cta_button bottom, logo_reveal center (end_card is always centered) |
| `background` | "brand" \| "primary" \| "scrim" \| "none" |  | end_card (default brand) and logo_reveal (default none): brand background color, primary color, scrim (60% black over the footage) or none |
| `glow` | boolean |  | logo_reveal: a glow that flares as the logo lands |
| `flash` | boolean |  | logo_reveal: a white flash as the logo lands |

Example:

```json
{"name":"add_ad_element","arguments":{"element":"end_card","start":12,"headline":"Run further","cta":"Shop now"}}
```

### text_behind_subject

Put titles (or stickers) behind the person or product in a video or picture clip, the 'text behind the subject' look: the clip's background is removed on this computer (a video's matte as Remove background makes it; a picture is cut out once into a new picture; the first run downloads the model), and a copy showing only the subject goes on a new track right above the titles' track, silent and grouped with the original so they move together; an adjustment layer between the copy and the clip (a grade kept under the titles) would not reach the copy, so the copy takes its grade (look, sliders, LUT, effects) as its own. The answer says where the copy went (placed) and what grade it took (graded, note). Titles below the clip are lifted above it first. Works best when a large title overlaps the subject. One undoable edit; answers the copy's id (subjectClipId).

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
{"name":"add_effect","arguments":{"clip_id":"c_123","type":"glow","params":{"amount":60,"threshold":88}}}
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

Adjust one of CapCut's eight HSL color ranges on a visual or adjustment clip; only pixels of that color change. hue turns the range up to 30° toward its neighbors, saturation -100 makes it gray, lightness darkens or lightens it; each -100..100, omitted values stay. band 'all' sets every range. reset=true zeroes the band(s) first. Animate with add_keyframe on adjust.hsl.<band>.hue|saturation|lightness. Hue -100..100 is a turn of -30..30 degrees, so -30 is only 9 degrees: use 60 to 100 for a shift that shows.

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

### set_colorize

Colorize a picture (Premiere's Tint): its brightness drawn in one color, so white becomes the color, black stays black and grays become darker shades of it, mixed over the picture by amount 0..1. This is how a white sprite, glow, light leak or logo becomes amber or a brand color: temperature cannot warm pure white, which is already at the top of every channel. On video, image, title, shape and compound clips, and on an adjustment clip (everything under it). color: CSS (default '#ffb347', amber); amount default 1 (0.3-0.5 tints footage and keeps some of its own color). It runs first in the clip's color, so its exposure, temperature, filter and LUT act on the colorized picture. Values left out keep theirs. Animate with add_keyframe on adjust.colorize.amount (a white flash warming to amber); a keyframed amount gets a key at `at` instead. off: true removes it and its keyframes. Example: {"clip_ids": ["c_7"], "color": "#ffb347"}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Visual or adjustment clips |
| `color` | string |  | CSS color white becomes, e.g. #ffb347 amber; its alpha multiplies amount |
| `amount` | number |  | 0..1, how much of the colorized picture shows over the original (default 1) (0..1) |
| `off` | boolean |  | Remove the colorize and its keyframes |
| `at` | number |  | Timeline seconds, for a keyframed amount |

Example:

```json
{"name":"set_colorize","arguments":{"clip_ids":["c_7"],"color":"#ffb347","amount":1}}
```

## Sound

Voice, music, effects and the mix.

### add_voiceover

Narrate a script, directed: every line is read on this computer (Kokoro), whole, and placed after the one before at its real length on a new Voiceover track, with a caption for each timed to its voice (or, with caption_words 1-3, captions a few words at a time, each word timed to the voice for the spoken-word highlight: caption_clips per line), as one undo step with its speech files. Pace: each line lands on its words a second over its speech (first word to last; the reader's pauses at commas and sentence ends in, its pause marks out, so a beat written into a line never makes its words faster): read_as narration (2.3-2.8, the default), ad (2.6-3.1) or social (2.8-3.4), moved half a word down by pace slow (and then never read faster than speed 1) or up by fast, or words_per_second [lowest, highest], per call or per line, held as given whatever the pace, except that a band never rushes long words: one whose top would say the line faster than 5 syllables a second moves down until it does not (seven syllables in three words read 1.64-2.14, not 2.3-2.8), and pace_note says so; with no speed given, each line is read, measured and read again at the speed that lands it (up to three reads; the audio is never stretched). A speed given is kept as given. Direct each line: a voice of its own (several speakers in one call), at (a timeline time, such as a beat or a cut; later lines follow it), pause_after (seconds before the next line; by default the line's ending sets it: 0.4 after a sentence, 0.1 after a comma, 0.6 after an ellipsis, 0.8 after a paragraph), pace slow or fast. Pauses inside a line are written in it: [pause] (0.5 s), [pause 0.4], [pause 300ms], [beat] (1 s) or <break time="0.4s"/>; the voice's own pause there is lengthened, so the sentence keeps its intonation, and the caption never shows the mark. A word cannot be marked for emphasis (the voice model has no such control; *word* stars are dropped, with a note): write it last in its phrase, where English puts the main stress, or [pause 0.2] before it. pronounce respells words for the voice only ({"MCP": "M C P", "OpenFrame": "Open Frame"}); captions keep the words as written. The natural finish (default) makes it sit like a recorded read: pauses at commas and sentence ends a reader's length, a low cut and a little presence, every line at one loudness, room tone under the pauses, faded edges, the voice compressor and a touch of room. Answers each line's start, end, seconds, voice, speed, words_per_second (over its speech) and target_words_per_second, and clip ids: cut the footage to them, then review_voiceover to hear it back. Voices: af_heart, af_bella, af_nicole, bf_emma, am_michael, am_fenrir, am_puck, af_aoede, af_kore, af_sarah, bm_george, bm_fable, bf_isabella. The first use downloads the speech model (about 325 MB at quality best); a read takes about a second with WebGPU, several on a CPU.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `lines` | { text, caption, at, voice, speed, words_per_second, read_as, pause_after, paragraph, pace }[] | yes | The script, one sentence or two per line (a breath each) |
| `lines[].text` | string | yes | Words to say and show, with pause marks: [pause], [pause 0.4], [pause 300ms], [beat], <break time="0.4s"/> |
| `lines[].caption` | string |  | What the caption shows instead, when it should differ from the words spoken (20% off for 'twenty percent off', a URL) |
| `lines[].at` | number |  | Timeline seconds this line starts (a beat, a cut); later lines follow it; default after the line before. A line the one before runs past starts where that one ends, and a note says so (0..) |
| `lines[].voice` | string |  | This line's voice (another speaker); default the call's |
| `lines[].speed` | number |  | This line's speed, kept as given; default the call's, or chosen to land on its words a second (0.5..2) |
| `lines[].words_per_second` | number[] |  | This line's [lowest, highest] words a second; default the call's |
| `lines[].read_as` | "narration" \| "ad" \| "social" |  | This line's kind of read (narration, ad or social), whose band it lands on: another speaker's brisk radio call among narration; default the call's |
| `lines[].pause_after` | number |  | Seconds of silence before the next line (overrides gap and the line's ending) (0..10) |
| `lines[].paragraph` | boolean |  | This line ends a paragraph: 0.8 s before the next |
| `lines[].pace` | "slow" \| "normal" \| "fast" |  | The pace the line is meant to have, kept with it: slow (an end-card tagline, a dramatic beat) or fast moves its kind's words a second half a word down or up, for the read and the review, and a slow line is read no faster than speed 1; a words_per_second given wins over it (default normal) |
| `voice` | string |  | Voice id, or a blend of voices' styles ("af_heart:60,af_bella:40"); default af_heart, the most natural |
| `read_as` | "narration" \| "ad" \| "social" |  | The kind of read, whose words a second lines land on: narration 2.3-2.8, ad 2.6-3.1, social 2.8-3.4 (default narration) |
| `words_per_second` | number[] |  | [lowest, highest] words a second over each line's speech, first word to last, its pause marks out (narration [2.3, 2.8]); held exactly as given, whatever the pace; the speed is chosen to land on it |
| `speed` | number |  | Every line's speed, kept as given (1 is the model's own pace, about 4.6 syllables a second); default: chosen per line to land on its words a second (0.5..2) |
| `pronounce` | object |  | Words respelled for the voice only (whole words, case as written), each to the text the voice reads: {"MCP": "M C P", "OpenFrame": "Open Frame"} |
| `start` | number |  | Seconds the first line starts, default 0 (0..) |
| `gap` | number |  | Seconds between every pair of lines, instead of each line's ending choosing (0..) |
| `quality` | "best" \| "draft" |  | best: full-precision weights (default; on WebGPU, or on the CPU about as fast as draft); draft: 8-bit weights, a quarter of the download |
| `finish` | "natural" \| "clean" \| "raw" |  | natural (default): a recorded read's pauses, EQ, one loudness, room tone, the voice compressor and a touch of room; clean: one loudness and faded edges, nothing added; raw: the model's read, trimmed |
| `captions` | boolean |  | A caption per line (default true) |
| `caption_words` | integer |  | Caption each line this many words at a time (1-3; 2 or 3 for a short's pop captions) instead of one caption a line: each word timed to the voice (heard by Whisper, its start fitted to the voice's own start and pauses), its times kept for the spoken-word highlight (caption_style.highlight); a retake captions its line the same way (1..3) |
| `enhance` | boolean |  | Even out each voice with the Enhance voice compressor (default true; finish raw has none) |
| `caption_style` | { font, size, color, bold, weight, italic, align, highlight, case, background, stroke, stroke2, shadow, glow, gradient, accent, letterSpacing, lineHeight, maxWidth } |  | The captions' look, as a title's style takes it; its fields are add_text's style (help add_text) |
| `caption_y` | number |  | Captions' vertical offset from center, canvas fraction (default 0.36, or 0.05 on a tall canvas, above the apps' captions and buttons) |

Example:

```json
{"name":"add_voiceover","arguments":{"lines":[{"text":"Meet OpenFrame. [pause 0.4] The video editor that runs on your own computer."},{"text":"Every edit is a tool an agent can call,","voice":"am_michael"},{"text":"so a whole film can be made by asking.","voice":"am_michael","pause_after":0.8},{"text":"Free. [beat] Open source. Yours.","at":12,"caption":"Free, open source, yours.","pace":"slow"}],"voice":"af_heart","read_as":"ad","pronounce":{"OpenFrame":"Open Frame"}}}
```

### review_voiceover

Listen back to voiceover lines on this computer: Whisper hears each voice clip and compares it with its script word by word (a misread name or a skipped word shows, with where), and each line is measured: its pace (words and syllables a second over its speech, first word to last with its pause marks out, as it was read: pause_marks_out says how many seconds; and over its clip) against the words a second it was read to (narration 2.3-2.8 unless add_voiceover was given read_as or words_per_second; pace slow or fast moves a kind's band, never a words_per_second given; any band moves down for long words, as the speed was chosen, so its top says at most 5 syllables a second), the silence before and after it and its longest pause, its loudness and true peak as mixed, its pitch (median and range in semitones; under 3 sounds flat) and how far it sits over the music under it in the line window (this line alone, its first word to its last; at least 8, 10-15 for a promo). Each line ends with a verdict: ok when nothing fails, otherwise what to fix, with fixes: the tool and arguments for each problem (retake_voiceover with a pronunciation or words_per_second, set_param volume, duck_under_speech min_line_lu, trim_clip). advice holds notes that do not fail the line: a pace within a tenth of its band, a speed already chosen that the voice could not bring nearer, short words drawn out. A line that differs from its script is heard again by a larger Whisper (small, downloaded once, about 250 MB) before the voice is blamed, a word heard that is not in the script too (Whisper hears "you" in a breath): each difference says likely recognizer (heard right the second time: no retake, a note says so) or voice, and heard_again has what it heard; minor marks a short word a letter off, which passes. match is the share of words heard as written, a word heard that is not in the script counting against it, so it is under 1 whenever a difference is listed. A misread word gets a respelling as it sounds (does as duz, home as hohm, MCP as M C P); one already respelled, or with nothing that reads differently, gets a slower read and the advice to reword. The summary counts lines ok, to fix and with advice; gives the lines' words a second (lowest, median, highest), the script's words a second with the gaps between lines in (lower than the lines'), the lines' margins over the music and the loudness spread across lines. Lines short of their margin over a music track get one fix in summary.fixes: duck_under_speech on that track (track_id, every piece of the song as one bed), each line pointing at it. detail summary (the default) gives each line its verdict (ok, or to fix: the problems are in its fixes), fixes, advice, words a second against its band, loudness and margin over the music, and what was heard only where it differs from the script; detail full adds every measure (syllables, the clip window, silences, true peak, pitch). Nothing is edited. The first use downloads Whisper (about 80 MB); each line takes a second or two.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] |  | Voice clips to hear (add_voiceover's voice_clip ids); default every voiceover line |
| `music` | boolean |  | Measure each line's margin over the music tracks under it (default true) |
| `recheck` | boolean |  | Hear a line with a difference again with a larger Whisper model (small, 249 MB downloaded once), to say whether the recognizer or the voice is wrong (default true) |
| `detail` | "summary" \| "full" |  | summary (default): each line's verdict and what decides it; full: every measure of every line |

Example:

```json
{"name":"review_voiceover","arguments":{}}
```

### retake_voiceover

Read one voiceover line again and put it in the line's place, as one undo step: new text (with pause marks), a voice, words_per_second (held as given over any pace the line keeps, moved down only so long words are not said faster than 5 syllables a second: pace_note says so) or read_as (the speed is then chosen by reading and measuring, as add_voiceover does, pause marks out of the pace), a speed (kept as given) or pronunciations (the pronounce fix review_voiceover suggests). With none of these, a line whose speed was chosen is landed on its words a second again, and a line read at a speed given keeps it. The voice model reads the same input the same way every time, so change something. The clip keeps its id, start and settings; its caption takes the new words and length (a line captioned a few words at a time, caption_words, is captioned so again, timed to the new take: caption_clips); the old take leaves the media library. A longer take must fit before the next line unless ripple is true, which moves the lines and captions after it by the difference (the picture stays). Answers the line's new start, end, seconds, voice, speed, words_per_second (over its speech) and target_words_per_second; when the speed was chosen, speed_chosen is true and a note says how many reads it took. Music that duck_under_speech dipped under the line (or under the lines a ripple moved) is dipped again under the new take as it was asked, in the same undo step: ducking lists each, with the voice's margin over it now; music whose volume keys were edited by hand since is left alone and a note says so.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The voice clip (add_voiceover's voice_clip) |
| `text` | string |  | New words, with pause marks; default the line's own |
| `caption` | string |  | What the caption shows, when it should differ from the words; default the new text as written |
| `voice` | string |  | Voice id (list_catalog section voices), or a blend ("af_heart:60,af_bella:40"); default af_heart |
| `read_as` | "narration" \| "ad" \| "social" |  | The kind of read, whose words a second lines land on: narration 2.3-2.8, ad 2.6-3.1, social 2.8-3.4 (default narration) |
| `words_per_second` | number[] |  | [lowest, highest] words a second over the line's speech; default the line's own |
| `speed` | number |  | Kept as given; default the line's own speed, or chosen again when it was chosen (0.5..2) |
| `pronounce` | object |  | Words respelled for the voice, replacing the line's own map ({} clears it) |
| `quality` | "best" \| "draft" |  | best: full-precision weights (default; on WebGPU, or on the CPU about as fast as draft); draft: 8-bit weights, a quarter of the download |
| `finish` | "natural" \| "clean" \| "raw" |  | natural (default): a recorded read's pauses, EQ, one loudness, room tone, the voice compressor and a touch of room; clean: one loudness and faded edges, nothing added; raw: the model's read, trimmed |
| `pace` | "slow" \| "normal" \| "fast" |  | The pace the line is meant to have; default the line's own |
| `ripple` | boolean |  | Move the lines and captions after it by the change in length (default false) |
| `caption_words` | integer |  | Caption the line this many words at a time (1-3), each word timed to the new take, or 0 for one caption for the line; default as the line was captioned (0..3) |

Example:

```json
{"name":"retake_voiceover","arguments":{"clip_id":"c_vo2","pronounce":{"MCP":"M C P"},"words_per_second":[2.3,2.8],"ripple":true}}
```

### text_to_speech

Read a title aloud in a voice made on this computer (Kokoro), placing the voice on an audio track at the title's start, as one undo step with its speech file. With no speed given it lands on a narrator's words a second (2.3-2.8; pace slow or fast moves it half a word), its speed chosen by reading and measuring. Voices (list_catalog section voices describes each): af_heart, af_bella, af_nicole, bf_emma, am_michael, am_fenrir, am_puck, af_aoede, af_kore, af_sarah, bm_george, bm_fable, bf_isabella. The first use downloads the speech model.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The title (text clip) |
| `voice` | string |  | Voice id (list_catalog section voices), or a blend ("af_heart:60,af_bella:40"); default af_heart |
| `pace` | "slow" \| "normal" \| "fast" |  | The pace the line is meant to have, kept with it: slow (an end-card tagline, a dramatic beat) or fast moves its kind's words a second half a word down or up, for the read and the review, and a slow line is read no faster than speed 1; a words_per_second given wins over it (default normal) |
| `speed` | number |  | 1 is the model's own pace; kept as given. Default: chosen per line to land on its words a second (Heart narrates at 0.6-0.9) (0.5..2) |
| `pronounce` | object |  | Words respelled for the voice only (whole words, case as written), each to the text the voice reads: {"MCP": "M C P", "OpenFrame": "Open Frame"} |
| `quality` | "best" \| "draft" |  | best: full-precision weights (default; on WebGPU, or on the CPU about as fast as draft); draft: 8-bit weights, a quarter of the download |
| `finish` | "natural" \| "clean" \| "raw" |  | natural (default): a recorded read's pauses, EQ, one loudness, room tone, the voice compressor and a touch of room; clean: one loudness and faded edges, nothing added; raw: the model's read, trimmed |

### add_sound_effect

Add built-in sound effects, made on this computer: whoosh (Whoosh, 0.8 s), swish (Swish, 0.35 s), pop (Pop, 0.15 s), click (Click, 0.06 s), ding (Ding, 1.4 s), success (Success, 0.5 s), rise (Riser, 2 s), impact (Impact, 1.2 s), subDrop (Sub drop, 1.8 s), braam (Braam, 3 s), reverseCymbal (Reverse cymbal, 2 s), glitch (Glitch, 0.5 s), shutter (Camera shutter, 0.25 s), swooshUp (Swoosh up, 0.9 s), boom (Boom, 1.5 s). One lands at `start` (default the playhead), or so that it ENDS at `end_at`: a riser or reverse cymbal then peaks exactly there (put end_at on the drop or a cut); a hit, boom or sub drop goes at the beat with start. They land on the effects stem: an SFX track (made the first time, reused after; overlapping sounds get a second SFX track), never a gap on the voiceover or the music; track_id puts them on a track of your own. `sounds` places many at once, as one undo step: a whoosh on every cut of a montage in one call (it cannot go in batch). Each file is made once per project and reused. add_ambience lays continuous natural sound (wind, water, rain, city, a rocket's rumble, room tone). Answers the new clip ids.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | "whoosh" \| "swish" \| "pop" \| "click" \| "ding" \| "success" \| "rise" \| "impact" \| "subDrop" \| "braam" \| "reverseCymbal" \| "glitch" \| "shutter" \| "swooshUp" \| "boom" |  | Which effect (list_catalog section sound_effects has their lengths) |
| `start` | number |  | Timeline seconds the sound starts (0..) |
| `end_at` | number |  | Timeline seconds the sound ends instead (start = end_at - its length) (0..) |
| `volume` | number |  | Gain, 1 as made (0.5 is about -6 dB, 0.25 -12 dB); default 1 (0..4) |
| `track_id` | string |  | An audio track to put them on (default the SFX track); where a sound would overlap one there, a new track of its role just below |
| `sounds` | { name, start, end_at, volume, track_id }[] |  | Many sounds in one call instead of name: each with its own name, start or end_at, volume and track_id |
| `sounds[].name` | "whoosh" \| "swish" \| "pop" \| "click" \| "ding" \| "success" \| "rise" \| "impact" \| "subDrop" \| "braam" \| "reverseCymbal" \| "glitch" \| "shutter" \| "swooshUp" \| "boom" | yes | Which effect |
| `sounds[].start` | number |  | Timeline seconds it starts (default the playhead) (0..) |
| `sounds[].end_at` | number |  | Timeline seconds it ends instead (0..) |
| `sounds[].volume` | number |  | Gain, default 1 (0..4) |
| `sounds[].track_id` | string |  | Its audio track; default the call's track_id, else the SFX track |

Example:

```json
{"name":"add_sound_effect","arguments":{"sounds":[{"name":"whoosh","start":3.9},{"name":"whoosh","start":7.9,"volume":0.6},{"name":"rise","end_at":12},{"name":"impact","start":12}]}}
```

### add_ambience

Lay continuous natural sound under the pictures, made on this computer (no recordings, nothing downloaded): wind (open-air wind in gusts, a low buffeting under it); stream (a brook babbling over stones, close); waterfall (a waterfall's steady roar, close enough to feel); surf (waves breaking on a beach and washing back, a distant roar between); rain (steady rain on leaves and ground, drops near and far); rocket (a rocket's launch heard from a distance: a deep roar with its crackle); city (a city street: cars passing near and far over the city's low hum); roomTone (a quiet room's air: ventilation and the room itself, for under and between lines). It runs from start (default the playhead) to end, or for length seconds (default to the end of the timeline), faded in and out (fade_in 1 s and fade_out 1.5 s by default), on the Ambience track (made the first time, reused after; never the voiceover, the music or the effects). Each bed moves slowly and at random as a recording does (gusts, waves arriving every 7 to 13 s, cars passing near and far) and its file loops without a seam; a bed past 300 s repeats it. Made at a level that sits under a voice with volume 1 (about -27 LUFS; the rocket -21, room tone -46): volume 0.5 is 6 dB quieter. The same name and seed reuse the file; another seed is another take. preview_audio with solo ambience hears it. Answers the clip ids, the file's asset id and the track. It cannot go in batch.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | "wind" \| "stream" \| "waterfall" \| "surf" \| "rain" \| "rocket" \| "city" \| "roomTone" | yes | Which bed (list_catalog section ambience describes each) |
| `start` | number |  | Timeline seconds it starts; default the playhead (0..) |
| `end` | number |  | Timeline seconds it ends; default the end of the timeline (0..) |
| `length` | number |  | Seconds it lasts, instead of end (0.5..) |
| `fade_in` | number |  | Seconds it fades in over; default 1 (0..) |
| `fade_out` | number |  | Seconds it fades out over; default 1.5 (0..) |
| `volume` | number |  | Gain, 1 as made (0.5 is about -6 dB); default 1 (0..4) |
| `seed` | integer |  | Another take of the same bed (default 1) (1..) |
| `track_id` | string |  | An audio track to put it on; default the Ambience track |

Example:

```json
{"name":"add_ambience","arguments":{"name":"waterfall","start":22,"end":34,"fade_in":1.5,"fade_out":2,"volume":0.7}}
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

Filter a video or audio clip's sound, 24 dB per octave. type lowpass keeps the lows (muffled, as through a wall or from the next room); highpass keeps the highs (thin, as on a phone or a small radio). cutoff in Hz, 20..20000 (a new filter starts at 500 Hz low-pass, 300 Hz high-pass); without sweep it is fixed (its keyframes go). resonance in dB, 0..24 (default 0, a smooth slope; 6..12 adds the whistling peak of a synth sweep). sweep moves the cutoff from cutoff at sweep.start to sweep.to at sweep.end (timeline seconds), on a log scale, holding before and after; it replaces the cutoff's keyframes. The trailer move "muffled build, open on the drop" at 5 s: {type: "lowpass", cutoff: 400, sweep: {to: 20000, start: 4.5, end: 5}}. add_keyframe on lowpass.cutoff or highpass.cutoff adds more points. off: true removes that filter and its keyframes. A filter takes loudness out with what it cuts: a radio band-pass (highpass 380, lowpass 3400) took 3-3.6 LU off a voice. keep_loudness: true measures the clip before and after and makes up the difference after the filter (its makeup, dB), so a filtered voice line stays as loud as the others; it measures on this computer, so it runs on its own, not in a batch. makeup sets that gain by hand. Filtering a voice line without either answers a note.

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
| `sweep.ease` | "linear" \| "hold" \| "easeIn" \| "easeOut" \| "easeInOut" \| "smooth" \| "fastIn" \| "overshoot" \| "anticipate" \| "spring" \| "elastic" \| "bounce" |  | Curve of the sweep (default linear: the same octaves each second); the keyframe tools' eases |
| `off` | boolean |  | Remove this filter |
| `makeup` | number |  | Gain after the filter, dB, to make up what it takes out (absent: 0) (-24..24) |
| `keep_loudness` | boolean |  | Measure the clip before and after and set makeup so it stays as loud (a fixed filter only; not in a batch) |

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

Even out a clip's sound with a compressor after its EQ (CapCut's Enhance voice, Premiere's Dynamics): preset voice (speech; the usual choice), gentle, strong, or off. threshold (dBFS), ratio, knee (dB), attack and release (seconds) and makeup (dB) adjust it. On a compound clip it acts on the mix of everything inside, as a bus does: one compressor over a voice and its music, after the compound clip's EQ and before its volume and fades. normalize_loudness measures through it, and export loudness reaches its target with far less limiting.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video, audio or compound clips |
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

### set_crossfade

Crossfade an audio clip into the next clip on its track, which starts where it ends (two pieces of a song, two songs, two takes of a bed): at equal power over seconds, ending at the cut, the next clip's sound rising over the seconds before its start from its file before its in-point (it needs that much), this one falling over its last. 0 makes it a butt cut again. A butt cut ramps each side over 4 ms to stop a click, which leaves a few milliseconds of near-silence at the join; preview_audio's edges measure it. Both clips play at their own speed. Example: {"clip_id": "c_3", "seconds": 0.03}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string | yes | The audio clip before the join |
| `seconds` | number | yes | Seconds of crossfade (0 removes it; at most 2) (0..2) |

Example:

```json
{"name":"set_crossfade","arguments":{"clip_id":"c_3","seconds":0.03}}
```

### normalize_loudness

Measure clips' loudness (EBU R128) and set their volume to reach a target without their true peak passing the ceiling (-1 dBTP; -2 for ATSC). -14 LUFS suits social video, -16 podcasts, -23 European broadcast, -24 US TV. spec names a delivery spec instead (its target and ceiling). A ducked clip keeps its duck: its volume keys scale so the loudest is the new level. Each clip is measured alone: measure_loudness checks the mix.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_ids` | string[] | yes | Video or audio clip ids |
| `target` | number |  | LUFS, default -14 (-40..-5) |
| `spec` | "online" \| "ebu_r128" \| "atsc_a85" |  | online (-14 LUFS, -1 dBTP), ebu_r128 (-23 LUFS, -1 dBTP) or atsc_a85 (-24 LKFS, -2 dBTP); overrides target |

### duck_under_speech

Lower music wherever the other clips with sound under it (inside compound clips too) have speech, as editable volume keyframes: one clip (clip_id), or every clip of a music track as one bed (track_id: a song cut into pieces is ducked in one call, a line across a cut dipping on both sides). A voice's balance over music depends on the window it is measured in, and the answer names it: speech (while the voice speaks, every line from its first word to its last, together) and line (each line alone); measure_loudness by_track also gives program (the whole stretch, music between lines included, which reads lower). voice_above_music_lu aims the voice that many LU over the music in the speech window; min_line_lu holds every line to at least that many LU over the music, each line's dip as deep as it needs (with voice_above_music_lu, or depth, as the usual dip); max_line_lu holds every line to at most that many, a line over a quiet passage dipping less (never raised over its volume), so a quiet intro or a last hit is not emptied: by default 15 LU (or 3 over voice_above_music_lu or min_line_lu, when higher) whenever any of the three is given, and never under voice_above_music_lu (lines each under it cannot sit over it together); a line held under the ceiling moves the others so the lines together stay on voice_above_music_lu. All are measured on the rendered stems and met by measuring again; balance answers the speech window's numbers, target and met, and per_line the lines' lowest, median and highest margins, the minimum and ceiling held to, and each line with its own dip. Plain depth lowers by that many dB without measuring. Between lines: a pause shorter than min_gap (default 1.1 s) stays down so the music does not pump, and so does the music before a first line or after a last one that close to its start or end (no blip); a longer pause comes back up over release (default 0.4 s) and dips again 0.1 s before the next line. open_at brings the music up on chosen moments whatever their pause: timeline seconds, or marker labels ("Drop": every marker so labeled, as analyze_music and set_music_grid mark a song's drops), so a drop between lines plays at the music's level; a moment inside a line stays down under the voice. The answer lists the pauses held down (held, seconds), each open_at moment with where the music is up around it (up) or the line it falls in (inside_line), and notes a drop marker the music stays down through. Volume keys made by hand (added or changed since the last duck: a lift on a drop, a hold before a hit) are kept wherever no line speaks, in place of the duck's own in that pause, the duck's level held at the lines either side; one under a line is replaced, and hand_keys lists both. The music keeps how it was ducked: a voice line that changes later (retake_voiceover) dips it again the same way, and an edit that moves a line under it, or moves the music and its dips (cut_music, move_clip), says so.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `clip_id` | string |  | The music clip (or give track_id) |
| `track_id` | string |  | A music track: every clip with sound on it ducked as one bed, instead of clip_id |
| `voice_above_music_lu` | number |  | LU the voice sits over the music while it speaks (all lines together; 10-15 for a promo); measured and met, overrides depth (0..30) |
| `min_line_lu` | number |  | LU every line sits over the music at least (each line alone, its first word to its last); a line short of it dips deeper, measured and met (0..30) |
| `max_line_lu` | number |  | LU every line sits over the music at most; a line past it dips less, measured and met (default 15, or 3 over voice_above_music_lu or min_line_lu when higher) (0..30) |
| `depth` | number |  | dB to lower, default 12; with min_line_lu alone, the least dip under every line (default none) (1..40) |
| `open_at` | any[] |  | Moments the music comes up at between lines: timeline seconds, or marker labels ("Drop": every marker so labeled); default none |
| `min_gap` | number |  | Seconds a pause between lines must last for the music to come up (default 1.1: shorter pauses stay down, so the music does not pump) (0.2..10) |
| `release` | number |  | Seconds the music takes to come back up after a line (default 0.4) (0.05..3) |

Example:

```json
{"name":"duck_under_speech","arguments":{"track_id":"t_music","voice_above_music_lu":12,"min_line_lu":10}}
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

Look inside imported media before using it: a video's own frames at source seconds (times), or `count` frames spread over the whole file (default 12), as one contact sheet; a still picture whole, labeled with its size. Use it to choose the in-points and moments worth using (a hero shot, a reaction, the action) and to see what a photo shows before framing it. file instead of asset_id looks inside a file without importing it: an exported video (the path export_video or export_versions answered) to see what was delivered, frame by frame as the file has it, not the timeline; the answer adds the file's length and size.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `asset_id` | string |  | A video or picture asset id from describe_project or import_media |
| `file` | string |  | Instead of asset_id: a video or picture file to look inside without importing it, e.g. an exported file's path (desktop: an absolute path; the browser build: a URL) |
| `times` | number[] |  | Source seconds, up to 24 |
| `count` | integer |  | Frames spread over the file when times is not given; default 12 (2..24) |
| `columns` | integer |  | Tiles a row, at most 8; default 4 (1..8) |
| `tile_width` | integer |  | Default 320 (120..640) |

Example:

```json
{"name":"preview_media","arguments":{"asset_id":"a_123","count":12}}
```

### preview_frames

See several moments at once: one JPEG contact sheet of the frames at the given times, each stamped with its time. Check a whole edit in one call, then preview_frame a moment that needs a closer look.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `times` | number[] | yes | Seconds, up to 24 |
| `columns` | integer |  | Tiles a row, at most 8; default 4 (1..8) |
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
| `columns` | integer |  | Tiles a row, at most 8; default 6 (1..8) |
| `tile_width` | integer |  | Default 240 (120..640) |

Example:

```json
{"name":"preview_motion","arguments":{"start":7.5,"end":9.5,"fps":10}}
```

### preview_frame

See the composited picture at a time: returns a PNG image of the frame exactly as it would export.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `at` | number | yes | Seconds (0..) |
| `max_width` | integer |  | Image width, default 640 (at most the canvas width) (64..1920) |

### preview_audio

Hear the sound: a stretch of the mix, or one stem, rendered offline through the mixer export uses (every clip's volume, fades, ducking keys, EQ, compressor, filters, reverb and echo tails), returned as a short MP3 (an audio content block, 96 kbps stereo, at most 30 s a call) for a model that can listen, and as text the measurements for one that cannot: integrated loudness, the loudest 3 s and 400 ms, every second's loudness, the true peak, silent stretches, where the energy sits (below 250 Hz, to 4 kHz, above, and the octave slope; speech and most mixes slope -3 to -6 dB an octave), the stereo correlation and clipped samples; with solo mix also each stem's loudness (dialog, music, effects, ambience, by each track's role, and picture: what the video tracks play, their footage's own sound and any compound clip's mix), each its own integrated loudness where it sounds, so they do not add up to the mix's. edges measures, sample by sample, every place in the stretch where an audio clip meets the next on its track (a song's splice) and any clip start or end that is not clean: dip_db (a hole of a few milliseconds at the cut, as a butt cut's click guard leaves: -10 or deeper is heard as a tick), click_db (a sample step steeper than any around it and than the incoming file's own attack there, so a kick on the downbeat a cut lands on is no click), step_db (the level after against before; a join stepping 6 dB or more that the music makes there itself, on a new bar or hit, says so in step_note, and one inside a ring-out (the sound falling 6 dB or more over the second before) that neither file makes there is flagged at 6 dB, not 12), tail_cut_db (the clip's own file rings on that much louder than what follows: a tail cut dead) and cut_in_db (a clip coming in mid-sound), each with a verdict (clean, or what is wrong) and the fix (set_crossfade, set_fades); dropouts lists anywhere the sound falls to nothing for 3-100 ms inside sound (a lost packet, a hole). solo: mix (default), voice (the dialog tracks alone), music, effects or ambience; the picture's own sound plays only in mix. loudness hears it as export_video with that loudness delivers it (the whole mix is measured first, so it takes longer). audio false answers the measurements alone. Nothing is changed.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `start` | number | yes | Timeline seconds (0..) |
| `end` | number |  | Timeline seconds; default start + 10, at most start + 30 (0..) |
| `solo` | "mix" \| "voice" \| "music" \| "effects" \| "ambience" |  | What to hear: the whole mix (default) or one stem by role |
| `loudness` | number |  | Hear it as export_video with this loudness (LUFS) delivers it; default as mixed (-40..-5) |
| `audio` | boolean |  | false: the measurements only, no MP3 (default true) |

Example:

```json
{"name":"preview_audio","arguments":{"start":6,"end":14,"solo":"mix"}}
```

### check_project

Check the edit against professional rules before exporting: text outside the 90% title-safe area or under the vertical apps' buttons; text too small for a phone (its share of the frame's height named, under 4.5% of the short side, 5% on a tall frame or kind social_short) or too short to read; text in low contrast with the picture behind it: every title is measured on the rendered picture at a few moments of its life with its box, shadow and outline counted, and a low one is named with its WCAG ratio, the time, and a box or outline that measures better there (contrast.lowest lists every title's ratio); a title that fades unevenly (measured at the middle of each fade: part of it gone while the rest is still seen, as a see-through box over a bright subject does), with the box or outline that fades as one there; captions over 20 characters a second, more than two fonts, a title its subject hides (text_behind_subject on a shape the subject now fills; rendered), flashes over 3 a second (seizure risk), black gaps on the main track, music that stops dead at the end (its last second measured, so a track that fades out in its own audio passes), a sound cut off before the end with no fade while it still sounds (a song or a bed trimmed mid-phrase, a line cut mid-word), a click, a hole or a sound cut off where one audio clip meets the next (each join measured on its own track as preview_audio's edges measure it, the first 24; click_at_join, sound_cut_at_join, the fix a crossfade), and by kind: an ad's end card, an epic edit's cuts on the beat (the Beat, Bar, Phrase and Drop markers, or the grid set_music_grid gave a song, where its clips play it; cuts counted where the viewer sees them, across tracks). ok is true when there are no errors; warnings and tips can remain beside it, and verdict says so in words. not_checked says what was not measured, and why. Every text rule sees the titles inside compound clips too (an end card built as one), where and as large as the compound clip draws them; such a finding names compound_clip_id. Each finding names the clip, the time and the tool that fixes it; the same finding on three clips or more (the same rule and fix) is given once, with count, every clip_id and every time (at), unless detail is full. Captions shown a few words at a time (runs of captions of up to three words, each within 0.3 s of the one before) are read as the line they make: its characters a second over the run, and each chunk up at least 0.25 s. Run it, fix, run it again.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `kind` | "ad" \| "epic_edit" \| "social_short" \| "any" |  | What is being made; default any |
| `detail` | "summary" \| "full" |  | summary (default): alike findings given once with every clip; full: every finding on its own |

Example:

```json
{"name":"check_project","arguments":{"kind":"ad"}}
```

### measure_loudness

Measure the mix the way export renders it (48 kHz stereo, every clip's effects, tails and fades) and check it against a delivery spec before exporting. Answers integrated_lufs (BS.1770), loudness_range_lu (EBU Tech 3342 LRA) with range (the LRA against what kind usually spans: film 5-15 LU, ad 3-8, social 3-10, podcast 3-8; a very flat or wide mix gets a note), short_term_max_lufs (loudest 3 s), momentary_max_lufs (loudest 400 ms), true_peak_dbtp (4x oversampled) and sample_peak_dbfs, then pass and the problems against spec: online (-14 LUFS ±1, at most -1 dBTP: YouTube, Spotify, TikTok), ebu_r128 (-23 LUFS ±0.5, at most -1 dBTP: European broadcast) or atsc_a85 (-24 LKFS ±2, at most -2 dBTP: US TV); all three when spec is left out. loudness measures what export_video with that loudness delivers (the mix raised or lowered, its true peak held by the limiter), so a failing mix can be checked as exported: {spec: "ebu_r128", loudness: -23}. by_track measures each audio track alone as mixed (integrated, loudest three seconds, LRA) and, with a Voiceover track and music, the voice over the music in three named windows that differ by design: program (the whole stretch, music between lines included), speech (while the voice speaks, its lines together) and per_line (each line alone: lowest, median, highest, and where the lowest is). start and end (timeline seconds) measure part of it. It takes about a quarter of the mix's length to run (a 60 s mix, some 15 s), twice that with loudness.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `by_track` | boolean |  | Each audio track measured alone as mixed (before master normalization), with its role (describe_project names each track's; update_track sets one), and the voice's margin over the music (the dialog and music tracks, by role) by window: program, speech and per_line |
| `per_second` | boolean |  | With by_track, each track's three-second loudness every second too (long; default false: summaries only) |
| `kind` | "film" \| "ad" \| "social" \| "podcast" \| "explainer" \| "any" |  | What the mix is for, to judge its loudness range: film (documentary, brand film), ad, social, podcast, explainer (one voice leading over a ducked bed: a tutorial, a narrated demo or product explainer) or any (default) |
| `spec` | "online" \| "ebu_r128" \| "atsc_a85" |  | Delivery spec to check; default all three |
| `loudness` | number |  | Measure as export_video with this loudness (LUFS) delivers it; default as mixed (-40..-5) |
| `start` | number |  | Timeline seconds, default 0 (0..) |
| `end` | number |  | Timeline seconds, default the end (0..) |

Example:

```json
{"name":"measure_loudness","arguments":{"spec":"online","loudness":-14}}
```

### export_video

Export the open project to a video file in the user's Videos folder (in a folder named after the app), or in folder, with no dialog; an existing file is never replaced: the new one takes a numbered name (Trip (2).mp4) and the answer's note says so. Returns the file's path when done. loudness brings the mix to an integrated LUFS with its true peak held under -1 dBTP: -14 for YouTube, TikTok and Spotify, -23 for EBU R128 broadcast, -24 for ATSC A/85 US TV (held under -2 dBTP); the answer's loudness says what the mix reached. Each exported file answers the loudness its mix reached (loudness, info), as export_video does, and titles: a title behind its subject that the subject hides in that shape. Exports that take over about four minutes answer state running: follow them with export_status. format mp3, m4a or wav exports the sound alone. preview_media with file: the answer's path shows the exported file's own frames. captions decides what becomes of the captions (add_captions): burn (default) draws them into the picture, srt writes them as a .srt file beside the video (answered as captions_file) and leaves the picture clean, both does both, none leaves them out.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `name` | string |  | File name without extension; default the project's name |
| `format` | "mp4" \| "mov" \| "webm" \| "mkv" \| "gif" \| "mp3" \| "m4a" \| "wav" |  | Default mp4 (H.264 + AAC); mp3, m4a and wav are sound only |
| `resolution` | "480p" \| "720p" \| "1080p" \| "2k" \| "4k" |  | Short side; default from the project |
| `quality` | "lower" \| "recommended" \| "higher" |  | Default recommended |
| `loudness` | number |  | Integrated LUFS for the mix; default as mixed (-40..-5) |
| `start` | number |  | Export from this second (0..) |
| `end` | number |  | Export to this second (0..) |
| `captions` | "burn" \| "srt" \| "both" \| "none" |  | The captions: burn into the picture (default), srt file beside it, both, or none |
| `folder` | string |  | An absolute folder to write into instead of the Videos folder, created if missing (desktop only; the browser build refuses it rather than ignore it) |

Example:

```json
{"name":"export_video","arguments":{"name":"spring-sale-16x9","resolution":"1080p","quality":"higher","loudness":-14,"folder":"D:/Deliveries/Spring sale"}}
```

### export_versions

Export the deliverables of an ad in one call, each a separate file in the user's Videos folder (in a folder named after the app), or in folder (on the web, a save dialog per file), never replacing a file (a numbered name instead, with a note), the project left exactly as it is. A version is a ratio (16:9, 9:16, 1:1, 4:5, or original), optionally a duration in seconds (a cut-down: the opening and the end card are kept, the middle cut out, the music fading at the new end) and textless (titles and captions off: the master that other languages are cut from). Footage that fills the frame keeps filling it (fit fill), or fits over a blurred copy of itself (blur) or over the background (fit); where fill crops it (a 16:9 shot on 9:16 keeps a third of its width), the crop keeps what the editor chose: what the callouts over the shot point at (rings, a spotlight's hole, add_callout or anything pinned with an anchor), else the region the master frames (frame_region, a zoom past 1.1x: centered on it), else the shot's subject (what stands out in its pictures, looked at every half second), following it as it moves, inside what the master showed (a version wider than the master, 16:9 from 9:16, holds all of it, centered on it), keyed pushes and pans kept (pushes relax or hold eases them; reframe center keeps the old centered crop; focus [{clip_id, x, y}] puts a point of a clip's picture at the frame's center instead); rings and spotlights over footage (and anything pinned with an anchor) stay on what they point at, moved and sized with the picture under them, a spotlight's hole with them, and a ring around a title stays around it; titles, logos and badges keep their size against the frame's short side and are moved inside its title-safe area (on 9:16 clear of the apps' buttons and captions); a long title wraps to the new frame's safe width, or shrinks to it; an effect's pixel sizes (a blur's radius, a pixelate's blocks) and a position wiggle keep their size against the picture they are on. A compound clip that draws only part of the frame (a title card built as a compound: a box, a headline, a subhead) refits as one picture, its parts keeping their layout; when its smallest type would fall under the readable size the whole card grows to meet it, and a card that then does not fit is restacked, its rows in order with their spacing, type held at the readable size, a panel behind them keeping its margins, nothing overlapping. A shape that spans the frame (a gradient scrim, a band) keeps its share of the new frame, as footage does. On a tall version (9:16, 4:5) of a wide film, what stood side by side is stacked in the safe column: a picture (a floating window, a split screen's half, cut again wider) above the title or picture beside it, each as wide as the column, what sat on one (a label, a glow) moving with it; a split screen whose halves filled the frame edge to edge fills the new frame instead (stacked full width on a tall version, side by side full height on a square), its labels inside the safe area. Text never ends under the frame's readable size, and on 4:5 overlays keep clear of the apps' buttons as on 9:16; every title is kept inside the area check_project judges it by, measured as it measures it, with room for the outline it may suggest. overrides [{clip_id, x, y, scale, hidden}] place a clip by hand in a version after all that (a lower third raised, a headline larger, a logo hidden), kept in a saved version project. captions: burn (the default on tall versions, even from a hidden caption track: they sit in the column above the apps' captions, sized by the short side), none, or as_project (the default on the rest). A tall short's captions on a 16:9 or 1:1 version move to that frame's caption place (centered near the bottom, all at one height), and on 16:9 come down to a landscape caption's size (the typical caption at most size 72, 6.7% of the height; one made larger, a countdown, stays as much larger), never under the readable size; overlays keep above them, and a picture-in-picture that would cross them where the master kept it clear is moved above them (caption_overlaps says so in done), unless overrides place it. Ask with versions, or with ratios and durations (every ratio at every duration) plus textless for one textless master. check: true answers one contact sheet of every version (three moments each) and exports nothing: look at it first; an orange outline marks a subject a version's framing still cuts, and subjects lists each (with the focus that keeps it), and one the master's own push-in crops in a wider version (with pushes relax or hold, which show it); a title behind its subject (text_behind_subject) that the subject hides in a shape is outlined too and listed in titles, with the master's share to compare; a picture or graphic drawn across the burned captions in a shape (a picture-in-picture under them, measured by its mask) is outlined and listed in caption_overlaps, with the override that puts it above them; a ring, spotlight or pinned clip that runs off the frame or sits over other content than in the master is outlined and listed in callouts, with what keeps it (each exported version and saved project lists them too). save_projects: true saves each version as a project of its own instead (named as its file, sharing the media): open_project one to fine-tune it, then export_video. Exports that take over about four minutes answer state running: follow them with export_status. Example: {ratios: ['16:9', '9:16', '1:1'], durations: [15, 6], textless: true, loudness: -14}.

| Parameter | Type | Required | Meaning |
|---|---|---|---|
| `versions` | { ratio, duration, textless, fit, captions, name, reframe, focus, pushes, overrides }[] |  | Versions spelled out, e.g. [{ratio: '9:16', duration: 6}] |
| `versions[].ratio` | "16:9" \| "9:16" \| "1:1" \| "4:5" \| "original" | yes | Frame shape; original keeps the project's |
| `versions[].duration` | number |  | Seconds; shorter than the project makes a cut-down (1..) |
| `versions[].textless` | boolean |  | Titles and captions off |
| `versions[].fit` | "fill" \| "blur" \| "fit" |  | How full-frame footage meets a new shape: fill (default), blur, fit |
| `versions[].captions` | "burn" \| "none" \| "as_project" |  | burn the captions in (default on 9:16 and 4:5), none, or as_project (default on the rest) |
| `versions[].name` | string |  | File name without extension; default the project's name and the version, e.g. 'Roast 9x16 6s' |
| `versions[].reframe` | "subject" \| "center" |  | Footage the new shape crops: framed on its subject, following it (default), or center |
| `versions[].focus` | { clip_id, x, y }[] |  | Clips framed by hand: [{clip_id, x, y}], the point of the clip's picture (fractions from its top left, as preview_media shows it) to keep at the center of the frame; an axis left out stays on the subject. On the call, for every version that does not say |
| `versions[].focus[].clip_id` | string | yes | A full-frame video or picture clip |
| `versions[].focus[].x` | number |  | Across its picture, 0 left to 1 right (0..1) |
| `versions[].focus[].y` | number |  | Down its picture, 0 top to 1 bottom (0..1) |
| `versions[].pushes` | "keep" \| "relax" \| "hold" |  | Full-frame shots' keyed pushes (a zoom keyed by hand or by frame_region): keep (default), relax (half the zoom) or hold (the shot at its widest throughout). A tall master's push-in frames a narrow column; on a wider version the same zoom crops the picture's top and bottom (a rocket's nose), and relax or hold shows them, the frame still around what the master showed. On the call, for every version that does not say |
| `versions[].overrides` | { clip_id, x, y, scale, hidden }[] |  | Clips placed by hand in this version, after the automatic adaptation (raise a lower third, enlarge a headline, hide a logo): [{clip_id, x, y, scale, hidden}]. Any clip: a title, a picture, a compound clip, or a clip inside a compound by its own id. A clip in a group (an ad element) moves and resizes with its group; hidden is the clip alone. Kept in a saved version project. On the call, for every version that does not say |
| `versions[].overrides[].clip_id` | string | yes | The clip, as describe_project names it in the master |
| `versions[].overrides[].x` | number |  | Where it rests across the version's frame: its transform.x, a fraction of the frame from its center (-0.5 left edge .. 0.5 right edge); keyed motion moves with it (-1..1) |
| `versions[].overrides[].y` | number |  | Where it rests down the frame: its transform.y (-0.5 top .. 0.5 bottom; on a tall frame a title's box stays above y 0.15, where the apps' captions and buttons begin) (-1..1) |
| `versions[].overrides[].scale` | number |  | Times its size as the version adapted it (1.25 a quarter larger: a title's type, any other layer's scale), about its own center (0.1..10) |
| `versions[].overrides[].hidden` | boolean |  | true: off in this version; false: on, though the master hides it |
| `ratios` | "16:9" \| "9:16" \| "1:1" \| "4:5" \| "original"[] |  | Every one of these shapes... |
| `durations` | number[] |  | ...at every one of these lengths in seconds (one as long as the project is the full version); e.g. [30, 15, 6] |
| `textless` | boolean |  | Also a textless version, in the first ratio |
| `fit` | "fill" \| "blur" \| "fit" |  | For every version that does not say: fill (default), blur or fit |
| `captions` | "burn" \| "none" \| "as_project" |  | For every version that does not say: burn, none or as_project; default burn on tall versions, as_project on the rest |
| `reframe` | "subject" \| "center" |  | For every version that does not say: subject (default) or center |
| `focus` | { clip_id, x, y }[] |  | Clips framed by hand: [{clip_id, x, y}], the point of the clip's picture (fractions from its top left, as preview_media shows it) to keep at the center of the frame; an axis left out stays on the subject. On the call, for every version that does not say |
| `focus[].clip_id` | string | yes | A full-frame video or picture clip |
| `focus[].x` | number |  | Across its picture, 0 left to 1 right (0..1) |
| `focus[].y` | number |  | Down its picture, 0 top to 1 bottom (0..1) |
| `pushes` | "keep" \| "relax" \| "hold" |  | Full-frame shots' keyed pushes (a zoom keyed by hand or by frame_region): keep (default), relax (half the zoom) or hold (the shot at its widest throughout). A tall master's push-in frames a narrow column; on a wider version the same zoom crops the picture's top and bottom (a rocket's nose), and relax or hold shows them, the frame still around what the master showed. On the call, for every version that does not say |
| `overrides` | { clip_id, x, y, scale, hidden }[] |  | Clips placed by hand in this version, after the automatic adaptation (raise a lower third, enlarge a headline, hide a logo): [{clip_id, x, y, scale, hidden}]. Any clip: a title, a picture, a compound clip, or a clip inside a compound by its own id. A clip in a group (an ad element) moves and resizes with its group; hidden is the clip alone. Kept in a saved version project. On the call, for every version that does not say |
| `overrides[].clip_id` | string | yes | The clip, as describe_project names it in the master |
| `overrides[].x` | number |  | Where it rests across the version's frame: its transform.x, a fraction of the frame from its center (-0.5 left edge .. 0.5 right edge); keyed motion moves with it (-1..1) |
| `overrides[].y` | number |  | Where it rests down the frame: its transform.y (-0.5 top .. 0.5 bottom; on a tall frame a title's box stays above y 0.15, where the apps' captions and buttons begin) (-1..1) |
| `overrides[].scale` | number |  | Times its size as the version adapted it (1.25 a quarter larger: a title's type, any other layer's scale), about its own center (0.1..10) |
| `overrides[].hidden` | boolean |  | true: off in this version; false: on, though the master hides it |
| `save_projects` | boolean |  | true: save each version as a project of its own to fine-tune (open_project it, edit, export_video), and export nothing |
| `keep_end` | number |  | Seconds of the end every cut-down keeps; default the end card's length (add_ad_element end_card), else 0 (0..) |
| `check` | boolean |  | true: answer a contact sheet of every version and export nothing |
| `check_at` | number[] |  | The moments the check sheet shows, as fractions of each version's length, up to 8; default [0.15, 0.5, 0.92]. A version's moments wrap into rows at 1600 px |
| `tile_width` | integer |  | Width of each frame on the check sheet, its height following the version's shape; default frames 220 px tall (a 16:9 frame 391 px wide) (120..800) |
| `format` | "mp4" \| "mov" \| "webm" \| "mkv" |  | Default mp4 (H.264 + AAC) |
| `resolution` | "480p" \| "720p" \| "1080p" \| "2k" \| "4k" |  | Short side; default from the project |
| `quality` | "lower" \| "recommended" \| "higher" |  | Default recommended |
| `loudness` | number |  | Integrated LUFS for every version's mix, e.g. -14; default as mixed (-40..-5) |
| `folder` | string |  | An absolute folder to write into instead of the Videos folder, created if missing (desktop only; the browser build refuses it rather than ignore it) |

Example:

```json
{"name":"export_versions","arguments":{"ratios":["16:9","9:16","1:1"],"durations":[15,6],"textless":true,"loudness":-14,"check":true}}
```

### export_status

The last export_video: running (fraction done, eta seconds), done (path, bytes, seconds) or failed (message).

No parameters.
