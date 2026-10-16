# Codex guide: start here

**Pickup status, 2026-10-15:** the eight original tasks and the captions/
project-lifecycle follow-ups are completed and committed locally. Read the
dated entries in section 7 for hashes, evidence, and remaining release work.

You are Codex, picking up OpenFrame from Claude Code on 2026-10-14. This file
tells you what to do, in order, and the rules that keep the project safe.
Read all of it before you change anything.

OpenFrame is a desktop-first video editor (Tauri 2 + Rust + React 19 +
TypeScript + WebGL2) modeled on CapCut, with a client-only web build. The
code still says "Video Editor" / `video-editor`; the rename is planned, not
done (`docs/Renaming.md`).

## 1. First ten minutes

1. Read `AGENTS.md`, `CLAUDE.md` and `docs/Next agent handoff.md`. They
   outrank this guide where they differ.
2. Run, in `F:\Dev\video-editor`:
   - `git status` (must be clean before you start)
   - `git log --oneline -15`
   - `git worktree list`
3. Skim `docs/Index.md`, `docs/Features.md`, `docs/Architecture.md`.

## 2. Rules (do not break these)

- **Work only in `F:\Dev\video-editor`, on `main`.** Commit locally after
  each task. **Do not push**, do not create branches on the remote, and do
  not change repository settings. The owner pushes after review.
- **Do not touch the parked work.** The worktrees under
  `F:\Dev\2026\worktrees\video-editor\` (`bg-removal`, `compound-clips`,
  `timeline-ux`) and their branches belong to Claude Code, who will finish
  them. Do not edit, merge, rebase, reset or delete them. Section 6 says
  what they hold, so you do not redo it.
- **Headless only.** The owner uses this computer (for games) while you
  work. Never open a visible browser, never launch the desktop app
  (`npm run tauri dev`, `video-editor.exe`, `tauri build`) unless a task
  here says so. Run drives with `scripts/drive/run.mjs`, which is headless.
  **Owner update, 2026-10-15:** the owner requested a desktop launch for
  personal testing, then explicitly prohibited computer/desktop control
  while they work. Use headless Playwright MCP for further verification;
  native input testing needs their separate test computer or new permission.
- **One dev server at most.** If port 1420 is already listening, it is this
  repo's Vite: reuse it. Check with
  `Get-NetTCPConnection -LocalPort 1420 -State Listen`. Start one with
  `npm run dev` only if nothing listens there.
- **Do not rename the app, change the app identifier
  (`com.alex.video-editor`), the license, or saved-data formats.** Those
  need the owner and a migration plan (`docs/Renaming.md` §1).
- **No new npm or cargo dependencies.** `scratch/` (git-ignored) may hold
  tools such as `playwright-core`.
- **Small commits, one intention each.** The message's first line says
  what changed; the body says **why**, and what you checked. Docs change in
  the same commit as the code they describe. Do not add the Claude
  `Co-Authored-By` / `Claude-Session` lines; those are Claude's.
- **Gates before every commit**, and read their exit codes (never pipe
  `tsc` into `tail`):
  - `npx tsc --noEmit`
  - `npm test`
  - only if you changed `src-tauri/`: `cargo fmt --check`,
    `cargo clippy --all-targets -- -D warnings` and `cargo test`, each with
    `--manifest-path src-tauri/Cargo.toml`
- **Verify UI work in the running web build** with a drive (section 3), not
  only with unit tests.
- **Line endings:** most files are LF; `.gitignore` is CRLF. Before
  committing, look at `git diff --stat`: a file showing every line changed
  means you rewrote its line endings. Fix that before committing.
- **House rules from `CLAUDE.md`:** American English; icons only from
  `src/icons/`; never type a keyboard chord in UI text (read it from the
  keymap); edits go through `edit()` in `src/state/actions.ts`; logic worth
  testing lives in `src/lib/` with a vitest file beside it; match the
  surrounding code's style and comment density.
- **When stuck** after two honest attempts on one problem: stop, revert your
  uncommitted changes to that task (`git restore` on your own files only),
  write what you learned in section 7, and move to the next task.

## 3. Tools and commands

| What | Command |
| --- | --- |
| Web dev server (port 1420) | `npm run dev` |
| Type check | `npx tsc --noEmit` |
| Unit tests (vitest) | `npm test` |
| Every gate (also builds, Rust too) | `just check` |
| Test media (into `fixtures/media/`, git-ignored) | `node scripts/make-fixtures.mjs` |
| Drive tool, once | `npm i --prefix scratch playwright-core` |
| Run a drive headless | `node scripts/drive/run.mjs scripts/drive/framecode.js` |
| Same, other window size | `... run.mjs scripts/drive/inline-text.js --size 1920x1080` |

A **drive** (`scripts/drive/*.js`) is one function, `async (page) => result`,
that opens the web app, does things through the UI or
`window.videoEditor` (see `src/automation.ts`: `exec`, `describe`,
`pixels`, `render`, `import`, `select`, `seek`), and returns `{ ok, details }`.
The app opens on the home screen, so a drive clicks `.create-card` first.
Copy the shape of `scripts/drive/ai-tools.js` for new drives. The runner
prints PASS/FAIL and writes the full result to `scratch/drive-<name>.json`.

Drives previously passing on `main` (2026-10-14): `framecode`, `ai-tools`,
`keyframes`, `color`, `stickers`, `speed`, `export`. `inline-text` now passes
all 38 checks at 1280x720, 1600x950 and 1920x1080 after task 8 (`173fe58`).
The added `timeline-menu`, `audio-fades`, `home-menus` and `audit-followup`
drives pass at 1600x950. On 2026-10-15, `web-capabilities` passed, including
captions, on unchanged `d717e35`. The new `caption-recovery` and
`project-lifecycle` drives pass too; see section 7 for the recovery fixes.

## 4. Project state, 2026-10-14

Everything below is on `main` and was checked in the running app:
editing (split, trim tools, magnet, linkage, keyframe graph, speed ramps,
reverse), WebGL compositor (effects, transitions, masks, chroma key, color
grading with LUTs, HSL, curves, wheels, scopes), text (presets, word art,
templates, typing on the canvas), stickers, auto captions (Whisper, local),
AI tools (remove silences, split scenes, beat markers, normalize loudness,
auto ducking), export (MP4/MOV/WebM/MKV, frame-exact), OpenTimelineIO
export, Copilot (local Ollama/LM Studio), an MCP server for outside agents,
and headless rendering (`--render`). `docs/Features.md` is the full list;
`docs/History.md` records every round and lesson.

At handoff, main already had the owner's local OpenFrame documentation and
`.gitignore` fix commits. Preserve them; the pickup commits are in section 7.

## 5. Your tasks, in order

Do them one at a time: finish, verify, commit, then start the next. Each is
small on purpose. If a task turns out larger than described, do the part
you can verify, commit it, and note the rest in section 7.

### Task 1: Web capability log (documentation and testing)

`docs/Next agent handoff.md` ("Browser development: log the uncertainty")
asks for a dated record of what the **web build** can and cannot do, so
nobody claims web parity without evidence.

1. Write `scripts/drive/web-capabilities.js`. Through `window.videoEditor`
   in the web build it checks, and returns as `details` (each with
   `ok: true/false` plus what it saw):
   - import from a URL (`/fixtures/media/h264-1080p30.mp4`) and that the
     asset survives a page reload (re-open the project from the home
     screen; the web build stores media in OPFS);
   - which fixtures decode: `h264-1080p30.mp4`, `hevc-1080p.mp4`,
     `vp9-opus.webm`, `h264-aac.mkv`, `prores-422.mov` (ProRes is expected
     to be refused with a readable message on the web; record the message);
   - export: `render()` to MP4 and to WebM (record codecs, size, seconds);
   - auto captions: run them on `speech-test.wav` (Captions tab, `.cap-go`)
     and record the text and time (the model downloads once; allow minutes).
2. Run it with the runner. Then create `docs/Web capability log.md`: a dated
   entry with the git revision (`git rev-parse --short HEAD`), Edge version
   (`(Get-Item "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe").VersionInfo.ProductVersion`),
   Windows version, each check's result, and limits. List as **not
   applicable on the web** (desktop only): FFmpeg proxies, the MCP server,
   headless `--render`. List as **untested**: the save-file picker (it needs
   a real click), other browsers, other operating systems.
3. Link the new page from `docs/Index.md` (Map of content).
4. Commit: "Log what the web build can do, with evidence".

### Task 2: Right-click on the empty timeline (UX-27)

`docs/UX audit 2026-10-14.md`, UX-27: right-clicking the timeline background
shows the browser's own menu (Back, Refresh, Print...), which looks like a
web page. CapCut shows its own menu there.

- Clips get their right-click menu through `onContextMenu` in
  `src/components/ClipView.tsx` (handled in `src/components/Timeline.tsx`,
  around line 721) and the `Menu` component in `src/components/Menu.tsx`.
- On the timeline background (not on a clip): prevent the native menu and
  open the app's menu with **Paste** (disabled when nothing is copied),
  **Add marker** (at the clicked time), **Select all**. Use existing
  actions through `run(id)` from `src/state/actions.ts`; look up action ids
  in `src/lib/keymap.ts`.
- Text fields must keep their native menu.
- Verify with a small drive (`scripts/drive/timeline-menu.js`): right-click
  empty timeline space with `page.mouse.click(x, y, { button: "right" })`,
  check the app menu is visible (`.menu`), click Add marker, check
  `window.videoEditor.describe().markers` grew by one.
- Set UX-27's **Status** in the audit doc to fixed, with what you checked.

### Task 3: Fade knobs clear of the clip label (UX-35)

Audio clips on the timeline have fade-in/out knobs drawn on top of the clip
name and duration. Move the knobs to start below the label band (CSS in
`src/components/timeline.css`, markup in `ClipView.tsx`). Check with a
headless screenshot of an audio clip (import `music-30s.mp3`, add it) and
look at the image. Update UX-35's status.

### Task 4: Menus on the home screen (UX-29)

On the home screen the Edit, Timeline and View menus act on a project that
is not open. In `src/components/TitleBar.tsx`, when `props.home` is true,
show only two menus: File (New project and Open project; no Import, Save
or Export) and Help (Shortcuts and About). "About" currently does nothing: make it show a small
toast with the app name and version (`APP_NAME`, `__APP_VERSION__`). Verify
with a drive that opens each menu on Home. Update UX-29's status.

### Task 5: Check two audit findings that later work may have fixed

- **UX-28** (effect and transition cards look identical at rest): the
  stickers round added engine-drawn previews. Open the Effects and
  Transitions tabs in a headless drive, screenshot them, and look: if cards
  now differ at rest, mark UX-28 fixed (name the commit or ADR-026).
- **UX-34** (double-click on the viewer goes full screen): the inline-text
  round made double-click on text edit it. Check double-click on text
  (edits) and on empty viewer (full screen, which is fine). Mark it.

### Task 6: License metadata (release preparation, first checkbox)

`docs/Release preparation.md`, "Next implementation tasks", first item: set
`"license": "GPL-3.0-only"` in `package.json` and `license = "GPL-3.0-only"`
under `[package]` in `src-tauri/Cargo.toml`. Run all gates including cargo.
Tick that checkbox in the doc and say what you changed. Do not touch the
other checkboxes.

### Task 7: Third-party license inventory (documentation only)

Release preparation needs to know every dependency's license. Write a small
script in `scratch/` (not committed) that lists:
- each package in `node_modules` that ships in the app (the `dependencies`
  in `package.json` and their transitive deps; `npm ls --omit=dev --all
  --json` gives the tree) with its `license` field;
- each crate from `cargo metadata --format-version 1 --manifest-path
  src-tauri/Cargo.toml` with its `license` field.

Write the result to `docs/Third-party licenses.md`: a table per ecosystem
(name, version, license), and at the top a short list of anything that is
**not** MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, MPL-2.0 or 0BSD, for the
owner to review. Do not judge GPL compatibility yourself; just flag. Link it
from `docs/Release preparation.md`.

### Task 8 (optional, harder): two-line text alignment in the canvas editor

The inline text editor (`src/components/TextEditor.tsx`, layout math in
`src/lib/textBox.ts`, ADR-030) puts a transparent textarea over the engine's
rendered text. `scripts/drive/inline-text.js` measures how well the
textarea's glyphs sit on the engine's.

- `node scripts/drive/run.mjs scripts/drive/inline-text.js --size 1280x720`:
  all 38 checks pass.
- `--size 1600x950` and `--size 1920x1080`: the "two lines" checks fail
  with every line about 1.6 px too high, sometimes also "turned 15 degrees".
  Single-line checks pass.
- What changed: the viewer now fits its picture inside the stage's content
  box (`src/components/Player.tsx`, `.player-stage` padding in
  `player.css`), so the viewer's zoom differs from when the editor was
  measured.

Find the real cause (something that depends on zoom **and** on line count:
raster height rounding for multi-line text in the rasterizer
`src/engine/text.ts`, line-height snapping in the textarea, or the
measurement in the drive itself). Do not add a constant fudge. Done when all
38 checks pass at all three sizes. If two attempts do not find it, write
your findings in section 7 and stop this task.

## 6. Parked work (for Claude Code, do not touch)

Each is a branch with a worktree under `F:\Dev\2026\worktrees\video-editor\`,
committed as WIP and pushed to GitHub as backup. All type-check and pass
their unit tests; none is finished.

| Branch | What is done | What is left |
| --- | --- | --- |
| `timeline-ux` | UX-14 (linkage follows the shot under most of a clip), UX-12 (drop above the tracks makes an overlay) | UX-13 drop preview (in progress), UX-15 (new title invisible), the drive |
| `compound-clips` | research note, format and ops, plan and audio resolution (in progress) | UI (open, breadcrumb, break apart), commands, ADR-037, drive |
| `bg-removal` | matte pipeline and tests, worker, compositor and plan support, inspector toggle, AI tools card, commands | ADR-032/033 (model choice and license), running the drive, desktop check |

## 7. Codex log

Append dated notes here: what you finished (with commit hashes), what you
found but could not fix, and anything the next agent must know.

- 2026-10-14: guide written by Claude Code. Main at the `.gitignore` fix
  commit plus this guide's commit.

### 2026-10-14 — Codex pickup completed

Worked on `main`, reusing the existing Vite server. All changes were committed
locally; nothing was pushed, published, renamed, or changed on the remote.
The three parked Claude Code worktrees and branch heads remain untouched.
All browser checks were headless; no desktop app UI was launched.

| Task | Commit | Result and evidence |
| --- | --- | --- |
| 1. Browser capability log | `6c5374b` | [Web capability log](docs/Web%20capability%20log.md) records Edge 155 / Windows 11 at `7243fb6`. URL and local-file reload persistence, four decode fixtures, readable ProRes refusal, and short MP4/WebM exports verified. Captions stalled twice; see below. |
| 2. Timeline background menu | `c9e3040` | `timeline-menu` passed: clipboard-aware Paste, marker at clicked time (including beyond the last clip), undo, Select all, clip/marker menus, and native text menus. UX-27 updated. |
| 3. Audio fade knobs | `0397787` | `audio-fades` passed; screenshot inspected. Knobs clear the label at rest and on hover. UX-35 updated. |
| 4. Home menus and About | `fe4ca63` | `home-menus` passed: only File and Help on Home, appropriate items, About toast, Shortcuts, full editor menus preserved. UX-29 scoped status updated; lifecycle follow-up below. |
| 5. Existing preview/text behavior | `9622422` | `audit-followup` passed; Effects and Transitions screenshots inspected, all 39 rest previews distinct. Text double-click edits; empty viewer double-click enters full screen. UX-28/34 updated, citing ADR-026/030/031. |
| 6. GPL metadata | `94ea867` | `GPL-3.0-only` in npm/Cargo manifests and npm lockfile root. Only the first release checkbox was checked. Rust formatting, clippy with warnings denied, and all 28 Rust tests passed. |
| 7. Dependency license declarations | `6400a30` | [Third-party licenses](docs/Third-party%20licenses.md) inventories 52 production npm packages and 420 Cargo packages at `94ea867`. Flagged declarations need owner review; no GPL compatibility judgment. Inventory tooling/data remain git-ignored in `scratch/`. |
| 8. Preview text alignment | `173fe58` | All 38 `inline-text` checks passed at each of 1280x720, 1600x950 and 1920x1080. Editor now uses the player's actual raster target; screenshot crops use integer bounds. ADR-030 records the cause and evidence. |

TypeScript and all 341 frontend unit tests passed before every task commit.
New drives are in `scripts/drive/`; JSON results and screenshots stay local
in their ignored output directories. UI checks validate the browser build,
not desktop parity.

**Follow-ups recorded on 2026-10-14** (see the next dated entry for updates):

- Captions: both five-minute attempts on `speech-test.wav` using Whisper
  tiny English produced no text. The second remained at download progress
  0% after 300,297 ms and recorded an aborted request for Vite's optimized
  `@huggingface_transformers.js`. Inspect worker module loading and model
  initialization; the capture does not establish the cause. No captions or
  worker implementation was modified. The capability drive intentionally
  continues to report this as a failed verification.
- UX-29 lifecycle: the requested Home menu scope/About fix is complete.
  New/Open still use the existing Home routing; actual creation/selection
  uses the Create project and project cards. A separate change should decide
  what those menu and keyboard entry points do while already on Home.
- Release review: license declarations are an inventory, not artifact notices
  or compatibility clearance. Keep the other release checkboxes open and
  review binaries/WASM, models, fonts, icons and media separately.
- Desktop checks, the coordinated OpenFrame runtime/data migration, parked
  feature work, and any public release remain outside this pickup.

### 2026-10-15 — captions and project lifecycle follow-ups

- **`602ee56` — caption worker recovery.** The full web capability drive
  passed on unchanged `d717e35`: Whisper tiny English generated five captions
  in 7,600 ms. The earlier stall's cause remains unknown. Separately,
  aborting the worker module request reproduced an indefinite wait.
  Caption RPCs now reject worker startup/message errors and cancellation;
  failed/canceled workers are terminated and recreated on retry. Five new
  unit tests and `caption-recovery` verify error handling, cancel during a
  held module load, and a successful real-model retry. The [web capability log](docs/Web%20capability%20log.md)
  and ADR-007 record the evidence and limits.
- **`6c208ce` — New/Open project actions.** New saves the current project
  and creates a project; Open saves and focuses the Home project search.
  Menu and keyboard entry points work on both screens, including while
  Home's search has focus. Only project entry/Help shortcuts act on Home.
  Failed saves keep the current project open for New, Open and Back to home;
  explicit Save no longer reports success after failure. `project-lifecycle`
  passed 15 checks covering persistence, saved-project reopening, repeated
  Open, menu/shortcut entry points, injected write failures, recovery, and
  ignored Home editing/playback. `home-menus` also passed. UX-29 and the
  user guide are updated.

TypeScript and all **346 frontend unit tests** passed before both code
commits. No Rust files changed in this continuation. The existing Vite
server was reused; all browser runs stayed headless. All commits remain
local, with the parked worktrees and remote settings untouched.

**Still pending:** desktop verification, the coordinated runtime/data
rename, and the artifact/license/source-distribution checks in
`docs/Release preparation.md`. The dependency declarations are not release
clearance. Other browsers/operating systems and offline speech-model cache
reuse remain untested. No public release or remote operation is authorized.

### 2026-10-15 — desktop header follow-up

The owner requested full-header dragging and double-click maximize/restore,
plus small, documented fixes for related issues. The header now uses Tauri's
deep drag region; menus and inputs retain their actions. Fifteen headless
Playwright MCP checks passed against the installed Tauri drag script with
simulated IPC; see [Driving the app](docs/Driving%20the%20app.md). Native
movement is pending owner testing. The owner explicitly stopped desktop
automation during this work; use headless Playwright MCP going forward.
TypeScript and all 346 frontend tests passed before the drag-region commit.

- `39ec821`: full-header drag/double-click region, menu exclusion, owner
  automation restriction and 15 passing headless header checks; the existing
  Home menus drive also passed through Playwright MCP.
- `cc2d077`: the adjacent maximize control now follows the window's actual maximized
  state on mount and resize, changing its icon and label to Restore. The
  expanded headless header drive passed 20 checks. TypeScript and all 346
  frontend tests passed before this follow-up commit.
- Window-control mouse presses now preserve typing focus. The headless
  reproduction lost Home search focus and further text before the fix; all
  26 expanded header checks now pass, including rename cancellation and
  keyboard activation. TypeScript and all 346 frontend tests passed before
  this separate focus-fix commit. Native movement remains for owner testing.

### 2026-10-15 — effect workflow improvements

The owner requested useful additions from other video editors after asking
how to remove an effect. [[Effect workflow]] in `docs/research/` records the
Premiere/Kdenlive references and choices. Work stayed on main; parked
branches, runtime identity and remote settings are unchanged.

- `f9ce2f9`: Effects has its own inspector tab and applied count; tabs wrap
  at narrow widths. Seven headless MCP checks cover video/audio/transition
  tab fit, disable/remove/undo and color controls at 1600×950 and 1100×680.
- `e71c31b`: effect reorder/reset/clear and bulk enable/disable, a named
  `edit_effects` command, defaults for automation-added effects, and effect
  IDs in project descriptions. Text/caption stacks are exposed too. Ten
  MCP checks include rendered-pixel differences after reordering and undo.
- Copy/Paste effects now appends independent animated stacks to one or
  several eligible clips, preserving other settings and the normal clip
  clipboard. `copy_effects` gives agents the same operation. Eight MCP
  checks and five additional unit tests cover paste and animation behavior;
  ADR-038 records the timing/identity decision.

TypeScript and all 358 unit tests passed at the end of the pass. UI checks
used isolated headless Playwright MCP, with screenshot review; no desktop
control or native-platform verification. No Rust files changed. Future
effect presets/selective Paste Attributes are proposals, not shipped features.

### 2026-10-15 — navigation and composition follow-up

The owner requested more research and additions. [[Navigation and composition]]
in `docs/research/` records the comparison and next candidates. Viewer guides
now offer safe margins, thirds or both in the Player header and View menu.
Eleven headless Playwright MCP checks passed, including portrait/full-screen
geometry and identical engine pixels/exported PNGs with guides on/off.
TypeScript and all 358 unit tests passed; the screenshot was reviewed. Guides
are session UI state, with no new saved-data fields or native desktop control.

- `f49e66c`: composition guides and the research note above.
- Marker management now has a searchable/color-filtered list, exact position
  and note editing, undoable deletion, and ruler double-click entry. Commands
  expose the same edits and descriptions include marker IDs. A marker beyond
  the movie's end remains reachable without extending export duration. Marker
  edits preserve gaps, and the active library tab stays visible after resize.
  All 23 `markers` drive checks and nine `timeline-menu` regression checks
  passed through headless MCP; screenshot reviewed. The latter drive now
  declares its 1600×950 viewport explicitly so MCP's smaller default cannot
  put its coordinate-based clicks outside the visible timeline. TypeScript
  and all 367 tests passed. Timecode parsing also rejects nonexistent
  drop-frame labels and oversized values rather than moving a note silently.
- `d9b8596`: the marker management change above.
- Marker export now saves the displayed search/color subset as timecoded
  notes or chapter descriptions, with a preview and chapter timing checks.
  It uses the existing platform file-export boundary, keeps full-timeline
  timestamps and leaves project/history unchanged. Eleven headless MCP
  checks cover real TXT download contents, cancellation and write-error
  recovery, filters, timing issues and keyboard isolation. Seven new pure
  formatting tests cover fractional/NTSC times, long timestamps and invalid
  chapter sets. Native save-picker verification remains for the owner.
  TypeScript and all 374 tests pass. The marker drive now waits for the
  editor to finish opening before comparing reloaded notes; reading the
  store immediately after clicking a Home card could race async loading.
