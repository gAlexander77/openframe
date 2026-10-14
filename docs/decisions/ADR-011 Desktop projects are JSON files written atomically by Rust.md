# ADR-011: Desktop projects are JSON files written atomically by Rust

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The desktop app needs projects that survive crashes, antivirus scanners
and OneDrive, and a home screen that lists them without parsing every
timeline. The web build keeps them in OPFS (ADR-003); the desktop has a
real file system and no reason to hide projects inside a browser profile.

## Decision

- `src-tauri/src/project.rs` keeps `<app data>/projects/<id>.json`, the
  previous save as `<id>.json.bak`, and `<id>.summary.json` (the
  `ProjectSummary` the home screen shows). App data is Roaming on Windows
  (`%APPDATA%\com.alex.video-editor`), so projects follow the user.
- Every write is **temp file → `sync_all` → close → rename**, so a crash
  leaves the old file or the new one, never half. The rename retries for
  ~2 s on Windows os errors 5 and 32 (`files.rs`). Measured: a target held
  without `FILE_SHARE_DELETE` fails the rename with **5**, a held source
  with **32**; both happen when a scanner opens a fresh file.
- Projects cross IPC as JSON **text**: the webview stringifies and parses,
  Rust only moves bytes, so the format stays owned by `src/lib/project`.
- Ids become file names, so Rust accepts only `[A-Za-z0-9_-]{1,64}`.
- Media paths in a project are absolute (ADR-010) and re-registered lazily
  when the project is read.

## Consequences

A project is a plain file a user can back up or send. Moving media breaks
its absolute path; `ponytail:` relink by name and size when a load finds a
missing file. The summary and project are two writes, so a crash between
them shows a stale summary for a project that is itself intact.
