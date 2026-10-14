# ADR-001: Tauri v2 and React, the TermHQ stack

- **Date**: 2026-10-13 · **Status**: accepted

## Context

The owner wants a CapCut-class video editor on Tauri + Rust + TypeScript,
built the way TermHQ is built. TermHQ already proved Tauri v2 + React +
Vite + vitest on Windows, macOS and Linux, and paid for its lessons in its
docs vault (WebView2 debug-port driving, `dragDropEnabled` vs HTML5 drag and
drop, file locks on `target\debug`). A video editor also has to run in a
browser later, which rules out anything that only exists natively.

## Decision

Same stack as TermHQ: Tauri v2, React 19, Vite, TypeScript, vitest for pure
logic, `just check` as the local CI gate, an Obsidian-style `docs/` vault
with numbered ADRs. Current majors at creation: Tauri 2.12, React 19.3,
Vite 8, TypeScript 7 (the native compiler), vitest 5.

## Consequences

Every TermHQ convention transfers. Read `Conventions.md` before adding code.
The webview is Chromium on Windows (WebView2), WebKit on macOS and Linux,
so anything the media engine relies on must be checked on all three (see
[[ADR-002 The media engine lives in the webview]]).
