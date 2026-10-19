# ADR-081: The app and the website each have a folder, the docs stay at the root

**Date:** 2026-10-18. **Status:** accepted.

## Context

The repository grew a second project: the product website (ADR-076),
an Astro site with its own `package.json`, lockfile and build. With the
app's `package.json`, `src/` and `src-tauri/` at the root, the site sat
inside the app's project. One `npm ci` could not tell which project was
meant. Agents working on the site and on the app reached for the same
root files, and a CI or Pages rule had to list paths to keep them apart.
The owner asked for one folder per application, so the two can't
interfere with each other.

## Decision

- **`openframe-application/`** holds everything the editor builds from:
  - `src/`, `src-tauri/`, `public/`, `scripts/` and `assets/`;
  - `index.html`, `package.json` and its lockfile, `tsconfig.json`,
    `vite.config.ts` and the `Justfile`;
  - the git-ignored `fixtures/`, `scratch/` and `node_modules/`, which
    sit beside it.

  Every app command (`npm ci`, `npm run tauri dev`, `just check`, the
  drives) runs there, unchanged.
- **`openframe-website/`** is the site, as ADR-076 placed it.
- **`docs/` stays at the root.** It documents both projects, the site
  renders pages from it at build time, and its wikilinks and the history
  in `History.md` stay where readers and links expect them. So do the
  repository's own files: README, LICENSE, CONTRIBUTING, AGENTS.md,
  CLAUDE.md, CODEX_GUIDE.md and `.github/`.
- **Paths in the docs stay app-relative.** `src/lib/ops.ts`, `scripts/drive/`
  and the like are inside `openframe-application/`. Every guide says so
  once, instead of rewriting hundreds of references, including dated
  research notes that describe the code as it was.
- **CI runs the app's gates in `openframe-application/`** and skips
  changes to the website alone. Pages builds only on site or docs changes
  (ADR-077).

## Consequences

- One test reaches outside the app: `mcpGuide.test.ts` keeps
  `docs/MCP tools.md` and `docs/Agent playbook.md` in step, as
  `../docs/`.
- An existing checkout needs `npm ci` in `openframe-application/` after
  the move. The old root `node_modules/` and `src-tauri/target/` are
  ignored leftovers that can be deleted.
- An MCP client registered before the move points at the old
  `src-tauri/target/` executable, which keeps working until that folder
  is deleted. Rebuild, then press Add to Codex or Add to Claude Code
  again (or edit the path) to use the new one.
- Worktree setup links `openframe-application/node_modules` and
  `openframe-application/fixtures/media` instead of the root ones.
