# Conventions — how this stays maintainable

Inherited from TermHQ, where every rule below was paid for once. The failure
mode we guard against is spaghetti: logic smeared across components,
abstractions nobody asked for, and modules that all know about each other.

## Where code goes

| Kind of code | Lives in | Rule |
|---|---|---|
| Pure logic (time math, edit operations, keyframes, snapping, analysis algorithms, captions formats) | `src/lib/` | No DOM, no WebCodecs, no React. Every file has a vitest beside it. |
| Media engine (decode, composite, audio, export) | `src/engine/` | Browser APIs allowed. No React. Talks to the project only through `src/lib/project` types. |
| Platform differences (desktop vs web) | `src/platform/` | One interface, two implementations. Nothing else branches on platform. |
| App state | `src/state/` | One store. Components read with hooks, write through store actions. |
| UI | `src/components/` | Receives data, calls actions. Logic worth testing moves to `src/lib/`. |
| Icons | `src/icons/` | The only import site for icons. No inline `<svg>` elsewhere. |
| Rust | `src-tauri/src/<noun>.rs` | One file per noun it owns (media, export, project). Register commands in `lib.rs` only. |

## Rules of thumb

1. **No abstraction until the second caller exists.** Two similar functions
   are cheaper than one wrong abstraction.
2. **Dependencies need a reason a few lines cannot provide.** Current list,
   frontend: react, react-dom, `@tauri-apps/*`, mediabunny (demux, WebCodecs, mux), lucide-react (icon drawings, re-exported only from `src/icons/`), @huggingface/transformers (Whisper captions in a worker, ADR-007). Rust: tauri,
   serde, serde_json, tauri-plugin-dialog. Each addition gets a line here and
   an ADR when it is load-bearing.
3. **Errors cross IPC as `Result<T, String>`** — human-readable, shown in the
   UI. No error-type hierarchies.
4. **Platform code hides inside the owning module** — `#[cfg(windows)]` in
   Rust, `src/platform/` in TypeScript. Callers never branch on OS.
5. **Deliberate shortcuts get a `ponytail:` comment** naming the ceiling and
   the upgrade path. `grep -rn "ponytail:" src src-tauri` finds them all.
6. **Every non-obvious choice gets an ADR** in `decisions/` — 15 lines, not an
   essay. Next free number, `ADR-NNN Title in sentence case.md`.
7. **American English** — color, behavior, canceled — in prose, UI strings,
   comments and commit messages alike.
8. **No chord is typed out in UI prose.** Read it from the keymap so a
   rebind can never make the UI lie.
9. **Video frames are a resource, not a value.** Every `VideoFrame` and
   `VideoSample` that is created is closed exactly once, by the code that
   owns it. A leaked frame stalls the decoder, it does not just waste memory
   (see [[Web media engine]]).
10. **Time on the timeline is integer frames** of the project frame rate
    ([[ADR-004 Timeline time is integer frames]]). Seconds appear only at the
    decode boundary.
11. **Animations respect `prefers-reduced-motion`.** Motion is for meaning
    (where something went, what changed), never decoration that delays work.

## Commits

Small and many. One intention per commit, and the message says *why*, not
just what — the owner reads history to learn the reasoning behind every
choice. Docs land in the same commit as the code they describe.

## Testing policy

- `src/lib/` logic: vitest, node environment, no jsdom.
- The engine and UI: driven for real — the web build through Playwright, the
  desktop app over WebView2's debug port ([[Driving the app]]).
- When a test matters, prove it bites: break the code, watch it fail, revert.
