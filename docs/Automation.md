# Automation

How other programs and AI agents make and edit videos with the app — all
on the user's machine. Three doors, one engine.

## 1. Render a project file (pipelines)

Write a project as JSON ([[Project format]]; the smallest valid file is a
handful of lines, everything else defaults) and render it:

```
video-editor --render project.json --out video.mp4
video-editor --render project.json --out video.webm --resolution 720p --quality higher
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

Turn on **Copilot → Connect other AI agents → Allow AI agents**. Then:

- **HTTP** (Streamable HTTP): `http://127.0.0.1:47280/mcp` with
  `Authorization: Bearer <token>` (the panel shows and copies it). For
  Claude Code: the panel's ready-made `claude mcp add` line.
- **stdio**: run `video-editor --mcp-stdio` as the server command.

Tools: every editing command (`add_media_clip`, `add_text`, `split`,
`trim_clip`, `set_transition`, `add_captions`, `cut_ranges`, ...) with JSON
Schemas, plus `describe_project`, `list_catalog`, `import_media`, `undo`,
`redo`, `seek` and `preview_frame` (returns the composited frame as a
PNG, so an agent can look at its work), and the local AI tools:
`remove_silences`, `split_scenes`, `mark_beats`, `normalize_loudness`,
`duck_under_speech`, `reduce_noise`, `stabilize_clip` and
`remove_background` ([[AI tools]]); the `set_background_removal` command
turns an existing matte off and on. Every agent edit is undoable and
visible as it happens. ([[ADR-008 MCP is a handler over the command registry]],
[[ADR-009 Agents reach the app over local MCP, opt-in]])

## 3. Ask in plain words (Copilot)

The Copilot panel runs a model on this computer (Ollama or LM Studio,
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

`window.videoEditor` (`src/automation.ts`) is the same surface for scripts
in the web build or over the WebView2 debug port: `exec(name, args)`,
`describe()`, `import(...)`, `render(options)`, `still(frame)`, `pixels()`,
`mcp(message)`, and the AI tools (`ai.removeSilences`, ...,
`ai.removeBackground`). See
[[Driving the app]].
