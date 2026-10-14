# Next agent handoff - OpenFrame

**Updated:** 2026-10-14. This is the current owner direction for the next
Claude Code or Codex pickup. Read it before resuming previous tasks.

## Decisions and scope

- The chosen product name is **OpenFrame**, spelled as one word with capital
  O and F. Use `openframe` for the intended package/binary/repository slug.
- Current repository: [gAlexander77/video-editor](https://github.com/gAlexander77/video-editor).
  A future `gAlexander77/openframe` repository name is planned, not completed.
- The owner selected GPL-3.0. The root LICENSE and README apply
  **GPL-3.0-only** to original code and documentation.
- **Desktop first** remains the priority. The owner explicitly clarified
  this after discussing the web development process. ADR-003 still applies.
- Keep the repository private. Do not publish, deploy a hosted app, change
  GitHub visibility, rename the remote repository, or create a public release
  without a separate owner instruction.
- This handoff was a documentation/licensing pass. App code, configuration,
  manifests, locks, automation names, saved data, and existing agent work were
  left untouched. The owner subsequently authorized local commits of this
  documentation pass. Pushing and publication remain unrequested.

## Preserve the paused work

The owner reported that Claude Code had exhausted its usage allowance and
asked that its work not be interrupted. Do not infer that paused worktrees
are abandoned. Inspect current status, history, and worktree changes before
editing. At inspection, main was `1af6774` and the worktrees included
`bg-removal`, `compound-clips`, `inline-text`, and `timeline-ux`; this is a
dated observation, not a claim about their current progress.

Do not stop agent sessions, dev servers, browser sessions, or desktop apps
to make room for unrelated work. Do not reset, merge, commit, delete, or clean
another worktree without coordinating its ownership and current state.
Keep your own worktree and all scratch under
`F:\Dev\2026\worktrees\<repo>\<purpose>` and remove it when its work lands.

## Codex pickup (added 2026-10-14 by Claude Code)

Codex starts from `CODEX_GUIDE.md` at the repository root: rules, the
headless drive runner, an ordered list of small tasks, and the parked
branches it must not touch (`bg-removal`, `compound-clips`, `timeline-ux`,
all committed as WIP and pushed as backup; the `inline-text` worktree is
merged and removed).

## Pickup order

1. Read `AGENTS.md`, `CLAUDE.md`, [[Index]], and the current worktree status.
   Preserve the documentation handoff and any pending changes. Coordinate
   with the resumed agent before overlapping
   edits or starting the implementation rename.
2. Follow [[Renaming]] to rename the entire project in a controlled change.
   Start with the identity inventory; preserve old projects and automation.
   Changing the app-data identifier needs migration and recovery evidence.
3. Follow [[Release preparation]] to complete licensing metadata, dependency
   and asset notices, reproducible source builds, and distribution documents.
   The GPL file is in place; this does not mean an installer is ready to ship.
4. Continue desktop development and desktop verification. Log the secondary
   web-app capability findings described below before making parity claims.

## Browser development: log the uncertainty

The owner was unsure whether a change to the web development process would
work and then confirmed **desktop should be first**. No browser-first switch,
server backend, new hosting target, or promise of complete web parity was
approved.

Use the existing web build as a secondary target and a useful shared-UI
development surface. A browser-only test does not validate desktop behavior.
After the relevant desktop workflow works, record whether its web counterpart
works, needs a browser-specific fallback, or remains desktop-only. In a dated
entry, record the tested revision, browser/OS, media/codec, result, and limits.

Initial checks to log: OPFS import and reload persistence, save/export picker
and download fallback, decode and encode availability, memory behavior with
large files, captions/model loading, and the desktop-only FFmpeg and local
MCP paths. Cover only platforms actually tested; leave the rest unverified.
Keep platform differences inside the established seam and update [[Features]]
and [[User guide]] with supported behavior. This is a validation plan, not a
report of tests run during this documentation pass.

## Existing issue observed during inspection

The tracked `.gitignore` at `1af6774` contains `<<<<<<< HEAD`, `=======`,
and `>>>>>>> ux-audit` merge-marker lines around the scratch/audit ignores.
Git reported a clean working tree before this pass. The markers were left
untouched to respect the documentation-only scope. Have the owning agent
resolve them, retaining both intended ignore rules, before release work.

**Resolved 2026-10-14** by the owning agent (Claude Code): both rules kept
(`scratch/` and `scripts/ui-review/shots/**/*.png`). The cause was a merge
helper that assumed LF endings; see [[History]].

## Documentation entry points

The root README explains the AI experiment and current repository status.
[[AI development]] explains the purpose of the documentation and how agents
use it. [[User guide]] helps users get started; `CONTRIBUTING.md` explains
how people and agents can help. [[History]] records this handoff separately
from the earlier implementation and its historical test results.
