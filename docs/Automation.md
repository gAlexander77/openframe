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

**Start with [[MCP tools]]**: every tool, generated from the code, grouped
in the order a video gets made, with each parameter (nested fields
included) and an example call. [[Agent playbook]] is how a model should
make an ad, an epic edit or a short. A connected model gets the same
guidance from the `help` tool (topics `overview`, `ad`, `epic_edit`,
`social_short`, `design`, `params`, or a tool's name), from the MCP prompts
`make_ad`, `epic_edit` and `social_short`, and from the resources
`guide://...` and `catalog://all`. Tools carry MCP titles and behavior
hints (read-only, destructive, open-world), so clients can run reads
without asking ([[ADR-055 The MCP guide is generated from the tools]]).

Tools: every editing command (`add_media_clip`, `add_text`, `split`,
`trim_clip`, `set_transition`, `add_captions`, `cut_ranges`, ...) with JSON
Schemas, plus `describe_project`, `list_catalog`, `import_media`, `undo`,
`redo`, `seek` and `preview_frame` (returns the composited frame as a
PNG, drawn as the export draws it and `max_width` pixels wide, at most
the canvas's width, so an agent can look at its work; it once read the
viewer's canvas, which is only as big as it is on screen, and a 9:16
project came back 222 pixels wide whatever was asked), the project tools
`list_projects`, `open_project` (by id or name; it saves the open project
first) and `new_project` (a scratch project, so an agent's experiments
leave the user's projects alone), both answering a summary (name, canvas,
fps, duration, counts) rather than the whole timeline (about 20 KB on the
launch film), `preview_frames` (one contact sheet of
up to 24 moments, each stamped with its time), `export_video`,
`export_versions` (every shape and cut-down of an ad, one file each) and
`export_status`, and the local AI tools:
`remove_silences`, `split_scenes`, `mark_beats`, `normalize_loudness`,
`duck_under_speech`, `reduce_noise`, `stabilize_clip`, `sync_audio`
(line a separately recorded sound up with its video by waveform; the
`sync_to_clip` command places one by a known offset),
`track_motion` (pin a layer to a subject in the video under it),
`auto_reframe` (into another canvas shape, following the subject),
`add_sound_effect` (a built-in whoosh, pop, ding... at a time; `sounds`
places a list, `[{name, start | end_at, volume}]`, in one call and one
undo step, since it cannot go in `batch`),
`set_caption_look` (one of six caption looks for every caption),
`slip_clip` (a later or earlier part of a shot's source, same place and
length), `move_track` (up or down the stack, so a grade sits under the
titles), `save_project_copy` (a variant to work by hand, the original
kept), effect parameters by place, id or type in `set_param` and the
keyframe tools (`effects.0.amount`, `effects.glow.threshold`), `batch` steps that name clips earlier steps added (`"$1"`,
`"$2.2"`), `check_project` (the design rules measured on the edit: title safe, the
vertical apps' buttons, text size and reading time, the WCAG contrast of
each title with the rendered picture behind it, caption speed, fonts,
flashes over 3 a second, black gaps, music that stops dead (its last
second decoded, so a track that fades out in its own audio passes), an
ad's end card, an epic edit's cuts on the beat; shots counted on the
busiest picture track; each finding names the fixing tool, [[ADR-068 check_project measures the picture and the sound it judges]]),
`preview_motion` (consecutive frames of a stretch, with the cuts and beats
in it, tiles up to 640 wide as `preview_frames`'), `preview_media` (an imported video's own frames, to choose
moments), `set_blend`, `set_chroma_key`, `set_canvas_fill`, `set_fades` (sound fades
in seconds) and `duplicate_clips` (what the inspector could do and agents
could not), `text_behind_subject` (titles behind a video's subject) and
`remove_background` ([[AI tools]]); the `set_background_removal` command
turns an existing matte off and on. Every agent edit is undoable and
visible as it happens. ([[ADR-008 MCP is a handler over the command registry]],
[[ADR-009 Agents reach the app over local MCP, opt-in]])

Edits answer with what they changed, not the whole timeline:
`{"duration": 6, "added_clips": [...], "changed_clips": [...],
"removed_clips": ["c_..."]}` (and `*_tracks`, `added_assets`, any other
part that differs), each clip as `describe_project` shows it plus its
`track`; `{"unchanged": true}` when nothing did. Compounds are answered
only when they changed, summed up (`added_compounds`, `changed_compounds`:
`{id, name, duration, clips}`, plus the clips changed inside, as an
`edit_compound` changes them; `removed_compounds`), never with their whole
nested timelines (3 KB an edit on the launch film's six windows). `undo`
and `redo` answer the same way. `describe_project` is still the whole
picture, keyframes included: each keyed path's keys as `[at, value]` or
`[at, value, ease]` in timeline seconds (`"transform.x": [[3, 0.75,
"fastIn"], [3.5, 0.16]]`; a path with more than 24 keys as `{count,
first, last, range}`), so an edit to a key shows in its answer.

Keyframes go only where something moves ([[ADR-066 Keyframes are refused where nothing moves and shown in answers]]):
`add_keyframe` refuses a path the renderer or the mixer does not read on
that clip, and the error lists the ones it does (`help` topic `params`
has them all; `src/lib/animatable.ts` is the one table). `set_param` with
`at` refuses to add a key to dead keys. `add_keyframe`,
`set_keyframe_ease` and `set_audio_filter`'s sweep share one ease
vocabulary, the easing menu's twelve presets, and the keyframe tools take
a `bezier` `[x1, y1, x2, y2]` too: `fastIn` is the modern expo-out, so a
window sliding in is `{"path": "transform.x", "at": 3, "value": 0.75,
"ease": "fastIn"}` then the landing key. Text styles take `lineHeight`.

`batch` runs `{"commands": [{"command": "set_animation", "args": {...}},
...]}` in order as one edit and one undo step, all or nothing: a failing
step names its number (`step 2 (set_animation): no clip with id nope`).

`set_compressor` evens out a video's or audio clip's sound: `{"clip_ids":
[...], "preset": "voice"}` (voice, gentle, strong or off), with threshold,
ratio, knee, attack, release and makeup to adjust it; `describe_project`
names the preset or `custom`. `normalize_loudness` measures through it.

Sound design ([[ADR-060 Sound design rings past the clip and is measured as exported]]),
on video and audio clips:

- `set_audio_filter` `{"clip_ids", "type": "lowpass"|"highpass", "cutoff"
  (Hz), "resonance" (dB), "sweep": {"to" (Hz), "start", "end" (timeline
  s), "ease"}, "off"}`: 24 dB per octave; `sweep` keys the cutoff, on a
  log scale ("muffled build, open on the drop": `cutoff` 400, `sweep`
  `{"to": 20000, "start": 4.5, "end": 5}`).
- `set_reverb` `{"clip_ids", "preset": "room"|"hall"|"cathedral", "size"
  (0..1), "decay" (s, RT60), "mix" (0..1), "off"}`.
- `set_echo` `{"clip_ids", "time" (s), "feedback" (0..0.9), "mix", "off"}`.
- `set_tape_stop` `{"clip_ids", "duration" (s), "off"}`: the sound slows
  to a stop, pitch diving, over the clip's last seconds.
- `add_keyframe` animates `lowpass.cutoff`, `highpass.cutoff`,
  `reverb.mix` and `echo.mix`; `describe_project` lists the effects on
  (`lowpass`, `highpass`, `reverb`, `echo`, `tape_stop`).

Delivery ([[ADR-061 Delivery holds the true peak and says whether it passes]]):

- `measure_loudness` `{"spec": "online"|"ebu_r128"|"atsc_a85", "loudness",
  "start", "end"}` renders the mix as export does and answers
  `integrated_lufs`, `loudness_range_lu`, `short_term_max_lufs`,
  `momentary_max_lufs`, `true_peak_dbtp`, `sample_peak_dbfs`, `pass` and
  `problems` (every spec when none is named; `clips` when the mix passes
  full scale; a `fix` when it fails). With `loudness` it measures what
  `export_video` at that target delivers.
- `normalize_loudness` takes `spec` for a spec's target and true-peak
  ceiling; `export_video`'s `loudness` holds the true peak under -1 dBTP
  (-2 at ATSC's -24) and answers the `loudness` it reached.

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

Epic edits ([[Features]], Epic edits), music-synced montages in a few calls:

- `analyze_music` `{clip_id, markers?}`: tempo, beats, downbeats, phrases,
  sections (intro, verse, build, drop, breakdown, outro, with energy),
  per-beat energy, hits and the drop, in timeline seconds; `markers`
  (`beats`, `bars`, `phrases`, `sections`, `drop`) also drops markers.
- `cut_to_beats` `{media: [{asset_id, in?, beats?}], grid?, beats?,
  every?, pattern?, start?, end?}`: shots end to end on the main track,
  every cut on a beat, bar or phrase.
- `add_beat_hits` `{effect | effects, times? | at_cuts? | marker_label?,
  every?, from?, to?, duration?, intensity?}`: flash, zoom, shake,
  rgbSplit, glow or zoomBlur hits on a Hits track; at most three flashes
  a second.
- `add_cinematic_bars` `{ratio?, start?, end?, animate_in?, animate_out?}`:
  letterbox bars (2.39 by default) under the titles.
- `set_speed_ramp` `{clip_id, at?, moment?, speed?, base?, hold?, ease?,
  preset?}`: the slow (or fast) moment of a ramp on a beat; the clip keeps
  its place and length.
- `fit_music` `{clip_id, drop_at?, drop?, end?, end_at?, fade_out?,
  fade_in?, trim_picture?}`: the drop where it belongs, the end with the
  picture or on a bar, faded.
- `add_sound_effect` takes `end_at` (the sound ends there: a riser peaks
  on the drop) and offers impact, subDrop, braam, reverseCymbal, glitch,
  shutter and swooshUp; `set_transition` takes whipLeft, whipRight,
  zoomPunch and spinBlur.

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
`set_fades` fades music in seconds (`{"clip_ids": ["c_..."],
"fade_in": 0.5, "fade_out": 1.5}`); the clip stores frames.
`export_versions` renders the deliverables in one call: `{"ratios":
["16:9", "9:16", "1:1"], "durations": [15, 6], "textless": true,
"loudness": -14}` (or `versions` spelled out, each `ratio`, `duration`,
`textless`, `fit`, `name`), one file each, the project untouched; with
`"check": true` it answers a contact sheet of every version instead.
Cut-downs keep the end card (`keep_end` seconds, default the end card's
length). In another shape an ad element, or any group, moves and scales
as one unit: its parts keep their layout, it stays against the edges it
was against (or centered), and it shrinks to fit the safe area when it
must ([[ADR-063 Versions fit a group as one unit]]). Hand-animated
layouts adapt too ([[ADR-067 Versions lay keyframed motion out again around its rest]]):
each layer is placed where it rests (a slide-in where it lands), its keyed
motion laid out again around that (a slide from off the edge still starts
off the edge); a compound clip moved or scaled as a picture (a floating
window) is refit as one picture and placed like a logo, shrunk into the
safe area when the frame would cut it; a word too wide to wrap shrinks to
the safe width. `check_at` (fractions of each version's length) picks the
moments the check sheet shows. Long runs answer
`running`; `export_status` follows them and lists the `versions` when
done.
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

Graphics and compositing, for ads and title sequences
([[ADR-056 Track mattes cut a layer with another clip]] to
[[ADR-062 Overshoot eases are named and wiggle is seeded noise]]):

- `add_shape` `{kind: rectangle | rounded_rectangle | ellipse | line, start, duration, x, y, width, height, color, gradient: {from, to, angle}, fill, stroke_color, stroke_width, radius, draw, rotation, opacity, track_id}`: a shape layer, above everything at that time; sizes are canvas fractions, stroke pixels at 1080p.
- `set_shape` `{clip_ids, kind, width, height, color, gradient, fill, stroke_color, stroke_width, radius, draw, at}`: change shapes; animated numbers get a key at `at` (paths `shape.width`, `shape.height`, `shape.radius`, `shape.stroke.width`, `shape.draw`, `shape.gradient.angle`).
- `set_track_matte` `{clip_id, matte_clip_id: <clip id> | "above" | "none", mode: alpha | alphaInverted | luma | lumaInverted}`: the clip shows only where the matte clip's picture is (video inside text, wipe reveals); the matte is not drawn.
- `set_motion_blur` `{clip_ids, on, shutter_angle}`: moving clips (and slides, pushes, zooms, spins) blur over the shutter, 180 degrees by default.
- `set_edge_mode` `{clip_ids, edge: none | mirror | repeat}`: copies of the picture fill the canvas around it when it moves, shrinks or shakes.
- `set_wiggle` `{clip_ids, target: position | x | y | rotation | scale, frequency, amplitude, strength, seed, at}`: seeded shake or drift (pixels, degrees, percent); `strength` with `at` keys a ramp; amplitude 0 removes it.
- `add_keyframe` and `set_keyframe_ease` take `spring`, `elastic` and `bounce`, which overshoot and settle, among the twelve presets they share.

`describe_project` shows a color clip's `color`, a shape's `shape`, and
`track_matte`, `motion_blur`, `edge` and `wiggle` where set.

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
`rename_compound` takes `compound_id` and `name`. A compound is one
shared timeline, so `duplicate_clips` of a compound clip plays the same
one, unless `unique: true`: then the copy gets its own timeline under
fresh ids (answered under `added_compounds`). That makes a styled precomp
a template, as the launch film's floating windows wanted: build one window
(footage, mask, border, shadow) and `create_compound_clip` it, then for
each use `duplicate_clips` it with `unique: true` and `edit_compound`
`replace_clip` its footage, keyframing each copy's own slide. Agents always see and
edit the whole project, even while the user has a compound clip open
(`describe_project` then adds `open_compounds`, outermost first).

`window.openFrame` (`src/automation.ts`; `window.videoEditor` is the same
object under its pre-rename name) is the same surface for scripts
in the web build or over the WebView2 debug port: `exec(name, args)`,
`describe()`, `import(...)`, `render(options)`, `still(frame)`, `pixels()`,
`mcp(message)`, and the AI tools (`ai.removeSilences`, ...,
`ai.removeBackground`). See
[[Driving the app]].
