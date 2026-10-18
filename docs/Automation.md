# Automation

How other programs and AI agents make and edit videos with the app — all
on the user's machine. Three doors, one engine.

## 1. Render a project file (pipelines)

Write a project as JSON ([[Project format]]; the smallest valid file is a
handful of lines, everything else defaults) and render it:

```
openframe --render project.json --out video.mp4
openframe --render project.json --out video.webm --resolution 720p --quality higher
```

Relative media paths resolve against the project file's folder. Progress
arrives on stdout as JSON lines:

```
{"event":"start","frames":180,"width":1280,"height":720,"codec":"avc","out":"..."}
{"event":"progress","fraction":0.856,"fps":288,"eta":0.1}
{"event":"done","out":"...","frames":180,"seconds":6,"bytes":434781,...}
```

Exit code 0 means the file is complete; 1 a failed render (the `error`
line says why); 2 bad arguments. Try it with `scripts/render-example/`.
([[ADR-029 Headless rendering reuses the app]])

## 2. Drive the running editor (agents, MCP)

Turn on **AI assistant → Connect other AI agents → Allow AI agents**. Then:

- **HTTP** (Streamable HTTP): `http://127.0.0.1:47280/mcp` with
  `Authorization: Bearer <token>` (the panel shows and copies it). For
  Claude Code: the panel's ready-made `claude mcp add` line.
- **stdio**: run `openframe --mcp-stdio` as the server command (the exe was
  `video-editor` before 2026-10-17; the panel always shows the current path).

Tools: every editing command (`add_media_clip`, `add_text`, `split`,
`trim_clip`, `set_transition`, `add_captions`, `cut_ranges`, ...) with JSON
Schemas, plus `describe_project`, `list_catalog`, `import_media`, `undo`,
`redo`, `seek` and `preview_frame` (returns the composited frame as a
PNG, so an agent can look at its work), the project tools
`list_projects`, `open_project` (by id or name; it saves the open project
first) and `new_project` (a scratch project, so an agent's experiments
leave the user's projects alone), `preview_frames` (one contact sheet of
up to 24 moments, each stamped with its time), `export_video`,
`export_versions` (every shape and cut-down of an ad, one file each) and
`export_status`, and the local AI tools:
`remove_silences`, `split_scenes`, `mark_beats`, `normalize_loudness`,
`duck_under_speech`, `reduce_noise`, `stabilize_clip`, `sync_audio`
(line a separately recorded sound up with its video by waveform; the
`sync_to_clip` command places one by a known offset),
`track_motion` (pin a layer to a subject in the video under it),
`auto_reframe` (into another canvas shape, following the subject),
`add_sound_effect` (a built-in whoosh, pop, ding... at a time),
`set_caption_look` (one of six caption looks for every caption),
`text_behind_subject` (titles behind a video's subject) and
`remove_background` ([[AI tools]]); the `set_background_removal` command
turns an existing matte off and on. Every agent edit is undoable and
visible as it happens. ([[ADR-008 MCP is a handler over the command registry]],
[[ADR-009 Agents reach the app over local MCP, opt-in]])

Edits answer with what they changed, not the whole timeline:
`{"duration": 6, "added_clips": [...], "changed_clips": [...],
"removed_clips": ["c_..."]}` (and `*_tracks`, `added_assets`, any other
part that differs), each clip as `describe_project` shows it plus its
`track`; `{"unchanged": true}` when nothing did. `undo` and `redo` answer
the same way. `describe_project` is still the whole picture.

`batch` runs `{"commands": [{"command": "set_animation", "args": {...}},
...]}` in order as one edit and one undo step, all or nothing: a failing
step names its number (`step 2 (set_animation): no clip with id nope`).

`set_compressor` evens out a video's or audio clip's sound: `{"clip_ids":
[...], "preset": "voice"}` (voice, gentle, strong or off), with threshold,
ratio, knee, attack, release and makeup to adjust it; `describe_project`
names the preset or `custom`. `normalize_loudness` measures through it.

`add_voiceover` narrates a script: `{"lines": [{"text": "Meet
RacePulse."}, {"text": "Pick your widgets.", "at": 6}], "voice":
"af_heart", "gap": 0.4, "caption_style": {...}}`. Each line is spoken on
this machine and placed after the one before at its real length (or at
its `at`, never overlapping) on a new Voiceover track, with a caption per
line, as one undo step. It answers `{"lines": [{"text", "start", "end",
"voice_clip", "caption_clip"}], "end"}`: cut the footage to those times.
The voices get the Enhance voice compressor unless `enhance` is false.

`frame_region` shows part of a picture full screen: `region` is a
rectangle in fractions of the source (`{"x": 0.5, "y": 0, "w": 0.5,
"h": 1}` is the right half), `fill` (default) covers the canvas, `fit`
shows the whole region; the picture slides back where it would uncover
empty canvas. `to_region` (with optional `from`/`to` seconds) eases from
one to the other: the push-in on a screen recording.

Text styles take `background` (`{"color": "rgba(0,0,0,0.6)", "padding":
16, "radius": 8}`), `stroke` and `shadow`, so a title reads over busy
footage; an empty color removes one. Ad looks: `glow` (`{"color":
"#00e5ff", "blur": 24, "strength": 2}`), `gradient` (`{"from": "#ffffff",
"to": "#ff3d7f", "angle": 0}`), `stroke2` (a second outline) and `accent`
(the kinetic sweeps' color).

Ads ([[Features]] > Ads and deliverables): `set_brand` keeps the brand kit
in the project (`describe_project` shows it as `brand`), `add_text`
takes a `role` from it, `apply_brand` restyles titles and solids,
`add_ad_element` adds an `end_card`, `lower_third`, `offer_badge`,
`cta_button` or `logo_reveal` in one call (`{"element": "end_card",
"start": 12, "headline": "Fresh roast, every morning", "cta": "Order
now"}`), and the app tool `text_behind_subject` (`clip_id`,
`text_clip_ids`) puts titles behind a video's person or product.
`set_audio_fade` fades music in seconds (`{"clip_ids": ["c_..."],
"fade_in": 0.5, "fade_out": 1.5}`); the clip stores frames.
`export_versions` renders the deliverables in one call: `{"ratios":
["16:9", "9:16", "1:1"], "durations": [15, 6], "textless": true,
"loudness": -14}` (or `versions` spelled out, each `ratio`, `duration`,
`textless`, `fit`, `name`), one file each, the project untouched; with
`"check": true` it answers a contact sheet of every version instead.
Cut-downs keep the end card (`keep_end` seconds, default the end card's
length). Long runs answer `running`; `export_status` follows them and
lists the `versions` when done.
`describe_project` now names a clip's `name` and `group`, so an
element's parts are easy to find.

`set_animation` plays kinetic typography on titles: the presets
`typewriter`, `letterRise`, `letterFade`, `wordPop`, `wordRise`,
`wordSlide`, `lineRise`, `highlightSweep` and `underlineWipe`, or any
animation with `unit` (`letter`, `word`, `line`), `stagger` (0..1) and
`order` (`forward`, `backward`, `center`, `random`): `{"clip_id": "c_...",
"slot": "in", "type": "rise", "unit": "word", "stagger": 0.6, "duration":
0.8}`. `duration` covers every unit.

`export_video` (`name`, `format`, `resolution`, `quality`, `loudness`,
`start`, `end`) writes to `<Videos>\OpenFrame\` with no dialog and never
replaces a file, answering with the path, size and a note (what the
loudness pass did). Past about four minutes it answers `running`; follow
it with `export_status`. ([[ADR-052 Agents read what changed and export without a dialog]])

## 3. Ask in plain words (AI assistant)

The AI assistant panel runs a model on this computer (Ollama or LM Studio,
found automatically) over the same tools. With qwen3.5:9b, "add a title
Welcome from 1 to 4 seconds" takes about 10 s; "split at 5 s and put a
dissolve between the parts" about 2 s. Each answer can be undone as a whole.

## In the page

`update_marker` takes `marker_id` plus optional `at` (timeline seconds),
`label`, and `color`. `delete_markers` takes `marker_ids`; unknown IDs reject
the entire command. Both are undoable and leave clip positions unchanged.
Marker descriptions now include `id`, integer `frame`, and `color` alongside
the existing `at` and `label`, so agents can target the note they described.

`edit_effects` manages one clip's stack: `move_up`, `move_down`, `reset`,
`remove`, `clear`, `enable`, `disable`. Supply `effect_id` for individual
effects; enable/disable without it targets the whole stack. `describe_project`
retains the existing effect-type list and adds `effectStack` entries with
`id`, `type`, `enabled`. Reset/remove/clear clean only the affected effect
keys. Stack edits reject locked tracks; `add_effect` now fills catalog
defaults before applying parameter overrides.

`copy_effects` takes `source_clip_id` and target `clip_ids`, appending an
independent copy of the effect stack and its keyframes in one undoable
command. Existing target settings are preserved. Every target must be a
visual/adjustment clip on an unlocked track; invalid targets reject the
command before any change. The UI's multi-selection filters ineligible clips
and shows the receiving count before calling the same pure paste operation.

Compound clips ([[ADR-037 Compound clips are nested timelines composited to a texture]]):
`create_compound_clip` takes `clip_ids` (any tracks, at least one on a video
track) and an optional `name`; `break_compound_clip` takes the compound
clip's `clip_id` (at speed 1). `describe_project` lists nested timelines
under `compounds` (`id`, `name`, `duration`, `tracks` in the same shape as
the project's, times their own), and a compound clip names its `compound`.
`edit_compound` runs any other command inside one: `compound_id`,
`command`, `args`, with the nested timeline's ids and times;
`rename_compound` takes `compound_id` and `name`. Agents always see and
edit the whole project, even while the user has a compound clip open
(`describe_project` then adds `open_compounds`, outermost first).

`window.openFrame` (`src/automation.ts`; `window.videoEditor` is the same
object under its pre-rename name) is the same surface for scripts
in the web build or over the WebView2 debug port: `exec(name, args)`,
`describe()`, `import(...)`, `render(options)`, `still(frame)`, `pixels()`,
`mcp(message)`, and the AI tools (`ai.removeSilences`, ...,
`ai.removeBackground`). See
[[Driving the app]].
