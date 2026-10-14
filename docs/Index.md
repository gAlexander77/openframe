# Video Editor — Documentation

Obsidian-style vault. Open the `docs/` folder as a vault (or just read the
markdown); `[[wikilinks]]` connect the notes. Written for two readers: people
working on the app, and coding agents that need the reasoning behind it.

## Ground rules

- "Video Editor" is a placeholder name — [[Renaming]] lists every site.
- The owner reads history to learn *why*: commits are small, one intention
  each, and docs land in the same commit as the code ([[Conventions]]).
- What we learn about the products we imitate (CapCut, VEGAS, Premiere,
  Resolve) and the platforms we run on (WebCodecs, WebView2, Tauri) is
  written down in `research/` so nobody pays for a lesson twice.

## Map of content

- [[Features]] — everything the app does today, with the intent behind each
- [[Roadmap]] — what is in flight and next, in priority order
- [[Project format]] — the open JSON schema agents and pipelines write
- [[AI tools]] — the local tools' algorithms, defaults, credits and measurements
- [[Driving the app]] — the web build through Playwright, the desktop app over
  WebView2's debug port; native dialogs, OS drops, the drive scripts
- [[Architecture]] — layers, how an edit becomes pixels, the module table
- [[Conventions]] — where code goes, rules of thumb, commits, testing
- [[History]] — the build story, round by round, including rejected attempts
- [[Renaming]] — every site the placeholder name touches, and the one that
  moves user data

## Research

- [[CapCut desktop]] — the UX baseline: layout, every panel, shortcuts,
  export, what users complain about
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
