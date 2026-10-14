# Video Editor

A desktop and web video editor: CapCut's speed with the editing depth of
VEGAS Pro and Premiere Pro. Tauri v2 + Rust on the desktop, the same
TypeScript engine in any modern browser.

"Video Editor" is a placeholder name. Every site that carries it is listed in
[docs/Renaming.md](docs/Renaming.md).

## Run it

```
npm install
npm run tauri dev     # desktop app (needs Rust + ffmpeg on PATH for the full format set)
npm run dev           # web build at http://localhost:1420
just check            # every quality gate, run before pushing
```

## Read first

`docs/Index.md` is the map: features, architecture, conventions, and every
architectural decision (ADR) with the reasoning behind it. `CLAUDE.md` is the
operating manual for coding agents working in this repository.
