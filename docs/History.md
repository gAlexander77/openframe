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
  their own worktrees under `<worktrees>\video-editor\` and were
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

## 2026-10-16 — Compound clips finished

The `compound-clips` branch, parked on 2026-10-14 with the format and ops,
was merged up to main as it moved and finished
([[ADR-037 Compound clips are nested timelines composited to a texture]]).
Select clips on any tracks and press Alt+G (CapCut's chord; main's Ctrl+G
is Group): they become one green clip playing a nested timeline, whose own
speed, transform, opacity, blend, color, effects and volume act on the
whole. Double-click opens it, a breadcrumb leads back out, Alt+Shift+G
breaks it apart, one undo history covers every level, and save, export,
OTIO (a nested Stack) and agents (`create_compound_clip`,
`break_compound_clip`, `edit_compound`) take the whole project.
`scripts/drive/compound-clips.js` proves the viewer, scopes and export are
pixel- and sample-identical to the un-nested timeline.

### Lessons paid for in this round

- **A rendered texture is not an uploaded image.** A framebuffer's rows
  run bottom-up and its pixels are premultiplied; an image uploaded with
  `UNPACK_FLIP_Y` off runs top-down, straight alpha. Reading the nested
  composite as a layer source takes a V flip and an un-premultiply in the
  layer shader (`u_fbo`), or the nest draws upside down with dark edges.
  Done right, the nested and flat composites match to the bit at full
  opacity.
- **Undo must snapshot the document, not the view.** With the store's
  `project` as the open compound's view, every op and panel worked
  unchanged, but undo entries of views would restore the wrong timeline
  after moving between levels. Whole-document entries, with the view
  re-derived on undo, make one history; only an undo that removes the open
  compound steps out.
- **A view cannot judge what the document no longer uses.** Pruning
  compounds nothing plays must run on the whole document (root edits,
  leaving a compound): inside one, the view cannot see the timelines above,
  so everything outside it looks unused.
- **Per-timeline rules must be per timeline.** Main's solo and transition
  crossfades arrived during the work, computed over `p.tracks`. Inside a
  compound clip they apply to the nested timeline's own tracks, and an
  overlap measured in its seconds shrinks through a sped-up compound clip;
  the sounding clip now carries its overlap, so the mixer needs no lookup.
- **A fixed grid row count is a layout contract.** The timeline panel is
  `grid-template-rows: 38px 1fr auto`; adding a breadcrumb row gave it the
  `1fr` and squeezed the tracks. `:has(> .tl-path)` adds the row only when
  the breadcrumb is there.
- **The session scratchpad is shared between agents.** A helper script
  with a generic name (`ed.py`) replaced another agent's; prefix scratch
  files per branch (`cc_`).

## 2026-10-16 — CapCut parity pass (Claude Code)

The owner compared our Transform section with CapCut's (no align row),
asked for every missing feature to be found and built, styling fixed
across the app, and everything merged into main. The survey is
[[Feature gaps 2026-10-16]]; three agents finished the parked branches
and the canvas tools in their own worktrees while this session built the
rest on main. Shipped here: align and distribute
([[ADR-045 Align measures the resting box, one clip to the canvas]]),
edge and layer snapping, arrow nudge, flip, Fit/Fill/Stretch, Uniform
scale, the player's Ratio and zoom menus, Loop and Play in to out,
voiceover recording, Close gap and frame nudges, Replace clip, sound
crossfades under transitions, track solo/rename/volume/height, grouping,
proportional panels with layout presets (UX-30), custom shortcuts, GIF
export and export presets, imported and installed fonts, hover scrub on
media cards, Reduce noise and Stabilize. Merged from the agents: the
styling pass ([[UI polish 2026-10-16]]), timeline UX (ADR-046, ADR-047),
canvas tools (ADR-048, ADR-049) and compound clips (ADR-037).

### Lessons paid for in this round

- **Clipping one axis needs `overflow-x: clip`.** The timeline toolbar
  had `overflow: hidden` to keep narrow windows tidy, which also hid the
  tool picker's menu (Select, Blade, Ripple, Roll, Slip, Slide) since the
  day it was written. `clip` on one axis leaves the other visible.
- **A grid's auto track grows to its item.** The viewer centered the
  picture with `place-items: center`; zoomed past the stage, the track
  grew to the picture and started at the left edge, so Ctrl+wheel zoomed
  away from the pointer. `grid-template: minmax(0, 1fr) / minmax(0, 1fr)`
  plus `unsafe center` keeps it centered while it overflows.
- **Per-frame data is looked up per frame.** Stabilization first
  interpolated its corrections at the plan's quarter-frame-ahead source
  time, blending a quarter of the next frame's move into every frame; a
  shake that reverses each frame kept half its amplitude. Nearest frame:
  6.16 px of jitter became 0.06.
- **Zero padding looks like silence.** The noise gate learned the noise
  from the quietest frames, which were the half-empty edge frames, and
  took out half as much as it should; only frames wholly inside the audio
  count now.
- **A steep curve amplifies the reference's rounding.** The color drive
  grades the 8-bit readback on the CPU and compares it with the GPU's
  exact texels; through a square root near black that is four levels.
  The proportional layout resized the viewer, sampled the ramp there and
  failed a check that had passed by luck.
- **A capture-phase key handler that stops propagation silences its own
  fields.** The export dialog stops every key at the window; the preset
  name field's Enter and Escape never reached it until it opted out.
- **Write watched files atomically, and retry the rename.** Python's
  `open("w")` truncates before writing, and Vite served the empty module
  (trap 10 again); a temp file plus `os.replace` fixes that, and on
  Windows the rename fails while Vite has the file open, so it retries.
- **Shell traps on Windows.** Git Bash heredocs choke on non-ASCII ("…")
  and collapse `\`; backticks inside a double-quoted `python -c` are
  command substitution and silently ate command names in Features.md.
  Edits with symbols go in a script file or through the editor tools.
- **Agents share the session scratchpad.** One agent's `ed.py` replaced
  this session's; scratch files carry a per-agent prefix now.
- **The remote moved without this session.** `origin/main` was updated by
  a push from this clone at 18:50 (to `1e0dbe9`), not by Claude Code;
  nothing else was pushed.

## 2026-10-16 — Remove BG finished

The `bg-removal` branch, parked on 2026-10-14 with the matte pipeline
written but never run, was merged up to main and finished as CapCut's
Video > Remove BG > Auto removal (also an AI tools card, the
`remove_background` MCP tool and the `set_background_removal` command).

- **Model** ([[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]]):
  ormbg (Apache-2.0) where WebGPU has fp16 shaders, MediaPipe Selfie
  (Apache-2.0) elsewhere and as the fallback when ormbg cannot run. BRIA's
  RMBG models were rejected because their weights are non-commercial.
  BiRefNet_lite (MIT) exceeded this GPU's storage-buffer limit under
  WebGPU.
- **Mattes** ([[ADR-033 Mattes are made once and stored as grayscale video]]):
  made once per clip, steadied over time, and stored as a grayscale MP4
  beside the media. Preview and export read the matte through the same
  cursors, so they agree. A broken reference is dropped on load, and frames
  past the matte show whole.
- **Proof**: `scripts/drive/bg-removal.js`, 11 checks, all passing
  headless in Edge. With Hugging Face blocked, the first use fails with a
  message to check the connection. Then it downloads (3 s), processes 180
  frames (13 fps on WebGPU), and puts magenta exactly where the photo's
  background was in the viewer, an exported still and a rendered MP4.
  Off/on and undo work, playback drops no frames, the card cancels, and
  the project survives save, reload and reopen; opening another project
  mid-matte cancels the job and leaves the new one untouched. MediaPipe
  forced onto WASM ran at 75 fps with the same score. Run once outside the
  drive: Edge with no GPU chose MediaPipe on WASM (94 fps), and corrupt
  ormbg weights fell back to it with a toast that says so. The regression
  drives (framecode, export, align, keyframes, color, effect-stack,
  timeline-ux, ai-tools, web-capabilities, and main's compound-clips,
  stabilize, reduce-noise and canvas-tools) pass on the merged branch.

### Lessons paid for in this round

- **transformers.js chains sessions as `chain = chain.then(next)`**: one
  failed session creation fails every later load in that worker with the
  same error. The fallback model failed with ormbg's protobuf error until
  the page started a fresh worker after any model failure.
- **Weight download progress by bytes, not by file**: the config JSON
  finishes first, and averaging files read 100% before the weights had
  started, then fell to 51%.
- **A decode cursor holds its last frame past the end**. That is right for
  a source, but wrong for a matte on a clip trimmed longer: the plan has to
  decide coverage, not the cursor.
- **`edit()` is for timing edits, again**: the parked switch went through
  it, so with the magnet on, turning Remove BG on or off closed every gap
  on the main track. Look changes use `store.edit`, like the inspector's
  `patchClip`. The drive now puts a gap on the main track and checks that
  it survives (the check fails on the old code).
- **`normalizeClip` keeps unknown keys**, so every new optional clip field
  needs its own check at the trust boundary, or an agent's half-written
  field reaches the engine.
- **Drives must not remove React's DOM nodes** (clearing toasts by hand
  threw `removeChild` and stopped the app rendering). Filter old toasts by
  text instead.
- **A module imported from a drive after HMR is a different instance**
  (`?t=`), so changing its exports does not reach the app. Simulate
  failures at the network (`context.route`) instead: a 4 KB body where the
  weights go is a corrupt model, and an aborted request is an offline
  first use. Routing on the context catches the worker's fetches.
- **`page.evaluate` cannot import a bare specifier** under Vite. Take the
  optimized-dependency URL from a module the app already serves.
- **ormbg handles a clear object, MediaPipe only people**: one run on four
  object photos cut out the apple, the cat and the teapot cleanly with
  ormbg. MediaPipe missed the teapot entirely. Neither handled a scene
  with no subject.

### Later the same evening

Background removal landed from its branch (ADR-032, ADR-033: ormbg on
WebGPU, MediaPipe Selfie as the fallback, both Apache-2.0), with text to
speech (Kokoro-82M, ADR-050), the spoken-word caption highlight, the
anchor point, and four effects (Reduce image noise, Motion blur, Sketch,
Halftone). All 50 web drives passed on main.

- **Bisect the merge, then profile.** After the compound-clips merge,
  reversed 1080p ramp playback dropped 5 to 9 frames (0 before). `git
  bisect run` with the speed drive found the merge that combined the
  branch with main's later features, neither of which failed alone; a CPU
  profile over CDP then showed React rebuilding the timeline every frame.
  The timeline component had subscribed to the playhead since day one only
  to hand the selected clip's keyframe diamonds their frame; moving that
  subscription into the diamonds brought drops back to 0.
- **Install while a dev server runs: add, never clean.** `npm ci` deletes
  `node_modules` first; with two Vite servers holding files it stopped
  half way and left `vite/client` missing. `npm install` restored it.

### Late evening: the rest of the survey's P1 list

Sixteen more features, each its own commit with a drive: Rate stretch
(Shift+R), a three-band EQ, Auto adjust, Lift and Extract (; and '),
keyboard reach for timeline clips (UX-33), Remove filler words, a LUFS
line under the meter, Insert and Overwrite from the source monitor (, and
.), bigger hit targets (UX-31), Preferences for default lengths, snapping
to the visible guides, a typed Duration in the Speed tab, clip color
labels, one-word captions, and track pan. The UX audit has no open items
left, and the survey's stale rows were brought up to date.

- **Measure the recognizer before building on it.** Kokoro spoke a line
  full of fillers and every Whisper size transcribed it: tiny drops all of
  them, base and small keep "um" but never write "uh", "hmm" comes back as
  "hum" and "er" as "or". The tool says so instead of promising them all
  ([[Filler words]]).
- **Cut between words with a margin.** Cutting a filler right up to the
  next word's stamped start nipped "well" into "while"; a 40 ms guard on
  each side fixed it, and consecutive fillers must be bounded by the
  nearest real words, not by each other.
- **A stopped filter has a long tail.** The live LUFS meter read
  "M -1221.2" after a stop: the K-weighting's decaying output squared to
  tiny numbers. Anything under BS.1770's -70 LUFS gate is shown as a dash.
- **Dialogs keep the app's shortcuts out on purpose**, so keys meant for
  the dialog's own job (the source monitor's , and .) must be resolved
  inside it; `actionFor(e)` reads the keymap there.
- **A probe drive can import the app's own modules**: `await
  import("/src/engine/transcribe.ts")` inside `page.evaluate` made the
  Whisper experiment a ten-line throwaway. But once a file has been hot
  updated, Vite serves the app `/src/x.ts?t=...`, and a plain import gets
  a second copy with its own state: the undo-history drive's edits went to
  a store the app never saw. Stateful modules must be imported by the URL
  the app loaded (the `mod()` helper in `speed.js` and `undo-history.js`).
- **A ChannelSplitter is always "discrete".** Setting its interpretation
  to "speakers" throws, which the channel-fill drive's first export hit.
  A stereo GainNode in front (explicit, "speakers") upmixes a mono file so
  filling from either side keeps it whole.
- **Effects cannot draw a layer's border**: they run on the layer after it
  is placed on the canvas and never see its rectangle. Rounded corners
  already exist through the rectangle mask's radius, and border and
  shadow belong in the layer shader.

## 2026-10-17 — An agent makes a whole video

Claude made a 36-second promo for RacePulse (a sim racing overlay app)
entirely over MCP: screen recordings framed and zoomed, seven voice lines
with matching captions, titles with animations, dissolves, a music bed
ducked under the voice. It worked, and it showed where the agent surface
was thin. This round fixes what it found.

- **Copilot is now the AI assistant.** The owner renamed it: Microsoft and
  GitHub both ship products called Copilot. The panel, the title bar
  button, the code (`AssistantPanel`, `state/assistant.ts`,
  `lib/assistant.ts`) and the living docs changed; History, ADRs and
  research notes keep the old word because they record what was true then.
  The model choice moved to the `assistant` storage key, still reading
  `copilot` so nobody has to pick it again.
- **What the promo taught the agent surface** (ADR-052). Each edit
  answered with the whole timeline (about 8 KB, some 40 times); now it
  answers with what changed, usually under 300 bytes. Nine animations took
  nine calls; `batch` makes them one call and one undo step. Checking the
  cut took a dozen single frames; `preview_frames` is one contact sheet.
  Framing a screen recording's panel meant working out scale and offsets
  by hand, right-aligning so no black band showed; `frame_region` takes a
  rectangle of the picture and does that math, still or as a push-in.
  Captions over busy footage needed a box the agent could not ask for;
  `style.background` (and stroke, shadow) now can. And the agent could not
  export at all: the dialog wants a person. `export_video` writes into the
  Videos folder, choosing only the file name, never replacing a file.
- **`describe_project` was silent about animations, positions and text
  styles**, found when a `batch` of `set_animation` answered "unchanged".
  It reports them now, so the change summary does too.
- **Export loudness missed its target by 3 dB.** The promo's mix measured
  -20 LUFS and gain alone stopped at -17.1, held by speech peaks. A limiter
  now holds the raised peaks: export renders the whole mix once to measure
  it anyway, so the limiter sees every peak in advance and starts each
  reduction before it (the ponytail comment had named this upgrade). The
  promo now measures -14.3 LUFS in ffmpeg with peaks at -0.9 dBTP.
- **The voice sets the timing now.** In the promo, each line was planned
  into a slot, and the generated voices came out longer (5.07 s for a
  4.5 s slot), so every voice and caption had to be moved by hand.
  `add_voiceover` speaks the whole script first, lays the lines end to end
  at their real lengths with captions to match, and answers where each one
  landed; the picture is cut to the voice, as an editor would.
- **Video Editor is now OpenFrame.** The owner asked for the full rename:
  the app, window, binary (`openframe.exe`), crate, npm package, MCP
  server name, FFmpeg override and docs, and the GitHub repository
  (`gAlexander77/openframe`, private, new description). The app
  identifier stays `com.alex.video-editor`: it is the folder every project
  lives in, and every saved project was still listed after the switch.
  `window.videoEditor`, the old FFmpeg variable, the effect-preset key and
  OTIO metadata keep working (docs/Renaming.md lists each and why).
- **A second video, made with the new tools: an OpenFrame promo.** The
  footage is OpenFrame itself: the web build in headless Edge, recorded
  through the page's own screencast (JPEG frames with their timestamps,
  assembled by ffmpeg at 30 fps), with the RacePulse promo open in it.
  `add_voiceover` set the timing (eight lines, 52 s, in ten seconds); the
  whole cut, framing, titles, transitions and mix went in through MCP in
  under a second of tool time. It found three more things:
  - **A title is placed by its center**, so section tags of different
    lengths never shared a left edge. `align_clips` takes a `margin` now:
    it already measured the real box, and now stops inside the edge.
  - **Mono was measured twice.** The meter counted a mono clip as EBU's
    dual mono (full level in both speakers), but the mix pans mono through
    Web Audio's equal-power panner, -3 dB each side. `normalize_loudness`
    judged every mono voice and mic recording 3 dB louder than it plays;
    the export's mix came out 3 dB under the voices' "level". Every channel
    counts once now.
  - **A peaky voice stops export loudness short.** Kokoro's male voice
    runs about 20 dB from peak to loudness; reaching -14 LUFS under a -1 dB
    peak needs 7.5 dB of limiting, past the limiter's 6 dB cap, so the
    promo exported at -15.8 LUFS (the note says so). A speech compressor
    before the limiter is the fix when it matters.
  - **One move per frame_region** made the assistant shot (a tall, narrow
    panel) two clips: onto the panel's header, then down to the prompt as
    it is typed. A split costs nothing visible in continuous footage.
- **Public.** After the rename the owner made the repository public, to
  share the experiment. A scan of the whole history first: no keys or
  tokens, every commit under the GitHub noreply address, the promo the only
  large file. There is still no packaged release; the docs say so.
- **A compressor, and Enhance voice.** The promo's -15.8 LUFS came from
  synthetic speech peaking far over its loudness. Every editor we imitate
  evens speech out first, so OpenFrame does too: the platform's
  DynamicsCompressorNode after the EQ, in preview, export and loudness
  measurement alike (ADR-053), with Enhance voice, Gentle and Strong, and
  `add_voiceover` using it by default. The promo now exports at -14.1 LUFS
  with 1.1 dB of limiting. The first presets added 4 to 12 dB of makeup
  and the voices measured -12.5 LUFS with peaks past full scale: Web
  Audio's compressor already makes up about 0.6 of its own reduction, so
  the presets add none.

## 2026-10-17 — The improvements branch (Claude Code)

The owner asked for research into what is still missing and for
Playwright checks that the styling and the workflows are right, all on a
branch (`improvements`), committed locally and never pushed. A fresh
desk survey (everyday gaps the 2026-10-16 survey missed) and a code audit
(features only an agent can reach, keys no menu shows) set the order.

- **Two drives had gone stale, not the product.** The baseline run of all
  72 web drives on this branch failed two: `ai-tools` still expected mono
  speech to read as dual mono (-14.2 LUFS; it reads -17.2 since mono is
  measured as it plays) and `export-loudness` still expected export to
  stop under the peak ceiling (a limiter holds the peaks now, and the note
  says "normalized to"). Both changed with the product earlier the same
  day; their drives were not rerun. Run the whole suite after changing
  shared audio paths, not only the drive of the feature.
- **Tracking** (ADR-054). A title or sticker follows a subject in the
  video under it: a box on the viewer, template matching on small gray
  frames, and position keyframes. The first run kept a key on every frame:
  the tracker's sub-pixel jitter (a tenth of an analysis pixel is half a
  canvas pixel at 320 px wide) beat the half-pixel thinning. A light
  binomial smoothing first left 5 keys for the drive's 3 seconds.
- **Remove media.** Nothing removed an imported file: no command, and
  media cards had no menu. Cards now have one, and Manage media clears the
  unused. The project summary counted "1 files" and included stickers the
  library hides; it says "1 file" and counts what the library lists. A
  screenshot taken right after opening a menu shows nothing: menus pop in
  over 180 ms, so drives wait before capturing.
- **Names and keys a screen reader and a rebinding could not see.** A
  code audit found the Text tab's B, I and U buttons and its AA, aa and
  Aa case buttons named only by those letters (a screen reader read "B");
  they are drawn icons now, with names and tips. The trim tools' T, R, Y
  and U were typed into the tool picker and went stale once a key was
  rebound; the picker shows the key as bound. Add marker, the marker
  arrows, Extract audio, Duplicate, Delete and the shortcuts button now
  show their keys, through one `tipFor` beside `chordFor` (the player had
  its own copy). Linkage, Preview axis and the keyframe panel were
  toolbar-only; the Timeline and View menus list them.
- **Several clips at once.** With two or more clips selected the
  inspector offered only Duplicate, Delete, Align and the clipboards, so
  setting ten clips' volume took ten edits. The rows the clips share now
  set them all (Premiere 25's Properties panel), each keyed at its own
  frame when keyframed, with "Mixed" where they disagree.
- **Type where to go.** The player's timecode was display only; it is a
  field on click now, read as Premiere reads it (1000 is 10:00, +15
  moves fifteen frames). The markers' time field gets the same digit rule.
- **Save a frame from the player.** A still was only in the export
  dialog, at its resolution; the transport's camera button, the File menu
  and Mod+Shift+E (Premiere's Export Frame) save the frame at the
  project's size.
- **What only an agent could do.** The code audit listed commands no
  button reached. Now in the UI: a solid color layer (Adjustment tab), the
  canvas size in pixels, deleting the markers a search shows (after Beat
  markers drop forty), and aligning inside the title-safe line. Going the
  other way, `set_project` said it set the frame rate and could not; it
  takes one of the app's rates now. Add track stays agent-only on purpose:
  the timeline tidies empty tracks away, as CapCut does, so a button would
  add a track that vanished.
- **A pipette on every color field.** The native color dialog on Windows
  has no screen picker, so matching a title to the footage meant guessing
  hex values. WebView2 has the EyeDropper API; each color field offers it
  where it exists. Headless browsers have no screen to sample, so the
  drive stands in a picker with a known answer.
- **A styling sweep, and what it found.** A new drive checks 129 states
  (every tab, menu and dialog at three window sizes, the smallest the
  desktop window's minimum) for clipped and spilling text, overlapping and
  cut-off controls, unnamed controls and contrast. Before this round's
  fixes it found the project Name field unnamed; after them it caught
  three regressions of this round: the new clickable timecode kept the
  browser's gray button face (cyan on gray, 2.4:1), the media card's new
  menu ignored Escape and clicks elsewhere (it now shares `useDismiss`
  with the toolbar's menus), and the save-frame button pushed the total
  timecode out of the transport at the minimum window (its container
  breakpoints were remeasured). Its first versions were slow and noisy:
  pressing Escape after every step deselected the clip, so each inspector
  tab waited out a 30 s timeout, and a pairwise overlap check that
  recomputed clipping per pair took ten minutes; memoized, it takes one.
- **Sync audio by waveform.** A lav or recorder lines up with the camera's
  own sound by cross-correlating onset envelopes (Beat markers' spectral
  flux), then lands exact to the sample: the start on a whole frame, the
  in-point taking up the rest. The correlation peak alone could not tell
  one take from two: unrelated fixtures still peaked at 0.13 to 0.28, and a
  short true overlap's best wrong lag rises too. The margin over the best
  lag 0.15 s away separates them (0.46 to 0.74 against 0.06 at most), so
  that is the confidence. Measured on the new fixture pair (one take
  through a thin camera mic and a noisy lav, 1.37 s apart): 0.8 ms early.
- **A guide for vertical apps.** Creators keep titles clear of TikTok's,
  Reels' and Shorts' buttons and captions; Kapwing and others draw those
  zones, no editor we imitate does. The guides menu has one now, shading
  what the apps cover and snapping to the clear area. The apps publish
  margins only for ads, and third-party guides disagree (TikTok's right
  column is 100 to 180 px depending on the source), so the guide takes the
  largest of each side; editors can still check the upload in each app.
- **Rename and duplicate from the home screen.** Cards could only be
  deleted; renaming meant opening the project, and a variant meant Save a
  copy from inside it. Both are card buttons now, built on the platform's
  load and save so desktop and web agree. A drive caught that the card,
  itself a button, takes its children's labels into its own name, so
  "Rename X" matched two elements until the drive asked for exact names.
- **Auto reframe, from the tracker.** The "Coming soon" card works now:
  the canvas takes 9:16, 1:1 or 4:5, the clip fills it and keeps the
  subject at the center with smoothed, clamped position keys, the same
  path Tracking pins layers to. No face or saliency model: the subject is
  whatever starts in the middle, or a box the user places in the
  inspector. The tracking module was split so both use one core
  (`trackPath`, `applyTrack`).
- **Fade a video's sound on the timeline.** The volume line and fade
  knobs drew only on audio clips, so a video's own sound had to be faded
  in the inspector. The selected video's waveform strip has them now
  (Premiere's audio handles). The strip is 14 px for 48 dB, so the first
  drive's 5 px drag took 17 dB off; the line now moves at a quarter of
  the pointer there, and 5 px is 4 dB.
- **A full run, from a snapshot.** All 82 web drives ran against a
  detached copy of the branch on its own server, so editing could go on
  meanwhile (a drive's page reloads if `src/` changes under it). 80
  passed. `project-copy` looked up the Save a copy field by the name
  "Project name", which the inspector's Name field now also has (the
  sweep had found it unnamed); the drive asks the dialog now.
  `clip-focus` checked focus straight after an arrow key, but focus moves
  in the next animation frame (27 to 40 ms headless) and the extra
  inspector work this round lost the race; it waits for focus now.
- **Saved text styles.** A title's look could be copied with Paste
  attributes but not kept: CapCut saves text presets and Premiere has
  Text Styles. The Text tab saves a style under a name in this viewer's
  storage, and a chip with an "Aa" sample (on black or white, whichever
  its color reads on) gives it to a title in one undo step.
- **Magnify.** Premiere 26.3's lens, used constantly in tutorials and
  screen recordings, is one more effect shader: a circle whose picture is
  scaled up about its center. The effect pass's v_uv runs bottom-up, so
  Center Y (from the top) flips; the drive pins that by checking the lens
  changes pixels near the top and none near the bottom. Its first check
  read eight color bars as seven and sampled one bar both ways.
- **Record the camera or the screen.** Tutorial makers record their
  screen and themselves; CapCut has Record. Media > Record does both with
  MediaRecorder, preferring MP4 (Chromium writes it since 126, so the take
  seeks without a scan), and imports the take like a dropped file at the
  playhead it started from. The voiceover recorder was not reused: its
  worklet exists to place audio to the sample, and a video take has no
  such need. The drive records the runner's fake camera and microphone;
  the desktop app's permissions wait for a desktop check.
- **Sound effects, made locally.** Whooshes, pops and dings are in almost
  every short, and CapCut's are a cloud library. Eight are synthesized
  from sines and seeded noise (a swept band-pass for the whooshes, a
  pitch-dropping sine for the pop, inharmonic partials for the bell), so
  each is the same on every machine and free of any license. The Audio
  tab's empty drop box was 180 px tall and pushed them out of view; it is
  one line there now. Record moved out of the Audio tab, where it made
  little sense.
- **Caption looks.** Styling captions meant styling one and pressing
  Apply to all; CapCut and Resolve 20 offer templates. Six looks now sit
  in the Captions tab, each a whole style and a height (so Boxed drops
  the outline it replaces) with a CSS sample on its card, and Word pop
  carries the spoken-word highlight. Per-word motion stays for later.
- **Linked picture and sound.** Extract audio split the sound off for
  good, so a moved shot left its sound behind unless linkage happened to
  carry it. Groups already behaved like Premiere's links (select, move and
  delete together, Alt takes one, trims per clip), so the extracted pair
  is grouped, and Premiere's red out-of-sync counts show when one side
  moves alone. One fix on the way: Alt-click did not narrow a selection
  that already held the clip, which is exactly how one side of a selected
  pair is taken. The drive's first clicks landed on the selected sound
  clip's volume line, which takes the pointer in the clip's middle.
- **Motion path.** Tracking and Auto reframe write position keys that
  were only visible as diamonds in the keyframe panel. A selected picture
  with position keys now shows Premiere's dashed motion path and key dots
  on the viewer. Its drive learned that a level line has a zero-height
  box, which Playwright calls hidden: it waits for the line to exist.
- **Two audit leftovers.** Enter in a caption only finished the edit, a
  ponytail note waiting on CapCut's split at the caret; `splitCaption`
  now splits where the next word is spoken, keeping each half's word
  timings, and the editor moves to the second half. And the transcript
  card dropped reversed and speed-curved clips without a word; it says
  how many it leaves out and why.

## 2026-10-18 — Tools an AI model can make a professional video with (Claude Code)

The owner asked for MCP tooling and features good enough for an AI
model to make a professional ad or an epic edit, documented so any model
knows how to use each tool, with research into how professionals work.
A research pass ([[Pro workflows 2026-10-18]]) set the list; four agents
built toolkits in parallel worktrees (epic edits, ads, compositing, sound
and delivery) while the MCP layer was rebuilt here.

- **The MCP guide** ([[ADR-055 The MCP guide is generated from the tools]]).
  - A model now gets `help`, three prompts, guide resources and a
    catalog of every name the tools accept.
  - Before, `list_catalog` named four kinds of thing; the rest (templates,
    looks, sound effects, fonts, speed presets, blend modes, `set_param`
    paths) could not be discovered.
  - The reference and the playbook are generated and tested. The test
    caught a wrong example on its first run: `batch` steps take `command`,
    not `name`.
- **What the inspector could do and agents could not:** blend modes,
  chroma key, canvas fill and duplicating clips. Also sound fades:
  `set_param` takes them in frames, while every other time in the API is
  seconds, a trap for any model; `set_fades` takes seconds.
- **Safe areas** follow SMPTE ST 2046-1 now: 93% action and 90% title,
  not the old 90% and 80%. The research caught it; "Inside title safe"
  and the guides moved.
- **Looking and checking like an editor.**
  - `preview_media` shows an imported video's own frames, so a model can
    choose moments before cutting.
  - `preview_motion` shows consecutive frames of a stretch, with the
    cuts and beat markers in it, so a model can see whether a cut lands
    on the beat.
  - `check_project` measures the playbook's rules and names the fixing
    tool for each finding. Its drive breaks three rules, fixes them with
    the named tools, and passes.
  - The sheets had a transparent ground, so white-edged frames (the
    framecode fixture) ran together. They sit on dark gray now.
- **Epic edits, for agents first.** A beat-synced montage took dozens of
  calls (mark beats, read markers, place every shot, keyframe every hit),
  so agents did not make one. Six tools now cover it: `analyze_music`
  (the song as data: beats, bars, phrases, sections, the drop),
  `cut_to_beats`, `add_beat_hits`, `add_cinematic_bars`, `set_speed_ramp`
  and `fit_music`, with whip, zoom punch and spin blur transitions, seven
  more synthesized sounds and `end_at` so a riser peaks on the drop.
  `scripts/drive/epic-edit.js` builds a 13 s edit through MCP calls alone;
  every cut lands within 17 ms of a true beat.
- **Downbeats come from where a song changes.** Accents alone (onset
  strength, bass, how much the sound changes) picked the wrong beat of
  four on the beat-128 loop, where nothing marks the bar: three ways of
  measuring each beat at a different place in it (a frame grid, four
  fixed spots, windows reaching into the next beat) made patterns that
  repeat every few beats and read as accents. Measured across the whole
  beat, inside it, and averaged as power, the loop has no accent; a part
  changing (two bars against two bars, 3 dB or more) is the strongest
  cue and votes first. Averaging band levels in dB let a silent band in
  one beat (the last beat's cut-off hat) move a mean by 100 dB and invent
  a section; power averages with a floor do not.
- **A hit fades by its effects, not its opacity.** A flash made as an
  adjustment layer fading out by opacity would cross-fade a zoom on the
  same layer into a ghost of two pictures, so every hit keyframes its own
  amounts (the flash: exposure, brightness and whites) from the peak on
  the beat to nothing. Adjustment layers on their own track meant a title
  added later landed among the hits (the first free track from the top);
  new titles and media now skip tracks of adjustment layers.
- **Flashes keep to three a second** (WCAG 2.3.1, Three Flashes): beat
  hits drop the flash from a beat that would break the limit, counting
  flashes already on the timeline, and the strobe effect starts at 2 a
  second, its range kept.
- **Zero crossings misread pitch in a mix.** Checking which second of a
  song plays by its pitch, the export read 236 Hz for a 220 Hz tone: the
  mix's faint hiss adds crossings. Autocorrelation reads 220.2. The sound
  effects test had one `expect` per sample; with seven more sounds it took
  over five seconds, and one `every` makes it two.
- **What the contact sheet showed.** The end-to-end drive's first sheet
  had the opening title across the subject's face and the same fractal
  in five shots of sixteen (three fixtures share one picture). Moving the
  title to the lower third and giving the one real take three framings
  with `frame_region` punch-ins fixed both; agents with little footage can
  do the same. A transition drive that put a color clip before a picture
  found no cut to transition: color clips land on an overlay track, not
  the main one, and `set_transition` answers `unchanged`.
- **MCP without the desktop app.** `scripts/mcp-web.mjs` serves the web
  build's MCP over HTTP from a headless browser ([[Driving the app]]), so
  a model can be tested against the tools exactly as a client sees them.
- **Sound design for trailers and ads** (ADR-060). A low-pass and
  high-pass with a keyframeable cutoff, a reverb, an echo and a tape stop
  on any clip with sound, one command each, so an agent can make the
  "muffled build, open on the drop" in one call (`sweep`). Lessons: echo
  and reverb sit after the clip's volume so their tails ring past its end
  (Premiere's clip-effect tails stop at the edit, a known complaint), and
  that forced a change to export, whose 10 s audio windows each started
  silent: a reverb would have been cut at every window edge. Windows now
  pre-roll by the longest tail. Web Audio's low/high-pass `Q` is a
  resonance in dB, not a Q (-3.01 dB is Butterworth's 0.707). A cutoff
  swept linearly in Hz sounds open almost at once, so keys move on a log
  scale. The reverb's two sides first came out correlated 0.5: a Lehmer
  generator seeded with s and 2s gives the same stream doubled. A tape
  stop cannot be a playbackRate ramp, because the scheduler places
  constant-rate chunks; it is the retimer's varispeed at a slowing clock,
  and its drive checks the pitch at five moments against the map (within
  1.3%).
- **Delivery to a spec** (ADR-061). Export's limiter held sample peaks
  while every broadcast spec is in dBTP; it now holds the 4x-oversampled
  true peak (a 49-tap windowed sinc, as libebur128 makes its own rather
  than BS.1770's example table; within 0.05 dB on EBU Tech 3341's tests),
  and lands on the ceiling with no margin. -24 LKFS (ATSC A/85, -2 dBTP)
  joined the targets. `measure_loudness` gives an agent integrated
  loudness, Tech 3342 loudness range (written from its MATLAB listing),
  maxima, true peak and pass or fail against online, EBU R128 or ATSC,
  also as an export at a target would deliver it. Its drive checks each
  figure against the exported WAV read independently, with the true peak
  from `decodeAudioData` into a 192 kHz context. The first mix it built
  summed to +3.1 dBFS and the WAV clipped, which no figure had said: the
  report now flags `clips`.
- **Kinetic typography, for ads.** Titles animate per letter, word or
  line with a stagger and an order, the shape of After Effects' range
  selectors rather than a fixed list: any catalog animation plays per
  unit, and the presets (typewriter, word pop...) are catalog entries
  with a unit. The plan says which animation runs and how far; the text
  rasterizer draws each unit, so preview and export agree (the drive
  compares the viewer with an exported still of the same frame). Three
  things the first version got wrong: a highlight swept in vanished the
  frame it finished, because a settled title rasterized as a plain still
  (a sweep is part of the look at rest, so it is drawn at its end, still
  cacheable); a title with a marker in and an underline out drew only one
  of them; and per-unit frames, each a new raster, would have filled the
  compositor's 256 keyed textures, so a moving frame is uploaded unkeyed.
  A gradient fill must stay put while letters travel through it: each
  unit maps the gradient's ends through the inverse of its own transform.
- **A brand kit and ad elements.** The kit lives in the project (two fonts,
  colors by role, logo variants), and the elements (end card, lower third,
  offer badge, call to action, logo reveal) are ordinary text, solid and
  picture clips laid out inside the title-safe area, so nothing new
  renders or saves. Buttons and badges are text with a background box, not
  masked solids: a box measured in canvas fractions stretches when the
  frame changes shape, a text box does not. Two lessons from the drive's
  screenshots: a glow effect left on a logo smears it (the flare now fades
  to nothing), and a Details section that mounted collapsed before an
  agent set the kit stayed collapsed (it remounts when a kit arrives).
- **Text behind the subject.** A copy of the video with Remove
  background's matte, on a track above the title, is the whole effect;
  `removeBackground` was split so the matte can be made first and the copy
  added in the same undo step. A dark line at the frame's top edge in the
  first screenshot was the viewer's overlay, not the picture: with the
  title hidden the copy over the original differs by at most 3 of 765.
  Product ads are often stills, and a picture clip has no matte: the
  model runs on the photo once and the copy is a new PNG with the
  background transparent, so nothing new had to be taught to the
  renderer.
- **Deliverables without touching the master.** Every version (shape,
  cut-down, textless) is a project document computed from the master
  (`src/lib/versions.ts`) and handed to the exporter, which already takes
  any project: nothing to restore afterwards, no undo steps, and the user
  can keep editing. Refitting measured in pixels against the short side is
  what keeps a 9:16 title the size it was on 16:9 (sizes are pixels at a
  1080-tall frame, so a literal copy would be 1.8 times larger on a
  1920-tall one); full-frame footage instead keeps covering, its push-in
  keyframes scaled and clamped so no frame shows an empty band. A cut-down
  keeps the opening and the end card and lifts the middle out of the
  picture tracks only; the music is cut at the new end and faded, since a
  jump in the music is worse than an early fade. On the web each file goes
  through the save dialog, which a browser opens only after a click; the
  drive stands in a dialog that keeps the bytes and ffprobe reads them.
- **What the ad's contact sheets caught.** `ad-spot` makes a 15 s ad with
  MCP calls alone and saves `preview_frames` and `export_versions check`
  sheets to look at. They showed four things no assertion did: a yellow
  kicker label vanished over a pink, busy shot (labels are boxed in the
  accent color now, with a readable label color); a 16:9 headline refit to
  9:16 kept its pixels and broke into a word a line (a refit line wider
  than the new safe area now shrinks to fit, to three quarters at most);
  a boxed title whose letters fade in showed its empty box first (the
  box's opacity follows the most visible unit); and the lower third and
  the end card's website ran small (60/38 and 40 pixels now). An agent
  had no seconds-based fade for music either: fades are frames through
  `set_param`. This branch added `set_audio_fade` for it while the MCP
  lane added `set_fades` for the same reason; the merge kept one
  (`set_fades`, each fade at most half the clip) so a model is not left
  choosing between twins.
- **Graphics and compositing** (ADR-056 to ADR-059, ADR-062). An agent making ads
  and title sequences needed After Effects' basics: shape layers (a color
  clip with a `shape`, drawn as signed distances, with gradient, outline
  and Trim Paths' draw-on), track mattes (alpha, luma, inverted; the clip
  above or a named one, not drawn itself), motion blur from movement
  (placements sampled over the shutter, summed in half float), mirror and
  repeat edges, spring, elastic and bounce eases, and seeded wiggle. Each
  is a command; one drive builds a 6-second logo reveal and lower third
  through MCP alone and saves its contact sheet. Lessons:
  - *A solid drew nothing once motion blur was on.* Solids and shapes bind
    no texture, so unit 0 still held the half-float target being summed
    into; WebGL refused every draw with only a console warning ("Feedback
    loop formed between Framebuffer and active Texture"). A layer with no
    texture of its own binds a blank one.
  - *`texture()` inside a loop cost a second of compile.* Averaging the
    transition pass over the shutter in a loop of uniform length made
    ANGLE's D3D compiler unroll it, every transition included: 1053 ms to
    build the program. A separate program with only the moving transitions
    and `textureLod` (no gradients, so the loop stays a loop) builds in
    ~70 ms, and only when used. The shape code got its own build of the
    layer shader for the same reason (it added ~45 ms to every compile).
  - *Averages belong in float.* Additive blending into RGBA8, each sample
    at 1/32 opacity, rounds every share: a flat area drifts by several
    levels. The sum goes to an RGBA16F target and is copied back once.
  - *Wiggle's amplitude was not reached.* Two octaves of Perlin noise
    passed 0.75 of the amplitude one time in a thousand, so a 40-pixel
    shake wandered 25. Scaled by 1.3 and clamped, the amplitude is a
    ceiling the shake meets.
  - *The color bars change rows at mid-height.* A drive comparing the
    viewer (702 px wide) with export's still (854) at y 0.5 read the 75%
    row in one and the 100% row in the other and looked like a 13% color
    shift. Sample off row boundaries; the two paths then agree to the
    level.
  - *Agents cannot space letters.* The text style schema has no
    `letterSpacing` (nor `lineHeight`), though the document does; the
    lower-third drive wanted tracked capitals. Left for the text work.
- **A blind test of the tools.** A fresh agent given only the MCP
  connection, through `scripts/mcp-web.mjs`, made a 15 s ad and a 15 s epic
  edit from the fixtures: 180 calls, both passing `check_project`, rated 5
  and 6 out of 10 (synthetic footage, and a mix it could not measure; the
  merged toolkits since add `measure_loudness`, ad end cards and a brand
  kit). Its findings, fixed:
  - `set_filter`, and `set_animation` on a picture, answered
    `unchanged` though they worked. `describe_project` showed no filter,
    and a picture has no `animIn` key until one is set. It shows both now.
  - App tools skipped argument checks: `preview_frame {time}` drew a
    black frame instead of an error. They are validated like commands
    now, and an unknown argument names the known ones.
  - A clip at 6.9 s for 2.05 s and the next at 8.95 s left one black
    frame between them, because each length was rounded on its own.
    Ends are rounded from start + duration now.
  - `batch` steps can name clips earlier steps added ("$1"), so a title
    and its animations are one call. An app tool in a batch says it runs
    on its own.
  - `add_voiceover` lines start on their words: the voice model pads
    about 0.5 s of silence, which put every reported time and caption
    early. A line's `caption` can differ from its words ("20% off").
  - Also fixed:
    - `add_sound_effect` takes a volume;
    - ducking ignores sound effects (12 "voices" were whooshes);
    - the keyframed-loudness refusal says what to do;
    - `preview_media` shows photos;
    - marker edits answer with the markers that changed, not all of them;
    - `slip_clip`;
    - epic hits are named like `add_effect`'s (rgbSplit, zoomBlur);
    - the ad playbook puts the grade's adjustment clip down before
      titles;
    - the epic playbook says how to make a drop in a flat loop;
    - the design rules stopped citing a file a client cannot read.
  - Not done: undoing a voiceover leaves its speech files in the library;
    beat markers outlive the music `fit_music` trims.
- **A second blind test, on the merged build.** Another fresh agent made a
  12 s 9:16 coffee ad and a 20 s epic edit: 245 calls, 6 errors, both
  checks passing. Its findings, fixed here (the rest in the next commit):
  - Effect parameters could not be changed. The guide said
    `effects.<index>.<param>`, but paths are stored by effect id, and
    `describe_project` showed no effect values, so every attempt answered
    `unchanged`. Paths now take the stack index, the id or the effect
    type. A wrong effect or parameter is an error that lists what exists,
    and `describe_project` shows each effect's values.
  - `check_project` measured a title's raster, margin included. An
    outline or shadow adds room for itself, so turning one on flagged a
    centered title and turning it off cleared it. The check measures the
    letters (with any box or outline) now, and each finding gives the
    measured box and which zone it crossed. The 9:16 zones are named:
    top 14%, bottom 35%, left 11%, right 19%.
  - Captions on 9:16 sat in the apps' caption zone, at y 0.36 or 0.25.
    On a tall canvas they now sit at y 0.05, wrapped to the column
    between the side rails, and the check covers captions.
  - **Smaller fixes:**
    - The size floor scales with the canvas: 40 px on a 1080 short side,
      which is size 23 on 9:16.
    - Countdown digits, half-beat cuts, and text on its own solid card
      are no longer flagged.
    - An export limited to -1 dBTP measured -0.9996 and failed its own
      check. The limiter now aims 0.1 dB under the ceiling, and the
      check compares at the precision it prints.
    - The server says up front when this build cannot export.
    - `move_track`, and `"$2.track"` in batch.
    - `add_sound_effect` answers where the sound landed, as `clip_id`
      like the rest of the API.
    - Kinetic presets are in the catalog.
    - The design rules give 9:16 text sizes.
    - The social-short playbook no longer sends a model to a UI tab.
  - `save_project_copy` saves the open project as a copy and opens it,
    for a version that needs hand work after `export_versions`.
- **Polish from the second blind test**, by a parallel agent:
  - **Versions:** `export_versions` lays out a group, such as an ad
    element, as one unit, anchored where it sat
    ([[ADR-063 Versions fit a group as one unit]]). A 9:16 end card's
    url, button and headline overlapped on 16:9, 1:1 and 4:5: text kept
    its size against the short side while its spacing stayed a fraction
    of the height.
  - **Ad elements:**
    - they hold the size floor (`minTextSize`, 40 px at a 1080 short
      side), and `check_project` uses the same floor;
    - the end card sits on the center line, the badge in its half;
    - text over footage gets a thin outline as well as its shadow;
    - the brand's label role went from 34 to 40.
  - **Duotone** follows the standard hue wheel; it ran backwards. Older
    projects' duotones look mirrored: hue h now looks as 360 - h did.
  - **`preview_frame` and the contact sheets** render through the export
    path at the width asked. They read the viewer's on-screen canvas,
    222 pixels wide on 9:16.
  - **`set_hsl` on an adjustment clip** worked all along: -30 is a 9
    degree turn. Its description says so now.

- **A launch film, edited through MCP** ([[Launch film through MCP 2026-10-18]]).
  The owner asked for a new, fully professional promo, made with the MCP
  tools, and for every limit met.
  - **The film:** 56 s, 1080p, -14.0 LUFS. Kinetic type on a dark,
    drifting light; UI footage in floating windows and macro push-ins;
    one feature a bar of an original 120 BPM track; an agent filling a
    timeline live; an end card. Two optional voiced versions (George,
    Heart) on project copies.
  - **How:** agents recorded crisp 2560x1440 footage of the web build
    (CC0 and public-domain demo media) and synthesized the music; the
    edit itself was about 90 MCP calls, most of them batches.
  - **Limits found**, each with a suggested fix in the note:
    - no soft light: blur tops out near 20 px, and there are no radial
      gradients;
    - one font weight, and one color per title;
    - no picture shadow or perspective;
    - `export_versions` cannot re-lay out keyframed precomps;
    - keyframes on paths that do not animate are accepted silently;
    - keyframe values are invisible in answers;
    - `analyze_music` misses a drop and a breakdown;
    - `check_project` reports contrast and shot counts it never looked
      at;
    - voice-to-music balance has to be computed by hand;
    - answers grow with compounds;
    - sound effects take one call each.

## 2026-10-18 — The second improvements branch and the website (Claude Code)

The owner asked for:
- a second improvements branch: the AI assistant's tab and prompt box
  fixed, an easy way to add the MCP server to the Codex CLI, and a pass
  over the whole app for bugs, missing features and the right icons;
- a product website, in its own folder beside the app.

Lanes ran in parallel worktrees, each with its own Vite port, and were
merged into `improvements-2` one at a time. Codex took three lanes from
written plans: engine, core fixes, and icons and layout. Its sandbox
cannot write the git index, so the lead reviewed, gated and committed
its work from the message it left.

- **The assistant docks as a column**
  ([[ADR-064 The AI assistant docks as a column the editor makes room for]]).
  - It was a drawer over the inspector, the zoom controls and the
    loudness meter. Now the editor lays out as if the window were
    narrower.
  - The prompt box grows to five lines beside a send button of the same
    height. Busy shows the steps and a Stop.
  - "Add to Codex" and "Add to Claude Code" run the CLI's own `mcp add`
    from Rust, never over an existing entry
    ([[ADR-065 One-click agent setup runs the agent's own CLI]]).
- **The launch film's MCP limits, acted on.** Keyframes are refused on
  paths that do not animate ([[ADR-066 Keyframes are refused where nothing moves and shown in answers]]).
  Answers show keys, there is one ease vocabulary, and edits answer only
  the compounds they changed. Sounds are placed in one call.
  - `check_project` measures the frame behind a title and the music's
    last seconds ([[ADR-068 check_project measures the picture and the sound it judges]]).
  - `export_versions` re-lays out keyframed windows
    ([[ADR-067 Versions lay keyframed motion out again around its rest]]).
- **Engine** (Codex) ([[ADR-074 Prepare preview decoders before their first visible frame]],
  [[ADR-075 Measure music structure and voice balance on the timeline]]):
  - the next clip's decoder is prepared before a cut, so a long-GOP
    stall fell from 628 ms to 38 ms;
  - `analyze_music` reports every drop and two-bar sections;
  - loudness is measured per track;
  - `duck_under_speech` meets a voice-over-music target.
- **Render** ([[ADR-069 Large blurs run on a downsampled pyramid]], [[ADR-070 Drop shadows are cast by the finished picture]],
  [[ADR-071 Keyed title styles redraw the title]]): every gap the launch film
  needed a sprite or a workaround for:
  - blur to a 300 px radius, with old projects pixel-identical;
  - radial and feathered shapes;
  - drop shadows;
  - font weights 100-900;
  - keyframed size, spacing and color on titles;
  - perspective tilt.
- **Core fixes from the audit** (Codex):
  - viewer clicks hit-test the clip under the pointer;
  - a shot can be dragged to the front;
  - the stray 0 is gone;
  - adding a title leaves the playhead where it was;
  - a music bed over several shots stays put;
  - a transition opens its settings;
  - agent edits get readable undo labels.
- **Editor UX** ([[ADR-072 One drag is one undo step and a typed value is kept]],
  [[ADR-073 Templates land as a block and the web keeps what it imports]]):
  - one slider or color drag is one undo step everywhere (the Duration
    slider made eight);
  - animation presets preview on pick, with tiles drawn from their own
    numbers;
  - templates land grouped above the footage;
  - typed values survive a click away;
  - the export dialog says what a 9:16 preset does on a 16:9 project;
  - web URL imports are kept in browser storage;
  - untouched new projects are discarded.
- **The website** ([[ADR-076 The website is a static Astro site that reads docs at build time]],
  [[ADR-077 The website deploys to GitHub Pages from main]]):
  - an Astro site in `openframe-website/`, in the app's own look, with
    the launch film, nine feature loops and a docs section rendered from
    `docs/`, including the searchable MCP reference;
  - full SEO, and Lighthouse 96-100 on mobile;
  - it sells the app as an open-source experiment, built and filmed by
    AI agents, and tells people to build it from source;
  - Pages deploys it only when the site or the docs change.

- **Icons and layout** (Codex):
  - one meaning-to-icon table, `docs/Icons.md`, applied across the app;
  - the trim tools are drawn instead of lettered;
  - Reset and Rotate, AI and effects, and snapping and tracking no
    longer share icons;
  - track headers show what they hold;
  - one empty state everywhere;
  - the library's tabs are all visible;
  - the inspector fits at 1100x680;
  - segmented controls take arrow keys;
  - toolbar buttons disable when they can't act.
- **Everyday features**:
  - rename clips and media;
  - a real About dialog, with credits generated at build time;
  - Go to start and Go to end, and a Preferences gear;
  - Recently deleted on Home, with Undo
    ([[ADR-078 Deleted projects wait in Recently deleted, marked in their summary]]);
  - a fuller clip menu;
  - audio scrubbing
    ([[ADR-079 Audio scrubbing plays snippets through the playback scheduler]]);
  - MP3 export, and captions burned in or written as an SRT beside the
    file ([[ADR-080 MP3 by LAME in WebAssembly, captions leave an export four ways]]).

- **One folder per project**
  ([[ADR-081 The app and the website each have a folder, the docs stay at the root]]).
  The editor moved into `openframe-application/`, beside `openframe-website/`,
  so neither project's tools reach into the other. `docs/` stays at the
  root for both, and its app paths are read as inside the app folder. CI
  runs the app's gates there and skips website-only changes.

### Lessons paid for in this round

- **Claude Code re-encodes a large image result to a 256-color PNG.** A
  tool image over 3.75 MB is shrunk to fit, and the palette bands skies.
  That was the "posterized" contact sheets: the frames were right. Sheets
  are JPEG at quality 0.98 now (0.92 blocked smooth gradients).
- **Full-range VP9 from screencast footage fails in Edge on Windows**
  (`PIPELINE_ERROR_DECODE`); convert it to limited-range BT.709.
- **Astro's HTML compression glues a word to a link** that starts on the
  next source line, so it is off. Inlining all CSS raised mobile
  blocking time from 0 to about 300 ms, so stylesheets stay external.
- **Merge the generated docs by regenerating them.** Lanes based on
  older commits all touched `MCP tools.md`, so it was regenerated after
  each merge rather than resolved.
- **A lane's drive can be right and still need updating.** Once the core
  fix returned the playhead after a preview, the UX lane's
  animation-presets drive expected the old place. A merge reruns every
  touched lane's drives, not just the newest one's.
- **The full drive run earns its hour.** Run after every merge, it found
  two real bugs no lane's own drives reached:
  - since 2026-10-13, a web tab closed between a save's two writes left a
    project Home could not list; Home now lists it from the project file;
  - rename's double-click on a media name took over list rows, whose
    double-click the user guide says adds the file.
- **Write edit scripts to files, and read them as UTF-8.** A Git Bash
  heredoc piped to Python collapsed doubled backslashes and was decoded
  as cp1252, which put mojibake in a doc.
