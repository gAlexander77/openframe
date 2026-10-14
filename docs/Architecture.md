# Architecture

How the pieces fit, and where each kind of code lives. Decisions behind the
shape are in `decisions/`; this page is the map.

## Layers

```
React UI (src/components)           CapCut's four panels + overlays
   │ reads slices via useEditor(), writes via actions/edit()
State (src/state)                   store (undo), actions (keymap handlers),
   │                                media import, library apply, drag, toasts
Pure core (src/lib)                 project types/ops/defaults, commands,
   │                                keyframes, catalogs, render plan, audio
   │                                math, timeline geometry, time, keymap
Engine (src/engine)                 media (mediabunny inputs), cursor, player,
   │                                compositor + shaders (WebGL2), text,
   │                                audio scheduling, thumbnails/peaks
Platform (src/platform)             web (OPFS, File System Access) | desktop
                                    (Tauri commands, media: protocol)
Rust (src-tauri)                    files, projects, export writes, FFmpeg
```

Arrows only point down. `src/lib` imports nothing from the layers above it
and has no DOM; `src/engine` never imports React.

## A frame, from edit to pixels

1. An action (`src/state/actions.ts`) or command (`src/lib/commands.ts`)
   produces a new `Project` via pure ops; `store.edit` snapshots the old one
   for undo, and `settle()` applies the magnet and linkage.
2. The player (`src/engine/player.ts`) sees the change and requests the
   current frame; requests coalesce, latest wins.
3. `planFrame(project, f)` lists the layers bottom-up with every parameter
   resolved (keyframes, animations, filter, transitions).
4. `resolveSources` asks each video clip's `VideoCursor` for the sample at
   its source time (a quarter source-frame past the edge), images from a
   bitmap cache, text from the rasterizer.
5. `Compositor.render` runs the passes (layer → effects → blend; transitions
   mix two layer buffers; adjustment layers grade the accumulator) and
   presents over the project background.

Playback is the same loop driven by `requestAnimationFrame`, with the frame
derived from the audible audio clock; audio is scheduled separately by
`scheduleAudio`, which export reuses with an `OfflineAudioContext`.

## Module table

| Module | Owns |
|---|---|
| `lib/project/types.ts` | The document schema (also `docs/Project format.md`, planned) |
| `lib/project/ops.ts` | Every edit: place, split, trims, speed, freeze, detach, settle |
| `lib/commands.ts` | Named commands + JSON Schemas; `describeProject` |
| `lib/render/plan.ts` | What is visible at a frame, fully resolved |
| `lib/catalog.ts` | Animations, effects, transitions, filters as data |
| `engine/compositor.ts` | WebGL2 passes; `shaders.ts` holds the GLSL |
| `engine/cursor.ts` | One decoder per clip; scrub and play; reversed clips in backward windows |
| `engine/player.ts` | Preview loop, transport, shuttle |
| `engine/audio.ts` | Web Audio scheduling and the audible clock |
| `engine/thumbs.ts` | Filmstrips and waveform peaks |
| `state/store.ts` | App state, undo, gestures |
| `state/actions.ts` | Keymap action handlers, `edit()` |
| `automation.ts` | `window.videoEditor` |
| `platform/*` | Web and desktop implementations of `Platform` |
