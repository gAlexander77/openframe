# Renaming the application

## Owner decision - 2026-10-14

The owner selected **OpenFrame** as the product name and asked for a
documentation handoff so the next AI agent can rename the entire project.
Use **OpenFrame** in display text and `openframe` for the intended
package/binary/repository slug. This pass updates documentation only; the
runtime rename is pending. See [[Next agent handoff]].

Current repository: [gAlexander77/video-editor](https://github.com/gAlexander77/video-editor).
The intended future repository name is `gAlexander77/openframe`; that
remote rename has not happened and needs a separate owner instruction.
Keep the repository private. The approved brand does not authorize
publication, deployment, new hosting, or deleting legacy saved data.

Desktop-first development and the shared platform seam remain in effect
(ADR-003). Original code and documentation use GPL-3.0-only. Consult
[[Release preparation]] when changing license metadata or packaging.

## 1. The bundle identifier moves every user's data — read first

`src-tauri/tauri.conf.json` → `"identifier": "com.alex.video-editor"`.

Tauri derives the app config, data and cache directories from the identifier,
so on Windows that string *is* the folder (`%APPDATA%\com.alex.video-editor`).
Changing it alone makes an install look factory-fresh: projects, settings,
recent work and autosaves can be orphaned. The display-name rename can
retain the legacy identifier. If the identifier changes, implement a
one-time, idempotent migration with backup and recovery before shipping it
(TermHQ's `migrate.rs` is a reference). `com.alex.openframe` is a candidate
new identifier, not a setting changed by this documentation pass.

Inventory app data, app config, caches, project summaries, `.json.bak`
backups, proxies, model downloads, and MCP configuration. Preserve originals
until a successful migration is verified; do not overwrite newer files in
the target directory. The MCP stdio bridge independently hard-codes the
old identifier in `src-tauri/src/mcp.rs`, so changing Tauri's setting alone
can also break token discovery. Test migrated and fresh installations.

The current web implementation keeps media and project JSON in the origin's
OPFS `media` and `projects` directories (`src/platform/web.ts`), with
preferences in localStorage. There is no project IndexedDB database name
to rename in that module. A product display-name change does not require
renaming those directories. Changing origin, storage keys, or directory
layout requires an explicit transfer/migration plan; a new origin cannot
automatically read the old origin's storage. Verify existing project reload
and original media references on the secondary browser target.

## 2. Find-and-replace sites

| Site | What |
|---|---|
| `src/lib/brand.ts` | `APP_NAME` -> `OpenFrame`; keep accepting `.vedproj` if a new extension is introduced |
| `src-tauri/tauri.conf.json` | `productName` / window `title` -> `OpenFrame`, `mainBinaryName` -> `openframe`; handle `identifier` separately (§1) |
| `src-tauri/Cargo.toml` | package `name` -> `openframe`, description, lib name -> `openframe_lib`; license metadata -> `GPL-3.0-only` |
| `src-tauri/Cargo.lock` | Regenerate the root package identity through Cargo; preserve unrelated dependency versions |
| `src-tauri/src/main.rs` | Both `video_editor_lib::run()` and `run_mcp_stdio_bridge()` references |
| `src-tauri/src/lib.rs`, `render.rs`, `mcp.rs` | Executable examples, errors, bridge config identifier and automation references |
| `src-tauri/src/ffmpeg.rs` | Introduce an OpenFrame override if needed; keep reading `VIDEO_EDITOR_FFMPEG` with documented precedence |
| `src/components/AgentsSection.tsx` | Generated `claude mcp add` server name and connection examples |
| `src/automation.ts`, scripts and tests | `window.videoEditor` is an existing public surface; introduce any new alias without breaking clients |
| `package.json`, `package-lock.json` | package identity -> `openframe`, license metadata -> `GPL-3.0-only`; keep npm `private: true` unless npm publishing is requested |
| `index.html` | `<title>` |
| `public/favicon.svg`, `assets/app-icon.svg`, `src-tauri/icons/` | Review identity/artwork; regenerate Tauri icons only if artwork changes |
| `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `Justfile`, `docs/` | Current titles, examples, repo links, operating instructions and credits; retain truthful historical context |
| Build/release scripts and generated installers | Binary names, install/uninstall behavior, shortcuts, output filenames, source and license notices |
| GitHub repository | Planned slug `gAlexander77/openframe`; keep the current URL until the remote is actually renamed, then update links and verify redirects |

## 3. Implementation sequence for the next agent

1. Inspect the live tree and all active worktrees. Coordinate overlapping
   edits with the resumed agent; do not assume this inventory is exhaustive.
   Search tracked files for `Video Editor`, `video-editor`, `video_editor`,
   `VIDEO_EDITOR`, `vedproj`, and `videoEditor` before and after the change.
2. Rename display strings and internal package/crate references together,
   keeping the shared desktop/web engine unchanged. Update manifests and
   locks without broad dependency upgrades. Existing project IDs and media
   paths are data, not branding strings to replace globally.
3. Preserve the app identifier initially, or complete the migration in §1
   with backup and recovery evidence. Keep old extension support, old
   environment-variable fallback, and the existing automation alias.
   Document any new executable name and the transition for scripts/MCP
   clients; do not silently break `video-editor --render` integrations.
4. Update current documentation, generated connection instructions, and
   release credits. Historical ADRs and history can retain the old name with
   dated context. Do not claim the remote URL or public release changed
   before the corresponding operation is authorized and completed.
5. Run the quality gates and the compatibility checks below. Record the
   remaining legacy strings and why they are intentionally retained.

## 4. Acceptance and compatibility checks

- Run `just check`, build the desktop release, and inspect its actual app
  title, executable identity, icon, and installer behavior.
- Open a pre-rename desktop project, find its home-screen entry, retain
  its media/proxies, save, restart, reopen, and export. Verify backups and
  migration recovery as well as a fresh install.
- Verify Copilot, local MCP HTTP and stdio, and headless rendering against
  the renamed release. Check token discovery and existing client scripts.
- Verify old FFmpeg override names, automation aliases, and project-file
  extensions still work where those interfaces exist.
- Verify the secondary web build's import, OPFS save/reload, preferences,
  and export. A renamed title must not erase browser work; log browser-only
  limitations in [[Features]] and [[User guide]].
- Check current repo links and contribution/license documents. Keep GitHub
  visibility private and leave remote operations pending owner instruction.
