# History — how this got built

A narrative log of each build round with its intent, for archaeology that
`git log` is too terse for. Newest last.

## 2026-10-13

- **Project created** — the owner asked for "a modern CapCut" with VEGAS
  Pro and Premiere depth, desktop and web, AI features and automation
  pipelines, dark UI with clean animation, built the way TermHQ is built.
  Stack and conventions carried over unchanged from TermHQ
  ([[ADR-001 Tauri v2 and React, the TermHQ stack]]).
- **Research round** — five parallel research passes before any engine
  code: CapCut's desktop UX, pro NLE depth, the browser media stack, Tauri
  media plumbing, and AI/automation. Each landed as a note in `research/`.
- **The core, test-first** — integer-frame time with SMPTE drop-frame
  ([[ADR-004 Timeline time is integer frames]]), the project document and
  its trust boundary (`normalizeProject` lets agents write minimal JSON),
  keyframes by parameter path, and every trim mode as a pure op with exact
  frame tests: split, overwrite/insert, ripple delete, ripple/roll/slip/
  slide, speed, freeze, detach audio. CapCut's magnet and *linkage* became
  one `settle()` step every edit path runs through, after realizing that
  without linkage a ripple strands every title on the wrong shot.
- **Agents first** — the owner asked that the product be ready for MCP-
  driven agents and generative models like CapCut's Seedance, so the command
  registry with JSON Schemas came before most UI
  ([[ADR-006 Every edit is a named command with a JSON Schema]]).
- **Desktop first, all local** — the owner's direction mid-round: desktop is
  the product, the web build a client-only subset, all compute on the
  user's hardware ([[ADR-003 Desktop first, one build, a platform seam]]).
- **The engine** — mediabunny decode cursors, a WebGL2 compositor with
  premultiplied alpha and 19 effects / 20 transitions / 17 looks, Web Audio
  scheduling on the audible clock ([[ADR-002 The media engine lives in the
  webview]]). CapCut's palette and in-app shortcut list were adopted from the
  research's pixel samples so CapCut users feel at home.
- **The editor** — library, viewer with on-canvas handles, timeline (snap,
  magnet, linkage, preview axis, blade, marquee, Alt-drag duplicate), the
  inspector to CapCut's tab matrix, autosave and a home screen.

### Lessons paid for in this round

- **Exact-edge frame lookups land one frame early.** Containers stamp frame
  59 at 30208/15360 s, two ulps after 59/30; MKV rounds to milliseconds.
  Center sampling fixed 1x but hit source boundaries at 2x. The answer is a
  quarter source-frame past the edge (`plan.ts`). Found only because the
  framecode fixture encodes each frame's number in pixels
  (`scripts/drive/framecode.js`): visual checks would never have caught it.
- **Never `loseContext()` on unmount.** React StrictMode mounts twice and a
  canvas returns the same, now dead, WebGL context — every shader compile
  then fails with a `null` info log.
- **Global CSS must load before component CSS.** Importing `App` before
  `app.css` let `.btn` silently beat component rules of equal specificity.
- **`getOutputTimestamp()` can come from another time base** (headless, no
  audio device: `performanceTime` 0). Sanity-check the audible clock
  against `currentTime` or playback jumps to the end.
- **A grid item's intrinsic height beats `aspect-ratio`.** Portrait
  thumbnails stretched their 16:10 cards; absolutely placed images fix it.
- **Shared Playwright browser:** research agents must not use it (the owner's
  rule, and it collided with product checks). Parallel agents use
  playwright-core with the system Edge instead.

## 2026-10-14

- **Parallel rounds in worktrees** — after the core landed, agents built in
  their own worktrees under `F:\Dev\2026\worktrees\video-editor\` and were
  merged one by one:
  - **Desktop platform** — the desktop build stopped borrowing the web
    platform: media by id over a `media:` protocol, projects as JSON files
    Rust saves atomically, exports as positional writes into a `.part` file,
    OS drops by path, FFmpeg proxies for what WebCodecs cannot decode, and a
    real CSP ([[ADR-010 Desktop media is served by id over a media protocol]]
    to ADR-013).
  - **Export** — a deterministic per-frame loop on a private canvas, sound
    in 10 s offline windows, codecs by what the device can encode, AAC delay
    measured per device (0 native vs 1024 WASM), `render()` for automation,
    CapCut's export dialog; proved frame-exact and sample-synced by
    `scripts/drive/export.js` (ADR-014 to ADR-016).
  - **Local AI tools** — remove silences, split scenes, beat markers from
    our own signal processing, one undo step each ([[AI tools]], ADR-017 to
    ADR-019).
  - **Shortcuts panel** — written by Codex (GPT 6.1); its sandbox could not
    write the main repository's `.git`, so the commit happened here.
- **MCP and Copilot** — the protocol as one pure handler over the command
  registry, with `preview_frame` so agents see their own work
  ([[ADR-008 MCP is a handler over the command registry]]); an in-app
  Copilot driving it with a model on this machine (Ollama / LM Studio).
- **Canvas fill** — CapCut's blurred or colored fill behind letterboxed
  clips.
- **Keyframes you can shape** — CapCut's keyframe panel docked under the
  tracks on their time axis, draggable diamonds, easing presets stored as
  CSS beziers, a section keyframe, and `move_keyframe`,
  `set_keyframe_ease` and `remove_keyframes`
  ([[ADR-023 The keyframe panel docks under the timeline tracks]],
  [[ADR-024 Keyframes are selected by path and frame, and keys come first]]).
- **Agents from outside** — "Allow AI agents" opens a token-locked MCP
  server on `127.0.0.1:47280` plus a `--mcp-stdio` bridge
  ([[ADR-009 Agents reach the app over local MCP, opt-in]]), and
  `video-editor --render project.json --out file` renders headless with
  the export dialog's own engine ([[ADR-029 Headless rendering reuses the app]],
  [[Automation]]).

### Lessons paid for in this round

- **AAC starts before zero.** Its priming packet is stamped -21.3 ms and is
  never presented; using each track's first timestamp as time 0 played all
  sound 21 ms late. One origin per file, the earliest first timestamp
  clamped at 0, now serves playback, waveforms, filmstrips and analysis.
- **`Output.cancel()` closes the stream rather than aborting it**, so a
  canceled export looks finished; abort the target yourself.
- **Windows renames** fail with os error 5 when the target is held and 32
  when the source is; retry both. `ffmpeg -encoders` lists AMF on machines
  where it fails — trial-encode before trusting an encoder.
- **Git Bash heredocs collapse `\\` to `\`**; write scripts that need
  backslashes with an editor or a Python file, not a heredoc.
- **Escape in a popover must be caught in the capture phase**, or the app's
  deselect shortcut fires too; an animated card is a stacking context, so a
  popover inside it needs the card raised.
- **Playwright-launched pages always report visible**; test hidden-window
  behavior from a hand-launched browser over raw CDP.
- **A 9B local model with 30 tools wanders** — it called freeze, marker
  and transition tools instead of adding the title it was asked for.
- **Memory** — five agents each running Vite and a browser left about 5 GB
  free and Claude Code reaped dev servers; size parallel rounds to the
  machine.
- **A windows-subsystem exe has no console**: run from a terminal, its
  `println!` goes nowhere unless it calls `AttachConsole(ATTACH_PARENT_PROCESS)`;
  pipes from a parent process work regardless. Inherited pipes also make a
  release build usable as an MCP stdio server without a second binary.
- **Number ADRs before agents fork**: the headless ADR was first written
  as 020, which the color agent already held; reserve ranges per agent
  and take the next free number on main.
- **`shell.css` loads after component CSS**, so a generic rule there
  (`.menu-item`) silently beats a component rule of equal specificity;
  scope component rules.
- **Piping `tsc` into `tail` hides its exit code**; a commit went in with a
  type error. Check the status, not the last lines.
- **During a drag, compute from the clip as it was at pointer-down**; refs
  updated on every render point at the already-moved clip and the motion
  compounds.
- **WebView2 prints `Failed to unregister class Chrome_WidgetWin_0`** on
  stderr when the app exits from a command; it is harmless — judge a
  headless run by its exit code and JSON lines.
