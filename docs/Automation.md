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
`remove_silences`, `split_scenes`, `mark_beats`, `normalize_loudness` and
`duck_under_speech` ([[AI tools]]). Every agent edit is undoable and
visible as it happens. ([[ADR-008 MCP is a handler over the command registry]],
[[ADR-009 Agents reach the app over local MCP, opt-in]])

## 3. Ask in plain words (Copilot)

The Copilot panel runs a model on this computer (Ollama or LM Studio,
found automatically) over the same tools. With qwen3.5:9b, "add a title
Welcome from 1 to 4 seconds" takes about 10 s; "split at 5 s and put a
dissolve between the parts" about 2 s. Each answer can be undone as a whole.

## In the page

`window.videoEditor` (`src/automation.ts`) is the same surface for scripts
in the web build or over the WebView2 debug port: `exec(name, args)`,
`describe()`, `import(...)`, `render(options)`, `still(frame)`, `pixels()`,
`mcp(message)`, and the AI tools (`ai.removeSilences`, ...). See
[[Driving the app]].
