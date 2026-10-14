# ADR-003: Desktop first, one build, a platform seam

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The owner's direction: a **desktop application first**, with a web version
second that offers whichever features can run in a browser. Everything runs
**on the user's own hardware** — no backend server of ours, for either
build. Cloud AI providers can only ever be opt-in plugins.

## Decision

- One Vite build. The app detects Tauri at runtime (`src/platform/env.ts`)
  and picks a `Platform` implementation (`src/platform/`): file picking,
  media bytes (`sourceFor`, `blobFor`), project storage, export targets.
  Nothing outside `src/platform/` branches on platform.
- **Desktop**: media referenced by absolute path, never copied; bytes served
  by a range-capable custom protocol; projects and exports written by Rust.
- **Web**: imported files copied into the origin private file system (OPFS)
  so projects survive a reload; projects stored there as JSON; exports
  written with positional writes via the File System Access API, or into
  OPFS and downloaded where no save dialog exists. Nothing is uploaded.
- Desktop-only features (FFmpeg proxies, ProRes/DNxHR masters, native
  captions) are offered only when the platform reports them, never as
  broken buttons.

## Consequences

The web build's storage is per browser profile and can be cleared by the
user; the home screen says so. A feature lands desktop-first, and its web
availability is decided per feature.
