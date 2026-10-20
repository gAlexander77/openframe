# Architecture

How the pieces fit, and where each kind of code lives. Decisions behind the
shape are in `decisions/`; this page is the map.

The app is in `openframe-application/`: run every app command there, and
read `src/`, `scripts/`, `src-tauri/` and `fixtures/` paths in these docs
as inside it. The website is `openframe-website/`; `docs/` at the root
serves both ([[ADR-081 The app and the website each have a folder, the docs stay at the root]]).

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
| `lib/project/compound.ts` | Compound clips: create, break apart, a compound's timeline as a view and back (ADR-037) |
| `lib/commands.ts` | Named commands + JSON Schemas; `describeProject` |
| `lib/analysis/*` | Silence, scene and beat detection, pure ([[AI tools]]) |
| `lib/render/plan.ts` | What is visible at a frame, fully resolved; a compound clip's layer carries its nested plan |
| `lib/export.ts` | Export settings to plan: sizes, rates, bitrates, estimate |
| `lib/textBox.ts` | Where the canvas text editor sits: a text raster's layout mapped into the viewer |
| `lib/keyframeEdit.ts` | Keyframes as a set: retime, move, ease presets, bezier handles, copy/paste |
| `lib/crop.ts` | Crop ratios, the largest crop of a ratio, where a dragged crop handle puts the edges (ADR-048) |
| `lib/mask.ts` | Mask shapes on the viewer: frame, outline, handles and drags, mirroring the shader's maskAlpha (ADR-049) |
| `lib/shapes.ts`, `lib/trackMatte.ts`, `lib/motionBlur.ts`, `lib/wiggle.ts` | Graphics: shape geometry and colors, which clips are track mattes, motion blur's shutter samples, wiggle's noise; the plan resolves them and the compositor draws them (ADR-056 to ADR-059, ADR-062) |
| `lib/blur.ts`, `lib/shadow.ts`, `lib/tilt.ts`, `lib/textAnim.ts` | Large blurs' pyramid plan and its CPU simulation; drop shadows; perspective tilt's homography; keyed title size, spacing and color (ADR-069 to ADR-071) |
| `lib/border.ts` | Borders on pictures: values, keys, the jump flood's steps; the compositor floods the picture's edge out and draws the border under it (ADR-099) |
| `lib/paramInfo.ts` | A parameter path's name and display units (Scale %, Position px, Volume dB) |
| `lib/catalog.ts` | Animations, effects, transitions, filters as data |
| `engine/compositor.ts` | WebGL2 passes, nested compound plans one framebuffer level deeper; `shaders.ts` holds the GLSL |
| `engine/cursor.ts` | One decoder per clip; scrub and play; reversed clips in backward windows |
| `engine/player.ts` | Preview loop, transport, shuttle, a silent bounded run (`preview`) |
| `engine/audio.ts` | Web Audio scheduling and the audible clock; retimed sound in blocks (`lib/stretch.ts`) |
| `lib/soundFx.ts`, `engine/soundFx.ts` | A clip's filters, echo, reverb and tape stop: values, impulse responses, time warp; the nodes (ADR-060) |
| `engine/mixdown.ts` | The mix rendered offline in pre-rolled windows, for export and `measure_loudness` |
| `lib/analysis/truePeak.ts`, `lib/analysis/delivery.ts`, `state/delivery.ts` | True peak, loudness range, delivery specs, the export limiter's plan, the loudness report (ADR-061) |
| `lib/music/*`, `engine/music.worker.ts`, `state/music.ts` | generate_music: theory, styles, the arranger (form, fit, chords, hook, events), instruments, the mix and master, measurements, the cue sheet; rendered in a worker, imported and placed (ADR-085, ADR-086) |
| `engine/thumbs.ts` | Filmstrips and waveform peaks |
| `engine/compoundThumbs.ts` | Compound clips' filmstrips (the nested timeline rendered offscreen) and mixed peaks |
| `engine/export.ts` | The export loop, codec choice, audio windows; stills (`exportStills`: the frames `preview_frame` and the contact sheets show, at the size asked) |
| `lib/brandKit.ts`, `lib/ads.ts`, `lib/versions.ts` | Ads: the brand kit and text roles, the readable text floor; ad elements laid out in the safe area; an ad's other shapes, cut-downs and textless master, groups fitted as one (ADR-063) |
| `engine/analyze.ts` | Decoding for analysis: mono PCM, per-frame scene scores |
| `engine/cutout.ts`, `engine/matte.worker.ts`, `lib/matte.ts` | Remove BG: the clip's frames through a segmentation model in a worker, steadied over time, stored as a grayscale matte video the compositor samples (ADR-032, ADR-033) |
| `lib/stickers.ts`, `engine/stickers.ts` | Sticker catalog and placement; the Canvas2D artwork and emoji rendering |
| `lib/templates.ts` | Word art and title templates as data, turned into text and box clips |
| `lib/markers.ts`, `lib/markerText.ts` | Marker edits/navigation/search and read-only notes/chapter formatting |
| `lib/mediaLibrary.ts` | Derived media filters, stable sorts and timeline reference counts; session preferences live in the store |
| `lib/overlays.ts` | Where a new overlay lands: above whatever shows at that time; what to play so it shows once added (ADR-047) |
| `lib/drop.ts` | Where a library drop lands (`placeAsset`, magnet cuts, overlays) and `landing`, which the drop preview draws from a dry run (ADR-046) |
| `engine/previews.ts` | Library card previews through an offscreen compositor |
| `state/store.ts` | App state, undo (whole-document snapshots), gestures; the open compound clips (`nest`) and `document()` |
| `state/project.ts` | Autosave drains changed revisions; one navigation transition at a time (ADR-039) |
| `state/projectWork.ts`, `lib/taskScope.ts` | Abortable document-session ownership for delayed imports, captions, stickers and analysis |
| `state/actions.ts` | Keymap action handlers, `edit()` |
| `state/export.ts` | The export job: dialog state, `render()` for automation |
| `state/textEdit.ts` | The typing session: live text edits from the canvas or the inspector, one undo step |
| `state/cropEdit.ts` | The crop mode's session: a copy of one clip's crop, the viewer showing it whole, Done as one undo step (ADR-048) |
| `state/ai.ts` | The AI tools: analyze, then one undoable edit |
| `automation.ts` | `window.videoEditor` |
| `platform/*` | Web and desktop implementations of `Platform` |

### Decoder preparation (ADR-074)

The preview player uses `lib/render/preroll.ts` to prepare each upcoming
clip at its first visible frame, including transition handles. Keyframe
distance and measured decode throughput select 0.75-5 seconds of lead.
Admission estimates include decoder queue buildup within a 512 MiB budget
for additional cursors; oversized entries decode on demand. Export keeps
its own cursor pool and unchanged frame plan.

### Music structure and voice balance (ADR-075)

`analysis/beats.ts` finds boundaries from adjacent bars supported by two-bar
novelty, allowing two-bar parts; smaller phrase-aligned timbral changes can
split variations. `drops` lists qualifying rises; `drop` stays the biggest.
`analysis/balance.ts` owns stem isolation, role conventions and attenuation
math. `state/delivery.ts` measures each requested stem with the offline
export mixer. `state/ai.ts` measures candidate ducking keyframes before one
undoable edit, rejecting results if the project changed during measurement.
