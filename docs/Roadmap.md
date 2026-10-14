# Roadmap

In rough priority order. The research notes' P0/P1 lists are the source;
items move to [[Features]] when they ship.

## In flight (parallel worktrees)

- **Desktop platform** — the `media:` range protocol, project files in app
  data, positional export writes, OS drag-drop paths, FFmpeg proxies for
  codecs the webview cannot decode (ProRes, DNxHR, MPEG-2...).
- **Export** — deterministic, frame-exact export to MP4/MOV/WebM/MKV with
  CapCut's export dialog; audio-only and still-frame export; a `render()`
  hook for the headless CLI.
- **Local AI tools** — remove silences, split scenes, beat markers, as
  commands and library cards.

## Next

- **MCP server** on the desktop: the command registry as MCP tools over a
  local Streamable HTTP server plus a stdio bridge
  ([[AI and automation]], ADR-006).
- **Headless render CLI**: `video-editor render project.json -o out.mp4`.
- **Pro trim tools in the UI**: ripple/roll/slip/slide modes with a
  two-up trim monitor (the ops already exist and are tested).
- **LUTs** (.cube import), **scopes** (waveform, vectorscope, histogram),
  HSL and curves.
- **Keyframe graph editor** with easing curves.
- **Speed curves** and reverse.
- **Background canvas** (blur/color fill for letterboxed clips — CapCut's
  "Canvas").
- **Stickers and emoji**, text templates.
- **Inline text editing** on the canvas.
- **Proxies on the web** via mediabunny `Conversion` (short-GOP 720p).

## Later

- Auto reframe (face tracking), background removal, speech cleanup
  (DeepFilterNet), loudness normalization (EBU R128), offline TTS.
- Opt-in generative providers (Seedance, Veo, Runway...) behind one
  plugin contract; never required.
- Multicam, compound clips/nesting, OTIO and FCP7 XML interchange.
- HDR via WebGPU.
