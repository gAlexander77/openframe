# OpenFrame - agent entry point

**Codex: start with [CODEX_GUIDE.md](CODEX_GUIDE.md)** — your task list,
rules and the current state.

Read [CLAUDE.md](CLAUDE.md) for the shared operating manual, then
[docs/Next agent handoff.md](docs/Next%20agent%20handoff.md) before continuing
development. These instructions apply to every coding agent, including
Claude Code and Codex.

- The product is **OpenFrame** (renamed 2026-10-17). The app identifier
  `com.alex.video-editor`, saved-data keys and `window.videoEditor` keep
  the old name on purpose; [docs/Renaming.md](docs/Renaming.md) says why.
- **Desktop first.** The web app is a secondary, client-only version; validate
  its capabilities separately. See ADR-003 and the handoff.
- The project uses **GPL-3.0-only**. Preserve third-party notices and follow
  [CONTRIBUTING.md](CONTRIBUTING.md).
- The repository is public (the owner opened it on 2026-10-17) at
  `gAlexander77/openframe`. Releases, installers and deployment still
  require a separate owner instruction.
- Respect existing work and active agents. Inspect status and worktrees,
  coordinate before overlapping edits, and do not stop their processes,
  reset their changes, or remove their worktrees.
- Every git worktree goes in
  `F:\Dev\2026\worktrees\<repo>\<branch-or-purpose>` (`<repo>` is `openframe`). Preview builds, source
  copies, logs, browser profiles, and other scratch for that work stay inside
  its worktree. Remove only your own worktree with `git worktree remove`
  after its work lands; never place one beside the repositories or in `%TEMP%`.
- Follow the owner's current commit instructions. The owner subsequently
  authorized local commits for the 2026-10-14 documentation handoff. This
  does not authorize pushing or publishing the project.
