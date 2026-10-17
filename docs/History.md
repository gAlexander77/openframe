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

## 2026-10-16 — Claude Code reviews the Codex pass

Codex worked on main from 2026-10-14 to 2026-10-16 (32 local commits): the
guide's eight tasks, then owner-approved additions — caption worker
recovery, New/Open from Home, the desktop header, effect stack controls,
copy/paste effects, presets, Paste Attributes, composition guides, marker
management and export, media filters, folders and favorites, Save a copy,
relinking, the source monitor and the two-up trim preview. Its log is
`CODEX_GUIDE.md` §7 and [[Development pass 2026-10-16]].

Claude Code reviewed every commit (four parallel readers, each finding
checked in the code) and ran all drives headless. Type-check, 397 unit
tests and the production build passed; 27 web drives passed. Fixed, each
with a check that fails without the fix where one could be built:

- **Imports on Home returned nothing.** Tying imports to the open document
  session made `window.videoEditor.import` and MCP `import_media` answer
  `[]` with no project open; the export drive broke on it. They now throw
  "No project is open".
- **Effect edits closed gaps.** They went through `edit()`, whose magnet
  settle compacts the main track; effects are metadata and use
  `store.edit`, as ADR-043 already prescribed for presets.
- **One unreadable preset erased the library** on the next save; entries
  are now read one by one and unreadable ones are written back.
- **Autosave chained saves** while edits arrived during a write (only a
  waiting navigation must drain); **a Copilot turn edited the next
  project** after a switch; **relink accepted a short file** when the
  original's duration was unknown.
- Smaller: pasted fades overlapping, trim previews holding WebGL contexts,
  a stale frame after a decode error, the source monitor's clock and NTSC
  timecode, timeline menu at the wrong frame during playback or under a
  header, zoom jumping to a marker, moves pausing playback, marquee
  Escape, Home stealing focus, Manage media re-probing, FFmpeg conversions
  outliving their project, effect previews after relink.

### Lessons paid for in this round

- **A new guard needs the callers that run where it bites.** The session
  guard was right for delayed work but also caught synchronous automation
  on Home; a drive that was never re-run hid it. Re-run every drive after
  cross-cutting changes, not only the new ones.
- **`edit()` is for timing edits.** Its settle applies the magnet; a
  metadata change through it silently compacts gaps.
- **Load stored collections entry by entry** and keep what you cannot read;
  all-or-nothing parsing turns one bad entry into total loss on the next
  write.
- **`git show rev:file > file` under Vite** serves an empty module until
  the next change (truncate, then write); swap files in one write.
- **The owner's dev app shares :1420**: every save under `src/` hot-reloads
  their window.
- **Not fixed, needs a desktop test:** nothing saves when the window
  closes, so an edit within the 800 ms autosave delay is lost on close.
  The fix (an `onCloseRequested` handler that awaits `saveNow`) needs the
  `core:window:allow-destroy` permission and a desktop run; a handler that
  fails would leave a window that cannot close.

## 2026-10-16 — Timeline UX finished

The `timeline-ux` branch, parked on 2026-10-14 with UX-14 and UX-12 done,
was merged up to main and finished: the four timeline findings of
[[UX audit 2026-10-14]] are fixed.

- **Linkage** binds a clip to the shot under most of it, so a music bed no
  longer follows the first shot
  ([[ADR-035 Linkage binds a clip to the shot under most of it]]).
- **Drops** above the tracks make a picture-in-picture overlay, and every
  library drag previews where it lands by drawing a dry run of the drop
  itself: the magnet's cut with the later shots sliding aside, the new
  track a busy row opens, the clip an effect attaches to, the cut a
  transition takes ([[ADR-046 A drop preview is a dry run of the drop]]).
  Drops no longer fall back to the selection or the playhead.
- **A new title shows**: adding one at the playhead plays its In animation
  once, silently, and parks where it has settled
  ([[ADR-047 A new title shows by playing its In animation]]).
- `scripts/drive/timeline-ux.js` proves each with real pointer drags and
  compares every drop with its preview. The lessons are in the audit's
  Lessons section.

## 2026-10-16 — Canvas tools: crop, masks, several pictures

Build-order items 2, 9 and 18 of [[Feature gaps 2026-10-16]], on the
`canvas-tools` branch.

- **Crop on the canvas** (CapCut's Crop): the toolbar's crop button or the
  inspector's opens a crop mode that shows the whole picture with the crop
  over it, eight handles, the ratios and Reset/Cancel/Done under the
  viewer, and `set_crop` for agents
  ([[ADR-048 Crop is cut from the source and edited on a copy]]).
- **Masks** draw on the viewer while the Mask tab is open, with handles to
  move, size, turn, feather and round them; heart and star join the
  shapes, rectangles get round corners, and `set_mask` covers them all
  ([[ADR-049 Masks turn rigidly and grow shapes without new fields]]).
- **Several pictures** selected (or a group) get one box: drag to move
  them with snapping, a corner to scale them about its center.
- `scripts/drive/canvas-tools.js` checks every handle against the box it
  draws and the pixels the compositor renders.

Lessons:

- **Crop before flip.** The compositor mirrored a flipped picture inside
  its cropped box, so the kept part slid. Premiere crops the source and
  then flips; doing the same keeps the kept part where the uncropped
  picture showed it, which a crop mode that dims the rest needs.
- **Rotate masks in pixels, not fractions.** Rotating in layer fractions
  shears every shape on a non-square picture. Measuring in layer heights
  and coming back to fractions along the mask's axes fixes rotation and
  leaves every unrotated mask pixel-identical.
- **Offered keyframes must play.** The mask sliders offered keyframes and
  the keyframe panel named the paths, but the plan passed the stored mask
  through; nothing caught it until handles needed the animated value.
- **A session copy beats a long gesture.** A crop mode held open over a
  store gesture would have had its base replaced by any other drag; a
  copy in the store, drawn by the player as an override, cannot collide.
- Drives: a new overlay track lands on top, so pick clips by a property
  (their color), not by their order in `describe()`; scope a role query
  to its toolbar when a section toggle shares the name ("Crop").
