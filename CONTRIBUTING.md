# Contributing to OpenFrame

OpenFrame is an AI-developed, desktop-first video editor intended for an
open-source community. Its home is
[gAlexander77/openframe](https://github.com/gAlexander77/openframe), public
since 2026-10-17; issues and pull requests there are the way in.

## Useful contributions

- Report reproducible bugs with the app revision, OS, desktop/browser target,
  steps, expected result, actual result, and relevant logs.
- Describe usability problems in terms of the editing task you were trying
  to complete. Include a small screenshot or sample project where useful.
- Improve documentation, accessibility, keyboard workflows, format support,
  tests, or existing features. Read the roadmap before starting a large change.

Use synthetic media or media you can share. Remove credentials, MCP tokens,
private footage, and identifying local paths from reports and examples.
Discuss security-sensitive reports privately with the owner while a public
reporting channel is still being prepared; do not invent a contact address.

## Before changing code

Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md),
[Conventions](docs/Conventions.md), [Architecture](docs/Architecture.md), and
[the handoff](docs/Next%20agent%20handoff.md). The documentation index links
the relevant architectural decisions and research.

Inspect `git status`, recent history, and existing worktrees. Coordinate
overlapping work. Do not discard someone else's edits or stop their app,
browser, dev server, or agent session.

Every worktree belongs under
`F:\Dev\2026\worktrees\<repo>\<branch-or-purpose>`. Keep that work's preview
builds, logs, browser profiles, and scratch inside it. Use
`git worktree remove` to remove your own worktree after the work lands.

The application lands features on desktop first. The browser build reuses
the engine and gets separately verified capabilities; keep platform
differences behind `src/platform/`. Do not add a server or upload workflow
as an incidental implementation choice.

## Develop and validate

```sh
npm ci
npm run tauri dev
```

Install Rust and the appropriate Tauri build prerequisites for your OS.
FFmpeg/ffprobe enable additional desktop formats. The secondary browser
development loop is `npm run dev`.

Before proposing an implementation change, run `just check`:

```sh
npm run build
npm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Then verify the affected editing workflow in the running product. Desktop
changes need desktop checks; a passing browser drive does not prove native
dialogs, path handling, FFmpeg, or the release CSP work. See
[Driving the app](docs/Driving%20the%20app.md). Check a desktop release build
when packaging, security policy, or native integrations change. Browser
claims need checks in the browsers being claimed.

For a documentation-only change, check links, paths, consistency, and the
diff; a full app build is unnecessary unless the documentation changes the
build procedure. Report what was actually run and what was not.

## Submit a reviewable change

Keep the scope focused. Explain the problem, resulting behavior, relevant
tradeoffs, and validation. Update feature documentation for shipped behavior,
the roadmap for plans, an ADR for non-obvious decisions, and history for
lessons future contributors should not have to rediscover.

Respect the owner's current commit and publishing instructions. Issues and
pull requests at the repository are the normal entry points.

## AI-assisted contributions

Claude Code and Codex were the initial development tools. Other tools are
welcome. Explain substantial AI assistance and retain useful reasoning and
verification in the documentation; do not publish private prompts, secrets,
or raw session dumps. The contributor remains responsible for understanding
the change, checking generated code, and presenting real evidence. Never
report an unrun test or a guessed result as a pass.

## License and attribution

Contributions to the original project are offered under `GPL-3.0-only`,
the same terms as [LICENSE](LICENSE), unless explicitly identified otherwise
and accepted by the owner. Submit only work you are entitled to contribute.
Preserve existing copyright and license notices. Explain a dependency's
purpose and license before adding it, and update the release inventory.
Third-party code, models, and assets keep their own terms.
