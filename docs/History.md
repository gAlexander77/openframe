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
