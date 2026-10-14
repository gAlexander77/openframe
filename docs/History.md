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
- **Pro color** — HSL, curves, color wheels and .cube LUTs in Lumetri's
  order, plus waveform, parade, vectorscope and histogram scopes, proven
  against a CPU reference on color bars by `scripts/drive/color.js`
  ([[ADR-020 The grade lives in adjust, in Lumetri's order]] to ADR-022).
- **Stickers, templates and truthful previews** — about 140 local
  stickers rendered to PNG image assets, 16 word-art looks and 12 animated
  title templates built from ordinary clips, and library cards drawn by
  the real compositor — which showed that every wipe ran backwards
  ([[ADR-025 Stickers and templates are ordinary clips]],
  [[ADR-026 Library previews are drawn by the engine]]).
- **Speed ramps and reverse** — CapCut's Curve speed with presets and a
  graph, exponential between points and anchored to clip frames so trims
  keep the ramp; reverse from backward GOP windows (1.3–2.9 ms a frame
  instead of 26–57 ms per backward seek); pitch kept by WSOLA or let go
  like tape; every frame of a ramp and a reverse proven by framecode, and
  a reversed export reads 299 down to 240 frame for frame
  ([[ADR-027 Speed curves are exponential and anchored to clip frames]],
  [[ADR-028 Reverse and retimed sound are made in the engine]]).
- **UX audit** — a first-time CapCut user's walk at five window sizes:
  38 ranked findings in [[UX audit 2026-10-14]], 23 fixed (viewer fit,
  narrow windows, phantom inspector edits, keys on sliders and on Home,
  holding the last frame, keyboard and on-screen menus, Media lists every
  import, contrast, tooltips).
- **Typing on the canvas** — double-click a title or caption, or press
  Enter, and type where it sits: an invisible text field rides on the
  engine's own text, measured within a pixel line by line; the inspector's
  Text box became live too, and each session is one undo step
  ([[ADR-030 The canvas text editor is a transparent textarea over the engine's text]],
  [[ADR-031 Typing into a text clip is one live session]]).
- **Keyframes you can shape** — CapCut's keyframe panel docked under the
  tracks on their time axis, draggable diamonds, easing presets stored as
  CSS beziers, a section keyframe, and `move_keyframe`,
  `set_keyframe_ease` and `remove_keyframes`
  ([[ADR-023 The keyframe panel docks under the timeline tracks]],
  [[ADR-024 Keyframes are selected by path and frame, and keys come first]]).
- **Desktop verified live** — in the Tauri app over the WebView2 debug
  port: a ProRes 422 file imports by path, gets an FFmpeg proxy and shows
  the right frame; the project autosaves, survives a restart, reopens from
  the home screen and plays from the cached proxy without re-encoding.
- **Release build checked** — the shipped CSP blocked Copilot's local
  model server; then Ollama's CORS refused the release origin
  (`http://tauri.localhost`), which dev never shows because its
  `localhost:1420` origin is allowed. Copilot's calls now go through Rust
  (`model_request`, the two model ports only). In the release exe: ProRes
  through its proxy, auto captions word for word, and a Copilot title in
  11 s, with no CSP violations.
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
- **Canvas and CSS place text differently vertically**: the canvas
  centers each line on the em box, CSS on ascent plus descent (6.1 px apart
  at 96 px Inter Bold); measure it from the font with the canvas API.
  Measure alignment at a large size and at more than one viewer zoom.
- **Leaving a text field fires too late to end an edit**: the click that
  moved focus already ran; end the session in the capture phase.
  Playwright hides the caret in screenshots unless `caret: "initial"`.
- **A conflict resolver must handle CRLF files**: a regex written for
  `
` matched nothing in the CRLF `.gitignore`, reported "no markers left",
  and the markers were committed. After any merge, `git grep -n "^<<<<<<< "`.
- **Test the release build, not just dev**: the CSP only bites there, and
  the origin changes from `http://localhost:1420` to
  `http://tauri.localhost`, which local servers' CORS lists may refuse.
- **Fit the viewer to the content box**, not the panel; `:first-of-type`
  counts per parent; disabled buttons never get hover.
- **Centered WSOLA grains make slow-motion sound early** (90 ms at 0.1x):
  cap each grain at its 3/4 point, and skip the search in silence and at
  onsets.
- **Two agents fixed the same AAC-priming bug** on separate branches; the
  merge kept main's shared media origin. Land cross-cutting fixes on main
  early and tell running agents.
- **Previews built on the real pipeline are regression tests**: the
  engine-drawn wipe cards exposed that all four wipes ran backwards.
- **A fresh WebGL context compiles its shaders in the first render**
  (~300 ms); compile ahead with `KHR_parallel_shader_compile`. Reading back
  or uploading a GPU-backed 2D canvas stalls ~70 ms; `willReadFrequently`
  keeps it on the CPU.
- **CSS `steps(n, jump-none)` shows n positions including both ends**, so
  the step count must equal the frame count. **`Path2D` compound fills**
  need every part wound the same way, or the overlap comes out empty.
- **A `sampler3D` may never share a texture unit with a `sampler2D`** in
  WebGL2: pin every sampler to its own unit and bind 1x1 stand-ins when a
  grade part is off.
- **Vite adds `?t=` to modules it hot-reloaded**, so a drive importing
  `/src/engine/player.ts` gets a second, empty instance; take the exact URL
  from `performance.getEntriesByType("resource")`.
- **Python writes CRLF on Windows** unless the file is opened with
  `newline=''` (or `'
'`).
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

### OpenFrame documentation handoff

- **Owner chose OpenFrame** as the product name. Documentation now uses the
  chosen identity; the coordinated runtime/package/binary rename is pending
  in [[Renaming]], including saved-data and automation compatibility. The
  current repository remains `gAlexander77/video-editor`.
- **AI development experiment disclosed** in README and [[AI development]]:
  the implementation was developed using Claude Code and Codex, with a human
  owner setting direction and giving feedback. Documentation is working
  memory for users, contributors, and resumed agents, recording decisions,
  evidence, and lessons rather than treating plans as shipped behavior.
- **GPL-3.0-only selected by the owner** and applied through LICENSE and the
  README grant. [[Release preparation]] records the remaining manifest,
  attribution, packaging, and corresponding-source work. The owner explicitly
  requested that the repository stay private; no public release was made.
- **Desktop priority reaffirmed** after discussing uncertainty about web
  development. ADR-003 remains current. The next agent should log actual web
  capability checks separately; no browser-first switch was implemented.
- **Continuity protected**: [[Next agent handoff]], root `AGENTS.md`, and
  `CLAUDE.md` tell the resumed agent to preserve paused Claude Code work and
  existing worktrees. User and contributor guides were added. This was a
  documentation/licensing pass without app changes, pushes, or process
  interruptions. It was initially prepared without commits; the owner then
  authorized committing the handoff locally. Existing `.gitignore` merge markers were observed
  and logged for the owning agent, not repaired here.
