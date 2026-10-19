# OpenFrame — agent operating manual

A desktop-first video editor (Tauri v2 + Rust + React 19 + TypeScript) with a
client-only web build. CapCut's ease with VEGAS/Premiere depth. Everything
runs on the user's hardware; there is no server of ours (ADR-003). The owner
selected **OpenFrame** on 2026-10-14 and the app, binary, packages and repo
were renamed on 2026-10-17; the app identifier and saved-data keys keep the
old name on purpose. Read `docs/Renaming.md` before touching identity
strings.

## Read before resuming — 2026-10-14 owner handoff

Read `AGENTS.md` and `docs/Next agent handoff.md` before continuing previous
work. The owner reaffirmed **desktop first**, selected **GPL-3.0-only**, and
asked for the coordinated rename to be documented for the next pickup.
The repository is public at `gAlexander77/openframe` (renamed from
`video-editor` and opened by the owner on 2026-10-17); packaged releases and
deployment need a separate owner instruction.

This handoff changes documentation/licensing only. Preserve the paused
Claude Code work, other agents' worktrees, and any pending changes.
Do not stop their processes or clean their state. The owner subsequently
authorized local commits of this documentation pass; pushing and publication
remain unrequested. The new README, `CONTRIBUTING.md`,
`docs/AI development.md`, `docs/User guide.md`, and
`docs/Release preparation.md` provide the public-facing context and remaining
work; they do not mean the app has already been renamed or released.

## The workflow rules

1. **Few commits, each a finished piece of work, message says why.** One
   commit per feature (or per batch of related small changes, such as a
   round of fixes), never one per step: the owner found 160 commits in a
   day too many (2026-10-16) and squashed them by area. The body says why
   each part changed and what was checked, so the reasoning stays readable.
   Docs land in the same commit as the code they describe.
2. **Document every lesson.** What we learn about the products we imitate
   (CapCut, VEGAS, Premiere, Resolve) and the platforms (WebCodecs,
   WebView2, Tauri) goes in `docs/` — research notes, ADRs, History — so no
   lesson is paid for twice. Non-obvious decisions get an ADR (next number).
3. **Gate before committing:** `npx tsc --noEmit`, `npm test`, and for Rust
   `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`,
   `cargo test` (all via `just check`).
4. **Verify in the running product**, not just tests: the web build through
   the Playwright MCP tools, the desktop app over WebView2's debug port
   (`docs/Driving the app.md`). Playwright is for the product, never for
   research.
5. **Worktrees** live in `<worktrees>\openframe\<purpose>` (the folder is in
   the git-ignored `CLAUDE.local.md`, with this machine's other paths) and
   are removed (`git worktree remove`) when their work lands.
6. Open-source projects are consulted only if widely used, only for lessons,
   never as the product model.

## Architecture in one paragraph

The app is in `openframe-application/`: run every app command there, and
read `src/`, `scripts/`, `src-tauri/` and `fixtures/` paths in these docs
as inside it. The website is `openframe-website/`; `docs/` at the root
serves both ([ADR-081](docs/decisions/ADR-081%20The%20app%20and%20the%20website%20each%20have%20a%20folder,%20the%20docs%20stay%20at%20the%20root.md)).

One project document (`src/lib/project/types.ts`, ADR-004: integer frames,
rational fps) edited by pure ops (`ops.ts`) through one store with snapshot
undo (`src/state/store.ts`, ADR-005). Every edit is also a named command with
a JSON Schema (`src/lib/commands.ts`, ADR-006) — the surface for the AI
assistant, `window.videoEditor` (`src/automation.ts`), the MCP server
(`src/lib/mcp.ts` + `src-tauri/src/mcp.rs`, ADR-008/009) and the headless
renderer (`--render`, ADR-029); see `docs/Automation.md`.
The media engine lives in the webview (ADR-002): `src/lib/render/plan.ts`
decides what is on screen at a frame (pure, tested); `src/engine/` decodes
(mediabunny, one cursor per clip), composites (WebGL2) and plays sound (Web
Audio, the audio clock is master). Platform differences sit behind
`src/platform/` (ADR-003). UI is CapCut's four panels: library, player,
inspector, timeline. Full map: `docs/Architecture.md`.

## House rules

- **American English** everywhere (color, behavior, canceled).
- **Icons come from `src/icons/`** — never an inline `<svg>` or a unicode
  glyph as a button face. Follow the meaning-to-icon mapping in [docs/Icons.md](docs/Icons.md).
- **No chord typed in UI prose** — read it from the keymap (`chordFor`,
  `tipFor`).
- **Logic worth testing lives in `src/lib/`** with a vitest beside it.
- **Every VideoFrame/VideoSample has one owner and is closed exactly once.**
- **Every edit path goes through `edit()` in `src/state/actions.ts`** (or
  `store.edit`) so the magnet and linkage apply consistently.
- **`ponytail:` comments** mark deliberate shortcuts with their ceiling.
- **New editing features add a command** to the registry in the same change.

## Dev loop

- `npm run dev` serves the web build on :1420 (strictPort). If the port is
  taken, find the owner (`Get-NetTCPConnection -LocalPort 1420`) and only
  reuse or kill *this repo's* Vite.
- `npm run tauri dev` runs the desktop app (Rust + the same Vite).
- `node scripts/make-fixtures.mjs` regenerates test media in
  `fixtures/media/` (gitignored); `scripts/drive/*.js` are Playwright drives
  (`async (page) => ({ ok, details })`). Run one headless with
  `node scripts/drive/run.mjs scripts/drive/<name>.js` (once:
  `npm i --prefix scratch playwright-core`), or through the Playwright MCP
  tool's `filename` parameter (drives name the checkout `__REPO__`, which
  run.mjs fills in; replace it yourself there). Browsers run headless: the
  machine stays in use while agents work. The app opens on the home screen: click
  `.create-card` before touching the editor.
- Parallel agents: one Vite port each (1420 is main's), at most one dev
  server and one browser per agent — the machine runs out of memory with
  five agents each holding both.
- Commit trailers: end messages with the Co-Authored-By and Claude-Session
  lines the session provides.
