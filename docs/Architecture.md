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
   │                                audio scheduling, thumbnails/peaks, export
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

Export (`src/engine/export.ts`) runs steps 3-5 once per output frame on a
private canvas, awaiting every source and the encoder instead of following
a clock, so no frame is ever dropped
([[ADR-014 Export is a deterministic frame loop]]).

## Module table

| Module | Owns |
|---|---|
| `lib/project/types.ts` | The document schema (also `docs/Project format.md`, planned) |
| `lib/project/ops.ts` | Every edit: place, split, trims, speed, freeze, detach, settle |
| `lib/commands.ts` | Named commands + JSON Schemas; `describeProject` |
| `lib/analysis/*` | Silence, scene and beat detection, pure ([[AI tools]]) |
| `lib/render/plan.ts` | What is visible at a frame, fully resolved |
| `lib/export.ts` | Export settings to plan: sizes, rates, bitrates, estimate |
| `lib/textBox.ts` | Where the canvas text editor sits: a text raster's layout mapped into the viewer |
| `lib/keyframeEdit.ts` | Keyframes as a set: retime, move, ease presets, bezier handles, copy/paste |
| `lib/paramInfo.ts` | A parameter path's name and display units (Scale %, Position px, Volume dB) |
| `lib/catalog.ts` | Animations, effects, transitions, filters as data |
| `engine/compositor.ts` | WebGL2 passes; `shaders.ts` holds the GLSL |
| `engine/cursor.ts` | One decoder per clip; scrub and play; reversed clips in backward windows |
| `engine/player.ts` | Preview loop, transport, shuttle |
| `engine/audio.ts` | Web Audio scheduling and the audible clock; retimed sound in blocks (`lib/stretch.ts`) |
| `engine/thumbs.ts` | Filmstrips and waveform peaks |
| `engine/export.ts` | The export loop, codec choice, audio windows |
| `engine/analyze.ts` | Decoding for analysis: mono PCM, per-frame scene scores |
| `lib/stickers.ts`, `engine/stickers.ts` | Sticker catalog and placement; the Canvas2D artwork and emoji rendering |
| `lib/templates.ts` | Word art and title templates as data, turned into text and box clips |
| `lib/markers.ts`, `lib/markerText.ts` | Marker edits/navigation/search and read-only notes/chapter formatting |
| `lib/mediaLibrary.ts` | Derived media filters, stable sorts and timeline reference counts; session preferences live in the store |
| `lib/overlays.ts` | Where a new overlay lands: above whatever shows at that time |
| `engine/previews.ts` | Library card previews through an offscreen compositor |
| `state/store.ts` | App state, undo, gestures |
| `state/project.ts` | Autosave drains changed revisions; one navigation transition at a time (ADR-039) |
| `state/actions.ts` | Keymap action handlers, `edit()` |
| `state/export.ts` | The export job: dialog state, `render()` for automation |
| `state/textEdit.ts` | The typing session: live text edits from the canvas or the inspector, one undo step |
| `state/ai.ts` | The AI tools: analyze, then one undoable edit |
| `automation.ts` | `window.videoEditor` |
| `platform/*` | Web and desktop implementations of `Platform` |
