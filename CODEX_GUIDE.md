# Codex guide: start here

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

Drives that pass on `main` today (2026-10-14): `framecode`, `ai-tools`,
`keyframes`, `color`, `stickers`, `speed`, `export`. `inline-text` fails 3–4
alignment checks at 1600x950 and larger (task 8).

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

Main has two local commits the owner has not pushed yet: the OpenFrame
documentation handoff and a `.gitignore` fix. Leave them as they are.

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
