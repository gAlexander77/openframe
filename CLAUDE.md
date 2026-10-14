# Video Editor — agent operating manual

A desktop-first video editor (Tauri v2 + Rust + React 19 + TypeScript) with a
client-only web build. CapCut's ease with VEGAS/Premiere depth. Everything
runs on the user's hardware; there is no server of ours (ADR-003). "Video
Editor" is a placeholder name — read `docs/Renaming.md` before touching any
identity string.

## The workflow rules

1. **Small commits, one intention each, message says why.** The owner reads
   history to learn the reasoning behind every choice. Docs land in the same
   commit as the code they describe.
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
5. **Worktrees** live in `F:\Dev\2026\worktrees\video-editor\<purpose>` and
   are removed (`git worktree remove`) when their work lands.
6. Open-source projects are consulted only if widely used, only for lessons,
   never as the product model.

## Architecture in one paragraph

One project document (`src/lib/project/types.ts`, ADR-004: integer frames,
rational fps) edited by pure ops (`ops.ts`) through one store with snapshot
undo (`src/state/store.ts`, ADR-005). Every edit is also a named command with
a JSON Schema (`src/lib/commands.ts`, ADR-006) — the surface for the AI
Copilot, `window.videoEditor` (`src/automation.ts`), the MCP server
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
  glyph as a button face.
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
  (`async (page) => ({ ok, details })`), run via the Playwright MCP tool's
  `filename` parameter or with `playwright-core` and the system Edge
  (`chromium.launch({ channel: "msedge" })`). The app opens on the home
  screen: click `.create-card` before touching the editor.
- Parallel agents: one Vite port each (1420 is main's), at most one dev
  server and one browser per agent — the machine runs out of memory with
  five agents each holding both.
- Commit trailers: end messages with the Co-Authored-By and Claude-Session
  lines the session provides.
