# OpenFrame — Documentation

Obsidian-style vault. Open the `docs/` folder as a vault (or just read the
markdown); `[[wikilinks]]` connect the notes. Written for users learning the
editor, contributors changing it, and coding agents that need the reasoning
and evidence from earlier sessions. [[AI development]] explains the purpose
of the documentation and how agents use it as shared working memory.

## Ground rules

- The chosen name is **OpenFrame**; the implementation rename is pending.
  [[Renaming]] lists the identity sites and data/automation compatibility work.
- **Desktop first**, browser support second (ADR-003). The 2026-10-14 owner
  handoff reaffirmed this; web capability checks remain separately documented.
- GPL-3.0-only applies to original project code and documentation. The repo
  remains private pending owner instruction; see [[Release preparation]].
- The owner reads history to learn *why*: commits are small, one intention
  each, and docs land in the same commit as the code ([[Conventions]]).
- What we learn about the products we imitate (CapCut, VEGAS, Premiere,
  Resolve) and the platforms we run on (WebCodecs, WebView2, Tauri) is
  written down in `research/` so nobody pays for a lesson twice.

## Map of content

- [[Development pass 2026-10-16]] — approved workflow additions, decisions and verification
- [[User guide]] — setup, a first editing session, storage and platform limits
- [[AI development]] — the Claude Code/Codex experiment, documentation purpose,
  evidence and continuity across agent sessions
- [[Next agent handoff]] — current owner direction and safe pickup order
- [[Web capability log]] — dated browser checks and limits, separately from desktop
- [[Release preparation]] — GPL license, dependency inventory and remaining
  tasks before a separately authorized public release
- [[Third-party licenses]] — production npm and Cargo license declarations to review
- [Contributing](../CONTRIBUTING.md) — how users, developers and AI agents can help
- [[Features]] — everything the app does today, with the intent behind each
- [[Roadmap]] — what is in flight and next, in priority order
- [[Project format]] — the open JSON schema agents and pipelines write
- [[Automation]] — headless render, MCP for agents, AI assistant: the three doors
- [[UX audit 2026-10-14]] — 38 ranked findings from a first-time CapCut
  user's walk, what was fixed, and what to keep
- [[UI polish 2026-10-16]] — styling audit at three window sizes and the
  splitter extremes: what clipped or overflowed, why, and rules of thumb
- [[AI tools]] — the local tools' algorithms, defaults, credits and measurements
- [[Driving the app]] — the web build through Playwright, the desktop app over
  WebView2's debug port; native dialogs, OS drops, the drive scripts
- [[Architecture]] — layers, how an edit becomes pixels, the module table
- [[Conventions]] — where code goes, rules of thumb, commits, testing
- [[History]] — the build story, round by round, including rejected attempts
- [[Renaming]] — every site the placeholder name touches, and the one that
  moves user data

## Research

- [[Media organization]] — source metadata, filtering, sorting and timeline usage
- [[Navigation and composition]] — viewer guides, marker management and
  priorities from the next editor comparison
- [[Effect workflow]] — applied-effect discoverability and stack-editing review

- [[CapCut desktop]] — the UX baseline: layout, every panel, shortcuts,
  export, what users complain about
- [[Feature gaps 2026-10-16]] — what CapCut, Premiere, Resolve, VEGAS and
  Final Cut have that we lack, with a build order
- [[Everyday gaps 2026-10-17]] — the small, frequent gaps the survey
  missed, a UI code audit and a styling sweep, with what was done
- [[Pro workflows 2026-10-18]] — how agencies make ads and editors make
  epic edits, the rules of thumb (with sources) the agent guide teaches,
  and the gaps each toolkit took
- [[Professional NLE features]] — VEGAS, Premiere and Resolve depth: trim
  modes, J/K/L, keyframes, color, audio, formats, interchange
- [[Web media engine]] — mediabunny, WebCodecs, WebGL2, Web Audio,
  ffmpeg.wasm and on-device AI in the browser, with pitfalls
- [[Tauri desktop media]] — serving media to the webview, the frame pipe to
  ffmpeg, ffmpeg packaging and licensing, WebView2 specifics
- [[AI and automation]] — AI features across editors, what runs locally, and
  the pipeline/agent API design

## Decisions (ADRs)

Every non-obvious choice gets a short Architecture Decision Record in
`decisions/`. Oldest first:

- [[ADR-001 Tauri v2 and React, the TermHQ stack]]
- [[ADR-002 The media engine lives in the webview]] — frames never cross IPC;
  Rust supplies bytes, proxies and masters
- [[ADR-003 Desktop first, one build, a platform seam]] — all compute on the
  user's machine; web is a client-only subset
- [[ADR-004 Timeline time is integer frames]] — rational fps, SMPTE timecode
- [[ADR-005 One store, snapshot undo]] — useSyncExternalStore, drags as one
  undo step
- [[ADR-006 Every edit is a named command with a JSON Schema]] — the agent
  and MCP surface
- [[ADR-007 Auto captions run Whisper on the user's machine]] — no upload,
  no limit; the timeline mix at 16 kHz, cut at quiet points
- [[ADR-008 MCP is a handler over the command registry]] — one pure
  JSON-RPC handler; transports only forward; agents see their own frames
- [[ADR-009 Agents reach the app over local MCP, opt-in]] — local HTTP plus a
  stdio bridge, token and origin checks, off by default
- [[ADR-010 Desktop media is served by id over a media protocol]] — exact-range
  reads, the webview never sends raw paths
- [[ADR-011 Desktop projects are JSON files written atomically by Rust]]
- [[ADR-012 Exports are positional raw-body writes into a part file]]
- [[ADR-013 FFmpeg runs as a CLI child for proxies, LGPL in release]]
- [[ADR-014 Export is a deterministic frame loop]] — every frame awaited,
  never dropped; works hidden
- [[ADR-015 Export codecs follow what the device can encode]]
- [[ADR-016 AAC encoder delay is measured, not assumed]] — 0 native, 1024 WASM
- [[ADR-017 Analysis edits take source seconds]]
- [[ADR-018 Local analysis is our own signal processing in the webview]]
- [[ADR-019 Smart edits compile to commands, one undo step]]
- [[ADR-020 The grade lives in adjust, in Lumetri's order]] — schema, order
  and math of HSL, curves and wheels
- [[ADR-021 LUTs are files by reference, sampled as 3D textures]] — no table
  data in the project file
- [[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]] — 320 px
  readback, at most 8 updates a second
- [[ADR-023 The keyframe panel docks under the timeline tracks]] — shares
  the tracks' zoom and scroll; lanes plus a value graph
- [[ADR-024 Keyframes are selected by path and frame, and keys come first]]
  — no ids in the format; Delete, Copy and Paste act on keys before clips
- [[ADR-025 Stickers and templates are ordinary clips]] — rendered PNG
  assets and stacks of clips; no new clip type
- [[ADR-026 Library previews are drawn by the engine]] — an offscreen
  compositor, lazy and cached; cannot drift from the renderer
- [[ADR-027 Speed curves are exponential and anchored to clip frames]] —
  exact time maps; trims keep ramps; reverse reads down from in
- [[ADR-028 Reverse and retimed sound are made in the engine]] — backward
  GOP windows; WSOLA keeps pitch
- [[ADR-029 Headless rendering reuses the app]] — `--render project.json
  --out file`, JSON-line progress, exit codes
- [[ADR-030 The canvas text editor is a transparent textarea over the engine's text]]
  — the engine keeps drawing; the textarea shows only caret and selection
- [[ADR-031 Typing into a text clip is one live session]] — live keystrokes,
  one undo step, ended by any press outside (capture phase)
- [[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]] — two
  Apache-2.0 models by device; download on first use; fall back when the
  GPU can't
- [[ADR-033 Mattes are made once and stored as grayscale video]] — process
  once, play and export beside the source; reuse, smoothing, coverage
- [[ADR-034 Timelines leave as OpenTimelineIO]] — OTIO JSON first, proven
  with the reference library; our clip rides in metadata
- [[ADR-035 Linkage binds a clip to the shot under most of it]] — a clip
  follows the main clip under more than half of it; beds stay put
- [[ADR-037 Compound clips are nested timelines composited to a texture]] —
  nested timelines in `project.compounds`, drawn one framebuffer level deeper
  so a compound clip's settings act on the composite; one undo history.
- [[ADR-038 Copied effects preserve animation and get new identities]] —
  stack reuse, independent IDs, timing conversion and undo
- [[ADR-039 Project navigation waits for current edits]] — save in-flight
  edits and ignore overlapping navigation requests
- [[ADR-040 Media browsing stays outside the project document]] — derived
  usage counts, sorting and session preferences without changing saved assets
- [[ADR-041 Relinking preserves source handles and edit identity]] — recovery
  without silent trim changes
- [[ADR-042 Media organization is optional project metadata]] — folders,
  favorites, compatibility and undo
- [[ADR-043 Reused settings preserve timing and ownership]] — presets,
  selective attributes, animation conversion and source preview isolation
- [[ADR-044 Trim previews read the applied edit]] — exact cut frames,
  source limits and cancellable gestures
- [[ADR-050 Text to speech runs Kokoro on the user's machine]] — Kokoro-82M
  in a worker, downloaded once, placed under the title
- [[ADR-051 Frame blending draws the layer twice from two cursors]] — a
  second cursor lane and a constant-alpha second draw mix slow motion.
- [[ADR-052 Agents read what changed and export without a dialog]] —
  edits answer with a diff, `batch` is one undo step, `export_video`
  writes only into the Videos folder.
- [[ADR-053 One compressor everywhere, measured as it plays]] — the
  platform's compressor in the clip chain, and in loudness measurement.
- [[ADR-054 Tracking writes position keyframes]] — a template-matching
  tracker's path becomes the pinned layer's smoothed, thinned keys.
- [[ADR-055 The MCP guide is generated from the tools]] — groups, hints,
  examples, playbooks and the catalog in one module; the reference and
  playbook docs are generated and tested.
- [[ADR-045 Align measures the resting box, one clip to the canvas]] —
  shared on-canvas geometry for align, distribute and edge snapping
- [[ADR-046 A drop preview is a dry run of the drop]] — library drags run
  the drop's own placement and draw the difference
- [[ADR-047 A new title shows by playing its In animation]] — a silent run
  to the settled frame; reduced motion jumps there
- [[ADR-048 Crop is cut from the source and edited on a copy]] — crop
  before flips and transform; the crop mode's session and whole-picture view
- [[ADR-049 Masks turn rigidly and grow shapes without new fields]] —
  rotation in layer pixels; heart, star and round corners as additive fields
