---
title: Feature gaps 2026-10-16
tags: [research, competitor, gaps, capcut, premiere, resolve, vegas, fcp]
created: 2026-10-16
status: reference
scope: CapCut desktop 9.x, Premiere 26.x, Resolve 21.x (Edit/Cut), VEGAS Pro 23, Final Cut Pro 12.x
---

# Feature gaps 2026-10-16

The owner compared our Transform section with CapCut desktop's Video >
Basic and found the align row missing, and asked for a full survey of what
else we lack. This note is that survey. It compares the shipped app with
CapCut desktop (the primary model), Premiere, DaVinci Resolve (Edit and
Cut pages), VEGAS Pro and Final Cut Pro, and takes lessons only from
Shotcut, Kdenlive and OpenShot.

**Method.** "What we have" comes from [[Features]], [[Roadmap]],
[[UX audit 2026-10-14]], the command registry (`src/lib/commands.ts`),
the keymap (`src/lib/keymap.ts`) and a grep of `src/` on main at
`d94ef4f`. When a doc and the code disagreed, the code won. "What they
have" comes from [[CapCut desktop]] and [[Professional NLE features]],
checked against current official docs and release notes (Sources). No
browser was driven; this is desk research.

**Shipped while this survey ran.** Four transform items landed on main
during the survey and are marked "yes" below: align and distribute
(`19046cb`, [[ADR-045 Align measures the resting box, one clip to the canvas]]),
edge and layer snapping in the viewer (`e4dfc91`), the player's Ratio menu
(`40561e4`) and the Uniform scale switch with Scale X/Y (`d94ef4f`).

**In flight elsewhere.** Three parked branches already hold work. Do not
duplicate it: `bg-removal` (background removal; **shipped 2026-10-16** as
Remove BG, ADR-032 and ADR-033), `compound-clips`
(nesting) and `timeline-ux` (UX-12 drop above main as an overlay, UX-13
drop preview, UX-14 linkage). See [[Next agent handoff]]. When this note
was written, a voiceover recorder was in progress; it shipped in
`601d895`, so build-order item 3 is done.

**Updated the same evening.** Rows shipped later on 2026-10-16 now read
"yes" with a dash for priority (about 50 of them, from track solo and
height to Lift/Extract, EQ, filler-word removal and the LUFS meter; git
log has each). Open at P0/P1: link/unlink A/V with one-side trims,
translated captions, auto reframe, motion tracking, proxies on demand
and a solo key. Translated
captions wait on a non-English speech fixture: Kokoro speaks English
only, so the result could not be checked in the product. Link/unlink is
mostly covered the CapCut way: detached sound under a main-track shot
follows it through linkage, and Group links any clips for moves.

**Legend.**
- Apps: **C** CapCut desktop, **P** Premiere, **R** Resolve Edit/Cut,
  **V** VEGAS Pro, **F** Final Cut Pro, **OSS** Shotcut/Kdenlive/OpenShot.
- Have: **yes**, **partial** (with evidence), **no**.
- Priority:
  - **P0**: a CapCut user expects it and hits the gap in a normal edit.
  - **P1**: expected soon, by CapCut power users or by pros.
  - **P2**: later, niche, or high cost for its value.
- Scope filter: everything runs on the user's hardware with no account
  (ADR-003). Cloud items are listed once, under Out of scope.

---

## 1. Viewer and canvas

Overlay handles live in `src/components/TransformOverlay.tsx`. Box
geometry shared with align and snapping lives in `src/lib/align.ts`.
Guides are in `src/components/ViewerGuides.tsx`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Align to canvas: left, center, right, top, middle, bottom | C P OSS | yes (`AlignBar.tsx`, `align_clips`) | — | Shipped `19046cb`. |
| Align a multi-selection to its combined bounds | C P | yes | — | Same commit. |
| Distribute three or more layers | C P | yes (`distribute_clips`) | — | Same commit. |
| Snap a dragged layer to canvas edges and center | C P | yes | — | Shipped `e4dfc91`. |
| Snap to other layers' edges and centers | C P | yes | — | Same commit. |
| Snap to safe-margin and thirds lines | P | yes, while those guides show (`snapLines`) | — | — |
| Arrow-key nudge of the selected layer (1 px; Shift 10 px) | C P | yes: arrows nudge a selected layer in the viewer (`useNudge`) | — | CapCut's help confirms 1 px nudging. Scope it to viewer focus so frame stepping keeps the arrows elsewhere. Add `nudge*` actions in `keymap.ts`, written through `setParam`. One undo step per burst. |
| Viewer zoom and pan (Fit, 25% to 400%) | C P R F | yes: zoom menu, Ctrl+wheel at the pointer, wheel and middle-drag pan | — | CapCut documents zoom up to 400%. Session state in the store, never the project. Scale the stage in `Player.tsx`; `TransformOverlay` already maps through W/H. Middle-drag or Space-drag pans. |
| On-canvas handles for a multi-selection | C P | yes (`GroupOverlay.tsx`, `groupBoxes`/`scaleClips` in `align.ts`) | — | Shipped `23c1d14`: one box, move with snapping, corners scale about its center. |
| Edge handles that stretch one axis | P R F V | partial: Scale X/Y exists (`d94ef4f`); handles are corners only | P2 | Add side handles that write `transform.scale` or `transform.scaleY` alone. |
| Crop on the canvas | C P R V F | yes (`CropOverlay.tsx`, `state/cropEdit.ts`) | — | Shipped `e09a3f7` ([[ADR-048 Crop is cut from the source and edited on a copy]]); flips fixed in `8cd42ae`. |
| Mask handles on the canvas | C P R V F | yes (`MaskOverlay.tsx`, `lib/mask.ts`) | — | Shipped `d89987f`: move, size, rigid rotate, feather arrow, corner radius; mask keyframes now play (`eb0f6f7`). |
| Motion path for animated position | P R F | no | P2 | Draw `transform.x/y` keyframes as a polyline with draggable points. Spatial beziers need a new keyframe field (an ADR). |
| Rulers, draggable guides, grid | P | partial: thirds and safe margins only | P2 | Guides stay session-only, like `viewerGuides`, and become snap targets. |
| Safe zones for TikTok, Reels and Shorts | (Kapwing, Flixier) | yes: a viewer guide, snapping included (2026-10-17) | — | None of the five editors has it built in. No app publishes organic-post margins; the numbers are the largest of each side in the three apps' ad specs, gathered by third-party checkers (reap.video, visu.network, adkit.so, 2026), so treat them as conservative. |
| Transparency checkerboard | P R F | no; `Project.background` fills behind every layer | P2 | Only useful once alpha export exists (§12). |
| Before/after or reference-frame compare | P R F | no (a candidate in [[Navigation and composition]]) | P2 | A second compositor pass of a held frame; mind GPU memory. |
| Ratio menu under the player | C | yes (`40561e4`) | — | — |
| Loop playback and play In to Out | P R V F | yes: Loop (Ctrl+L) and Play In to Out | — | A `loop` flag in the store; `src/engine/player.ts` seeks back at the out point. Add keymap actions. |
| Timecode or clip-name overlay on the viewer | P R | no | P2 | DOM overlay; never exported. |
| Type a timecode to jump there, +/- offsets | P R | yes: click the player's timecode (2026-10-17) | — | Added by the everyday-gaps pass; `parseJump` in `lib/time.ts`. |
| Second-monitor full-screen output | P R V F | partial: full-screen preview only | P2 | A second Tauri window that mirrors the canvas. |

## 2. Inspector: transform and picture

The Video tab lives in `src/components/inspector/Inspector.tsx`. Values
are written with `setParam` (`src/lib/project/ops.ts`) and drawn by
`src/lib/render/plan.ts` and `src/engine/compositor.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Uniform scale switch, Scale X / Scale Y | C P R V F | yes (`d94ef4f`, `set_uniform_scale`) | — | Shipped during the survey. |
| Flip horizontal and vertical in the inspector | C P R F | yes: Flip buttons in Transform | — | Two toggle buttons in `TransformSection`. Add `set_flip`, since `set_param` is numeric. |
| Rotate dial | C | no; slider and number only | P2 | A small dial control in `controls.tsx`. |
| Anchor point | P R V F | yes: Anchor X/Y; rotation and scale pivot on it | — | Add optional `anchorX/anchorY` to `Transform` (absent = center, so old files stay valid). Pivot the matrix in `compositor.ts` and `plan.ts` around it. Add an anchor handle to the overlay and update `align.ts`. |
| Crop with ratio presets (Free, 16:9, 9:16, 1:1, 4:3...) | C | yes (`lib/crop.ts`, `set_crop`) | — | Shipped `68d15cf` and `e09a3f7`: Free, Original and seven ratios under the viewer in the crop mode. |
| Crop softness | R | no | P2 | Feather term in the crop shader. |
| Fit, Fill and Stretch quick actions | P R F OSS | yes (`frame_clips`) | — | Fill = cover scale from `align.ts` `sourceSize`; Stretch uses Scale X/Y. Add a `fit_clips` command (mode fit, fill or stretch). Shotcut places these next to its align buttons. |
| Position presets (PIP corner at a set size) | R F | partial: align covers edges | P2 | Presets that call align plus a scale. |
| Opacity, 13 blend modes | all | yes | — | Hue, Saturation, Color and Luminosity modes are missing (P2, compositor). |
| Border, drop shadow and rounded corners on a picture layer | C R F V | partial: rounded corners through Mask > Rectangle's corner radius, as CapCut users do; no border or shadow | P2 | Effects run in canvas space and cannot see the layer's box; both belong in `LAYER_FS` (border inset) and a padded quad (shadow). |
| Canvas fill: blur or color | C | yes | — | An image or pattern fill is missing (P2). |
| Stabilize | C P R V F | yes: three levels, translation only, measured locally | — | Desktop first: run FFmpeg `vidstabdetect` where the build has libvidstab, or a phase-correlation pass in a worker. Store a per-frame offset track beside the asset; `plan.ts` applies it as an extra transform with a crop-to-hide. Analysis belongs in `src/lib/analysis/`. |
| Optical flow / smooth slow-mo | C P R V F | partial: frame blending (ADR-051); no optical flow | P2 | See §9 (frame blending first). |
| Enhance quality (upscale) | C R V | no | P2 | Local ESRGAN-class ONNX at export only; slow. |
| Video denoise, deflicker | C R | no | P2 | Temporal shader with the previous frame held by the cursor. |
| Motion blur | P R | no | P2 | Sub-frame accumulation of the transform in the compositor. |
| Lens correction | C R | no | P2 | Barrel shader. |
| Apply to all, and Save as preset, for Transform | C | partial: effect presets and Paste Attributes (transform group) exist | P2 | Reuse `paste_attributes` across all selected clips. |
| Edit several selected clips' properties at once | P | yes: Scale, Rotate, Opacity and Volume for a multi-selection, "Mixed" when they differ (2026-10-17) | — | Added by the everyday-gaps pass (Premiere 25's Properties panel). Relative drags (offset each) are not offered. |

## 3. Timeline: tracks

Track headers are `TrackHeader` in `src/components/Timeline.tsx`; lane
heights come from `trackHeight()` in `src/lib/timeline.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Lock, hide, mute | C P R V F | yes | — | — |
| Solo | P R V F | yes (`Track.solo`, header menu) | — | Add `solo?: boolean` on `Track`; `soundingClips` plays only soloed tracks when any is soloed. Add a header button and `update_track` support. |
| Track volume and pan in the header | P R V | yes: header menu > Track volume and pan | — | A small dB slider or popover in `TrackHeader`. |
| Rename a track in the UI | P R V F | yes: header menu > Rename track | — | Double-click the header to rename. |
| Track height control | P R V F | yes: small, normal, large per track | — | CapCut lacks this too, but long edits need it. Add `height?: number` per track (a view preference, not project data; decide in an ADR) plus a timeline-wide S/M/L toggle. |
| Track color | R F | no | P2 | Optional `color` on `Track`, tinting clip bodies. |
| Collapse tracks, folder tracks | R | no | P2 | — |
| Track targeting, source patching, sync lock | P R | no | P2 | Matters once insert/overwrite exist. The magnet covers the CapCut case. |
| Add or delete a track from a menu | C P R V | partial: header menu > Delete track; tracks are added by drops and `add_track` | P2 | Header context menu. |
| Cover button and cover designer | C | no | P2 | See §12. |
| Global mute | P | no | P2 | A store flag in the master bus. |
| Timeline view options: thumbnail mode, waveform size, clip names | P R F | no | P2 | Session preferences read by `ClipView.tsx`. |

## 4. Timeline: editing

Edits are pure ops in `src/lib/project/ops.ts`, run through `edit()` in
`src/state/actions.ts`, with a command in `src/lib/commands.ts` and a
binding in `src/lib/keymap.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Split, split all, delete left/right, ripple delete, freeze, reverse, extract audio, deactivate | C P R V F | yes | — | — |
| Ripple, roll, slip, slide with two-up preview | P R V F | yes | — | — |
| Drop above the main track makes an overlay (UX-12) | C | yes (landed from `timeline-ux`) | — | Land the parked branch. |
| Drop preview shows the magnet's insertion point (UX-13) | C | yes (landed from `timeline-ux`) | — | Same. |
| Linkage leaves music beds alone (UX-14) | C | yes (landed from `timeline-ux`) | — | Same. |
| Group and ungroup (Ctrl+G) | C P V | yes (`group_clips`) | — | Add `group?: Id` on `ClipBase`. `store.select` expands to the group; move and delete act on all members. Add `group_clips` and `ungroup_clips`. |
| Compound clip / nested sequence | C P R V F | yes (landed from `compound-clips`) | — | Resume the branch. |
| Replace clip, keeping timing and effects | C P R F | yes: right-click > Replace clip | — | Per-clip asset swap, reusing the checks in `src/lib/project/relink.ts`. Add a context-menu item and `replace_clip`. |
| Rate stretch tool (drag an edge to change speed) | P R V F | yes (Shift+R) | — | A trim variant that calls `setSpeed` so the source range stays fixed. Add a tool in `TimelineToolbar.tsx`. |
| Insert, overwrite and replace edits from the source monitor | P R V F | yes: Insert (,) and Overwrite (.) in the source monitor | — | Replace edit and track targeting remain (P2). |
| Lift and extract the In/Out range | P R V F | yes (; and ', `lift_range`) | — | A pure `extractRange(p, in, out, ripple)` over unlocked tracks, with a test. Add commands and keys. |
| Three- and four-point editing, fit to fill | P R F | partial: source In/Out only | P2 | After insert/overwrite. |
| Link/unlink A/V; Alt-trim one side for J/L cuts | P R V F | partial: `detach_audio` splits sound off for good; no relink, no one-side trim, no out-of-sync badge | P1 | Add `linkId` on the detached pair so moves stay together. Alt bypasses the link. Draw a ±N badge when offsets drift. |
| Close a gap; select a gap and delete it | P R V F | yes: right-click a gap > Close gap, or Close all gaps | — | Click a gap to select it; Delete calls the ripple path (`compactTrack` exists). |
| Nudge clips by 1 or 10 frames from the keyboard | P R V F | yes (Alt+arrows) | — | `moveClip` by ±1/±10 with snapping off. Add keymap actions (Premiere uses Alt+←/→). |
| Clip color labels | P R V | yes (`labelColor`, `set_clip_label`) | — | — |
| Type a clip's duration | C P R F | yes: the Speed tab's Duration sets the speed (CapCut's way) | — | Premiere's trim-to-length variant is not offered. |
| Default transition key; add to the selected cuts | P R F | partial: "Apply to all cuts" | P2 | Add a keymap action. |
| Multicam | C P R V F | no | P2 | Sync by audio reuses `src/lib/analysis/sync.ts` (Sync audio by waveform); an angle grid needs one cursor per angle. |
| Audio scrubbing while dragging the playhead | P R V F | no (not found in `src/engine/player.ts`) | P2 | Short grain playback in `src/engine/audio.ts`. |
| Extend edit (E), edit-point selection | P R F | no | P2 | — |
| Timeline index / find clips | P R F | partial: a marker list only | P2 | A clip list beside Markers. |
| Undo history list | P V | yes: right-click Undo or Redo | — | — |

## 5. Audio

Gain math is in `src/lib/audio.ts`. `scheduleAudio` in
`src/engine/audio.ts` builds one Web Audio graph for both preview and the
`OfflineAudioContext` export, so anything added there renders identically
in both.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Volume, fades, volume keyframes, pan | C P R V F | yes | — | — |
| Normalize loudness, auto ducking, beat markers | C P R V F | yes | — | — |
| Record a voiceover | C P R V F | yes: microphone button in the timeline toolbar | — | CapCut's mic button sits in the timeline toolbar. Use `getUserMedia` plus `MediaRecorder` (WAV/Opus), then save through `src/platform/` as an asset at the playhead on a new audio track. Offer "mute project while recording" and a level meter (reuse `Meter.tsx`). Check WebView2 mic permission handling on desktop. |
| Crossfade at a cut or under a video transition | P R V F | yes: sound crossfades under transitions | — | Equal power by default and linear for the same source (see the pitfall in [[Professional NLE features]]). Compute it in `clipGainAt` so preview and export agree. |
| Fade curve types | P R V F | no; linear only | P2 | A curve field on the fades. |
| Pan keyframes | P R V F | yes | — | — |
| EQ (parametric or graphic) | P R V F | yes: three bands (low shelf, mid bell, high shelf) | — | `BiquadFilterNode` chain per clip in `scheduleAudio`. Store bands on `Sound`. VEGAS 23's modernEQ is the model. |
| Compressor, limiter | P R V F | yes: Compressor in the Audio tab (2026-10-17, ADR-053); a peak limiter in export loudness | - | — |
| Noise reduction | C P R V F | yes: a spectral gate for steady noise (no ML model) | — | Local DeepFilterNet or RNNoise via ONNX or WASM in a worker (the app already ships transformers.js). Render a cleaned copy per asset and play that, so playback costs nothing. |
| Enhance voice | C P | yes: the Compressor's Enhance voice preset (2026-10-17); noise reduction stays its own tool | - | — |
| Voice isolation / stems | C R F | no | P2 | A Demucs-class ONNX model; heavy. |
| Voice changer filters and characters | C | no | P2 | Web Audio graphs (echo, lo-fi, megaphone) as presets. |
| Pitch shift independent of speed | C P V | no; pitch only follows speed (Change pitch) | P2 | The engine's time-stretch (ADR-028) can expose a semitone offset. |
| Fill channel (left or right to both) | C | yes (`set_channel_fill`) | — | — |
| Sync external audio to camera audio | C P R F | yes: clip menu > Sync audio by waveform (or the AI tools card, `sync_audio`), onset envelopes cross-correlated, exact to the sample; `sync_to_clip` by a known offset | — | — |
| Loudness meter (LUFS M/S/I) | P R V F | yes (`Meter.tsx`, `public/loudness-tap.js`) | — | Integrated resets on each play; no Reset button, loudness range or true peak yet (P2). |
| Track mixer with per-track meters | P R V F | no | P2 | After solo and track volume. Add buses and inserts later. |
| Stretch music to fit (Premiere Remix) | P | no | P2 | Beat analysis already exists; L. |

## 6. Text and captions

Text styling is the Text tab in `Inspector.tsx`. Rasterizing is in
`src/engine/text.ts`. Captions are in `src/lib/captions.ts`,
`src/engine/transcribe.ts` and `src/engine/asr.worker.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Installed system fonts in the picker | C P R V F | yes where the webview offers `queryLocalFonts` | — | Desktop: list fonts in Rust (e.g. DirectWrite via `font-kit`) or with WebView2's Local Font Access (`queryLocalFonts`). Web: `queryLocalFonts` where it exists, the fixed list otherwise. Add a preview and search. |
| Import a font file (.ttf/.otf) | C R | yes | — | `FontFace` from the file; keep a reference in the project like `luts[]` (ADR-021 pattern), so headless render and export find it. |
| Text case (Aa / AA / aa), vertical text | C | partial: case (`style.case`); no vertical text | P2 | Style fields read by `rasterizeText`. |
| Glow, gradient fill | C | no; word art fakes glow with shadow | P2 | Raster passes in `engine/text.ts`. |
| Curved or path text | C R | no | P2 | Per-glyph placement in `engine/text.ts`. |
| Bubble and callout frames behind text | C | partial: bubble stickers exist | P2 | — |
| Text templates, word art, in/out/loop animations | C P R F | yes | — | — |
| Local text to speech | C R V | yes: Kokoro in a worker | — | Kokoro-82M or Piper ONNX in a worker (transformers.js), writing a WAV asset aligned to the text clip. Add `add_speech` and "update speech when text changes". Voices download once, like the Whisper models. |
| Auto captions (local Whisper), SRT/VTT, list editing | C P R F | yes | — | — |
| Word-by-word highlight (karaoke) and single-word captions | C P R | yes: word highlight, and One word at a time in the Captions tab | — | Keep `words: {f, d}[]` on caption clips; `engine/text.ts` highlights the active word; add caption templates. Premiere 26.3 added single-word captions and Resolve 20 added animated subtitles, so this is now table stakes. |
| Filler-word detection and removal | C P | yes: "um", "hmm", "ah" (Whisper drops "uh"; [[Filler words]]) | — | Whisper words plus a filler list, removed with `cut_ranges`. Add it as a card in the AI tools tab. |
| Transcript-based editing | C P R V | yes: Captions tab > Edit by transcript, `get_transcript` | — | A transcript panel; deleting words maps to `cut_ranges`. L. |
| Translate captions / bilingual captions | C P | no | P1 | Whisper `task: "translate"` gives English cheaply (S). Other targets need a local MT model (NLLB/Marian ONNX, L). Bilingual = a second caption track. |
| Caption find and replace | C P R | yes (`replace_caption_text`) | — | Pure function in `lib/captions.ts`. |
| Keyword highlight, AI emojis | C | no | P2 | — |
| Captions in the export dialog (sidecar or embedded track) | C P R F | partial: SRT/VTT from the Captions tab; captions burn in because they are text clips | P2 | A Captions section in `ExportDialog.tsx`; an embedded track needs muxer support. |
| Lyrics recognition | C | no | P2 | The same Whisper path on music. |

## 7. Effects, transitions, stickers, animation

Catalogs are in `src/lib/catalog.ts`; shaders in `src/engine/shaders.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| 19 effects, 20 transitions, 17 looks, in/out/loop animations, adjustment layers | C P R V F | yes | — | — |
| Effect stack reorder, presets, copy/paste | P R V F | yes | — | — |
| Picture border, shadow and rounded corners | C R F V | partial (rounded corners via the rectangle mask) | P2 | See §2. |
| Animated GIF, WebP or APNG import | C | no; `createImageBitmap` keeps the first frame (`src/engine/media.ts`) | P2 | WebCodecs `ImageDecoder` decodes animated frames; treat the file like a short video. |
| Lottie or HTML motion graphics | R | no | P2 | — |
| More transition families (3D cube, page curl, shape dissolve) | C P R | partial | P2 | Catalog entries. |
| Body and face effects | C | no | P2 | Needs a local pose or face model. |

## 8. Color

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Basic, HSL, curves, wheels, LUT, scopes | C P R V F | yes | — | — |
| Auto adjust / auto balance | C P R F | yes: Adjust > Auto adjust | — | Read the scopes' downscaled frame (ADR-022), then set `adjust.exposure`, `temperature` and `tint` from percentiles and gray-world. A pure function in `src/lib/grade.ts` with a test. |
| Match color to a reference clip | C P R F | no | P2 | Final Cut 12.3 added Match Color. Histogram match on the same readback. |
| Eyedropper for color fields (chroma key, text, background) | C P | yes: a pipette on every color field, via the EyeDropper API (2026-10-17) | — | It samples the screen, so a keyed chroma color is picked before keying. Firefox and Safari lack the API and show no pipette. |
| Skin-tone protection | C | no | P2 | — |
| Mask that limits the grade | C P R | no | P2 | Reuse the mask shader on the adjust pass. |
| Hue vs. saturation curves, HSL qualifier | P R | partial: 8-band HSL | P2 | — |
| Export a grade as .cube | R V | no | P2 | — |
| HDR (PQ/HLG) | C P R V F | no (WebGPU on the [[Roadmap]]) | P2 | — |

## 9. Speed

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Standard, curve, reverse, pitch | C P R V F | yes | — | — |
| Frame blending for slow motion | C P R V F | yes (ADR-051) | — | Mix the two neighboring source frames by phase in the compositor; the cursor already holds one frame. M. |
| Optical flow interpolation | C P R V F | no | P2 | A local RIFE-class model at export only. L. |
| Rate stretch tool | P R V F | yes (see §4) | — | See §4. |
| Editable duration field | C | partial (read-only) | P2 | See §4. |

## 10. Masks and keying

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Linear, mirror, circle and rectangle masks with feather and invert | C P R V F | yes | — | — |
| Heart and star shapes; rounded rectangle corners | C | yes (`set_mask`) | — | Shipped `8d8417e` ([[ADR-049 Masks turn rigidly and grow shapes without new fields]]). |
| Bezier pen mask | P R V F | no | P2 | Polygon SDF texture; L with on-canvas editing. |
| Several masks per clip | P R | no; `mask?` holds one | P2 | — |
| Mask tracking | P R V | no | P2 | After the tracker (§11). |
| AI subject cutout (Remove BG) | C P R V F | yes: the person or main subject, per frame (ADR-032, ADR-033) | — | — |
| Click-to-select object mask | P R V F OSS | no | P2 | Kdenlive 25.04 runs SAM2 locally, which shows a local model path; its masks could reuse the Remove BG matte pipeline. |
| Chroma key with spill | C P R V F | yes | — | — |
| Luma key | P R V F | no | P2 | One shader branch beside the chroma key. S. |
| Matte or alpha view | P R | no | P2 | — |

## 11. AI and analysis (all local)

The AI tools tab is `src/components/AiToolsTab.tsx`, with state in
`src/state/ai.ts` and detectors in `src/lib/analysis/`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Remove silences, split scenes, beat markers, normalize, ducking, captions, Copilot | C P R V F | yes | — | — |
| Auto reframe (follow the subject into 9:16 or 1:1) | C P R V F | yes: AI tools card and Tracking > Keep subject centered, `auto_reframe` (2026-10-17); the subject starts as a box, no detector | — | A face or saliency model, then a smoothed crop path written as `transform` keyframes. That needs no new render path. See [[AI and automation]] §2.8. L. |
| Motion tracking: pin text or a sticker to a subject | C R V F | yes: Animation > Tracking, `track_motion` (2026-10-17, ADR-054) | — | Template matching on 320 px gray frames, main thread like the other analyses; the path becomes smoothed `transform.x/y` keyframes. |
| Stabilize | C P R V F | yes: three levels, translation only, measured locally | — | See §2. |
| Remove background | C P R V F | yes (shipped 2026-10-16) | — | See §10. |
| Transcript or visual search over media | C P R F | no; name search only | P2 | Transcript search reuses Whisper (M). Visual search needs local CLIP-class embeddings at import (L). Final Cut 12.0 and Premiere's Media Intelligence both run this on the device. |
| Long video to shorts / highlight finder | C | partial: Copilot plus remove silences | P2 | A Copilot recipe over captions, scenes and reframe. |
| Prompt-driven first cut (CapCut EditPilot) | C | partial: Copilot with a local model | P2 | — |
| Script-matched take selection (IntelliScript) | R | no | P2 | — |
| Face retouch | C R | no | P2 | — |
| Auto multicam switching | R | no | P2 | After multicam. |

## 12. Export

The dialog is `src/components/ExportDialog.tsx`; the plan and settings
are in `src/lib/export.ts`; encoding is in `src/engine/export.ts`.

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| MP4/MOV/WebM/MKV; H.264, HEVC, VP9, AV1; 480p to 4K; bitrate; fps; range; audio-only; stills | C P R V F | yes | — | — |
| Named export presets (YouTube, Shorts/Reels/TikTok, archive) | P R V F | yes | — | Presets are data in `src/lib/export.ts`; user presets go beside effect presets. VEGAS 23 groups them by delivery use. |
| GIF export | C P OSS | yes | — | Desktop: FFmpeg `palettegen`/`paletteuse` on the rendered frames. Web: a small encoder in a worker. Cap at 640p as CapCut does. |
| MP3 and FLAC audio-only | C | partial: AAC (M4A) and WAV only (`AUDIO_FORMATS`) | P2 | Check mediabunny's encoders first; FFmpeg on desktop. |
| Export queue / batch | P R F OSS | no | P2 | One jobs list (Shotcut's Jobs panel is the model) that also shows proxies and analysis. |
| MP4 chapters from markers | P F | partial: marker text export gives YouTube timestamps | P2 | Chapter atoms in the muxer, if mediabunny supports them; otherwise desktop FFmpeg. |
| ProRes or DNxHR via FFmpeg | P R V F | no | P2 | Desktop only, through `src-tauri/src/ffmpeg.rs`. |
| Alpha export (ProRes 4444, VP9 alpha, PNG sequence) | P R V F | no | P2 | — |
| Cover / thumbnail designer | C | no | P2 | A still export with text layers. |
| Save the current frame from the player | C P | yes: camera button, Mod+Shift+E (2026-10-17) | — | Added by the everyday-gaps pass; it was only in the export dialog. "Import into project" is not offered. |
| Loudness-normalized export, true-peak limiter | P R V | partial: normalization to a target (sample peak held at -1 dBFS); no true-peak limiter | P2 | — |
| Smart render (stream copy of untouched GOPs) | P V | no | P2 | — |
| Several aspect versions in one go | C | no | P2 | After auto reframe. |

## 13. Project and media management

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Autosave, Save a copy, relink, folders and favorites, source monitor, usage counts | C P R V F | yes | — | — |
| Proxies on demand for heavy decodable media (4K HEVC, long GOP) | C P R V F | partial: desktop proxies only for codecs the webview cannot decode (`Asset.proxy`); web proxies on the [[Roadmap]] | P1 | A "Make proxy" action and a project toggle, using the existing FFmpeg path and the planned mediabunny `Conversion`. |
| Preferences: default still length, step size, cache location, hardware acceleration | C P R V F | partial: default lengths of pictures, titles and effects, and transitions (Edit > Preferences) | P2 | Step size, cache location and hardware acceleration remain; the step actions are named for 10 frames. |
| Remove media from the project; remove unused | P R | yes: media card menu > Remove from project, Manage media > Remove unused, `remove_media` (2026-10-17) | — | Added by the 2026-10-17 everyday-gaps pass; the survey had missed it. |
| Project trash / restore a deleted project | C | no; delete asks twice | P2 | Move to a trash folder in the platform layer. |
| Rename and duplicate a project from the home screen | C | yes: card buttons (2026-10-17) | — | Added by the everyday-gaps pass; both go through the platform's existing load and save, so desktop and web behave alike. |
| Hover-scrub on media cards | C P V F | yes (`HoverScrub` in `LibraryPanel.tsx`) | — | The thumbnail sprite already exists. |
| Collect or archive a project with its media | P R F V | no | P2 | Copy sources beside the JSON and rewrite paths. |
| Tags, metadata columns, smart bins | P R F | partial: list view and folders | P2 | — |
| Image sequence import | P R | no | P2 | — |
| Timeline snapshots / version compare | R | partial: Save a copy | P2 | — |

## 14. Recording

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Voiceover from a microphone | C P R V F | yes (see §5) | — | See §5. |
| Screen recording | C V | no | P2 | `getDisplayMedia` + `MediaRecorder`; confirm WebView2 support. |
| Webcam recording | C | no | P2 | Shares the voiceover recorder. |
| Teleprompter while recording | R | no | P2 | — |

## 15. Keyboard and customization

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| CapCut keymap, searchable shortcuts panel, chords in tooltips | C P R V F | yes | — | — |
| Rebind keys with conflict warnings and Reset to default | C P R V F | yes: the shortcuts panel edits the keymap | — | Store overrides outside the project; `buildIndex` already resolves conflicts. Edit them in `ShortcutsDialog.tsx`. |
| Premiere and Final Cut keymap presets | C | no | P2 | Data files once rebinding exists. |
| Keys for actions with no binding yet: group, insert, overwrite, nudge, lift, extract, loop, solo | P R F | partial: all bound but solo | P1 | Add them with each feature. |

## 16. Accessibility

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Keyboard-operable menus, text contrast, reduced motion in previews | — | yes (UX-11, UX-19 fixed) | — | — |
| Reach timeline clips from the keyboard (UX-33) | P R F | yes | — | Roving focus over clips in `Timeline.tsx`. |
| 24 px minimum hit targets (UX-31) | — | yes (the keyframe arrows are 18 x 24) | — | Same visuals, larger hit areas. |
| UI scale setting | P R F | no | P2 | Ctrl+= is timeline zoom, so it has to be a preference. |
| Light theme or brightness | P V | no; tokens exist on `:root` (`src/styles/app.css`) | P2 | Some colors are hard-coded (e.g. the ruler canvas in `Timeline.tsx`). M. |
| Interface languages | C P R V F | no | P2 | L. |

## 17. Workspace and layout

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| Resizable panels, remembered; double-click a splitter to reset it | C P R V F | yes (`App.tsx` layout in localStorage) | — | — |
| Proportional defaults, layout presets, Reset layout (UX-30) | C P R V F | yes | — | Store fractions; add presets (Default, Media first, Player first, Timeline first) under View. S. |
| Floating or docked panels, a second viewer window | P R V | no | P2 | VEGAS 23 docks on all four sides. L. |

## 18. Interchange

| Feature | Apps | Have | Pri | Implementation note |
|---|---|---|---|---|
| OTIO export, SRT/VTT import and export | P R | yes | — | — |
| OTIO import | R OSS | no | P2 | Reverse of `src/lib/interchange/otio.ts`. Kdenlive's OTIO also drops effects, as ours does. |
| FCP7 XML, FCPXML, EDL export | P R V F | no | P2 | — |
| ASS/SSA subtitles | OSS | no | P2 | — |

## Out of scope (cloud)

These need an account or a server, so we do not recommend them. Generative
features can come back later as opt-in BYO-key plugins ([[Roadmap]]).

- CapCut: Spaces sync, stock music/video/sticker/effect libraries,
  templates marketplace, AI media generation (Seedance, Kling, Veo), AI
  avatars, video translator with lip sync, AI stylize, AI expand, AI
  music, copyright check, direct TikTok/YouTube upload, EditPilot's cloud
  models, Director Mode.
- Premiere: Generative Extend, Firefly Boards, the Generative Media Tool
  (26.5), Adobe Stock, Frame.io review.
- VEGAS: cloud text to speech and speech to text (VEGAS moved both to the
  cloud).
- Any stock library. A local "Yours" library of the user's own reusable
  assets across projects is in scope (P2).

## Lessons from open-source editors

- **Shotcut** puts align buttons (left, center, right, top, middle, bottom)
  and size modes (Fit, Fill, Distort) in one "Size, Position & Rotate"
  filter. Our Fit/Fill/Stretch row belongs beside the align row.
- **Shotcut 24.10** runs whisper.cpp locally and shows long work as two
  jobs in a Jobs panel. One jobs list for exports, proxies and analysis is
  the pattern to copy.
- **Kdenlive** runs Whisper and Vosk locally, and since 25.04 runs SAM2
  object segmentation on the device. That confirms ADR-007 and gives the
  `bg-removal` branch a model path for object masks.
- **Kdenlive's** rewritten OTIO exchange leaves effects behind, the same
  limit as ours. Users accept it when it is documented.

---

## Recommended build order

Ordered by value to a CapCut user first, then pros; all items run locally.
Sizes: **S** is about one small commit with a test, **M** a few commits or
a new panel, **L** a new model, analysis pass or engine path.

1. **Land `timeline-ux`** (UX-12 overlay on drop, UX-13 truthful drop
   preview, UX-14 linkage). S. Shipped (merged `b45c1f8`).
2. **Crop with ratio presets and on-canvas crop.** M. Shipped (`68d15cf`,
   `e09a3f7`; flips `8cd42ae`).
3. **Record voiceover.** M. Shipped (`601d895`).
4. **System fonts in the picker, plus font file import.** M. Shipped (`8b0feed`).
5. **Arrow-key nudge in the viewer** (1 px, Shift 10 px). S. Shipped (`212dab1`).
6. **Viewer zoom and pan.** M. Shipped (`c9eec5a`).
7. **Flip H/V buttons in Transform, plus a `set_flip` command.** S. Shipped (`2ee3e94`).
8. **Track solo, track volume and rename in the header.** S. Shipped (`1edafde`).
9. **Multi-selection transform handles on the canvas.** M. Shipped
   (`23c1d14`).
10. **Group and ungroup (Ctrl+G).** M. Shipped (`6c49fea`).
11. **Replace clip.** S. Shipped (`aef4b95`).
12. **Clip nudge by frames, and close or delete gaps.** S. Shipped (`953f1c0`).
13. **Loop playback and play In to Out.** S. Shipped (`8d1c03b`).
14. **Audio crossfades at cuts and under transitions.** M. Shipped under
    transitions (`e0fb7fd`); plain cuts keep their 4 ms click guard.
15. **Track height (S/M/L and drag).** S. Shipped as S/M/L (`1edafde`).
16. **Layout presets, proportional defaults, Reset layout** (UX-30). S.
    Shipped (`c8d42c8`).
17. **Fit / Fill / Stretch quick actions.** S. Shipped (`2932ff5`).
18. **Mask handles on the canvas, plus heart, star and rounded corners.** M.
    Shipped (`8d8417e`, `d89987f`).
19. **Named export presets and GIF export.** M. Shipped (`77a5a81`).
20. **Word-level captions: karaoke highlight and filler-word removal.** M.
    Highlight shipped; filler removal open: Whisper leaves most fillers out
    of its transcripts (see [[AI tools]]).
21. **Custom key bindings with conflict warnings.** M. Shipped (`c6a8bef`).
22. **Local noise reduction** (DeepFilterNet/RNNoise). M. Shipped as a
    spectral gate (`057d298`); a learned model is the upgrade.
23. **Anchor point.** M. Shipped (this round, `anchorX`/`anchorY`).
24. **Local text to speech** (Kokoro/Piper). L. Shipped (`7a40079`).
25. **Stabilize.** L. Shipped, translation only (`33a2da0`).

Next after these: rate stretch tool (S), insert/overwrite buttons and keys
(S), lift/extract (S), LUFS meter (S), preferences (S), picture border and
shadow (M), frame blending (M), EQ (M), auto adjust (M), proxies on demand
(M), keyboard clip focus (M), transcript editing (L), auto reframe (L),
motion tracking (L). The parked `compound-clips` branch comes back when
its owner resumes it; `bg-removal` shipped on 2026-10-16.

## Items not confirmed in the code

- **Audio scrubbing:** nothing in `src/engine/player.ts` or
  `src/engine/audio.ts` plays sound while scrubbing, but a drive should
  confirm it.
- **Hover-scrub on media cards:** shipped later the same day (`HoverScrub`
  in `LibraryPanel.tsx`).
- **Transitions on overlay tracks:** `set_transition` only needs adjacent
  clips on one track, so overlays probably work; not driven.
- **Mono-to-both playback:** assumed from Web Audio's default upmix, not
  tested.

## Sources

**CapCut**
- https://www.capcut.com/help/layout-effect-poor (desktop: align and distribute a multi-selection, 1 px arrow nudging, zoom up to 400%)
- https://www.capcut.com/help/why-do-i-have-to-pay-for-auto-reframe (desktop auto reframe from the right-click and Video menus)
- https://www.capcut.com/help/keyframes-in-capcut-pc, https://www.capcut.com/help/export-videos-in-capcut, https://www.capcut.com/help/auto-captions-in-capcut (via [[CapCut desktop]])
- https://www.capcut.com/resource/multicam-editing, https://www.capcut.com/resource/capcut-stabilizer, https://www.capcut.com/tools/optical-flow, https://www.capcut.com/tools/text-to-speech
- https://www.capcut.com/resource/edit-talking-head-videos-faster-editpilot-capcut-pc (EditPilot)
- https://pixflow.net/blog/capcut-2026-update/ and https://www.hooked.so/guides/capcut-updates (2026 timeline; the 2026 desktop releases are mostly AI)

**Premiere**
- https://helpx.adobe.com/dk/premiere/desktop/add-text-images/align-and-distribute-objects/distribute-objects.html (Properties panel: Align and Transform, distribute)
- https://community.adobe.com/announcements-727/welcome-to-premiere-26-2-1557825/index1.html (26.2: Sequence Index, global mute, marker search, Color Mode beta)
- https://www.newsshooter.com/2026/01/20/whats-new-in-adobe-premiere-pro-26-0/ (26.0: object masking, bezier shape masks, interactive fades)
- https://blog.adobe.com/en/publish/2025/04/02/introducing-new-ai-powered-features-workflow-enhancements-premiere-pro-after-effects (25.2: Generative Extend, on-device Media Intelligence, caption translation)

**Resolve**
- https://www.redsharknews.com/davinci-resolve-21-final-release-record-beta (21: Cut/Edit keyframing, font browser, timeline snapshots, folder tracks)
- https://www.sportsvideo.org/2026/09/09/ibc-2026-blackmagic-design-releases-davinci-resolve-21-1/ (21.1: new Cut trim modes, subtitle editor)
- https://www.provideocoalition.com/davinci-resolve-20-released/ (20: IntelliScript, animated subtitles, SmartSwitch, keyframe curve view, voiceover palette)

**VEGAS Pro**
- https://digitalproduction.com/2025/09/10/vegas-pro-23-boosts-engine-streamlines-colour-grading-modernises-interface/ (23: dockable grading, OFX keyframe envelopes, use-case export presets, modernEQ)
- https://www.redsharknews.com/vegas-pro-22-review-ai-features-enhance-editing-more (22: text-based editing, auto reframe, beat detection)

**Final Cut Pro**
- https://support.apple.com/102825 (release notes 11.0 to 12.4: Magnetic Mask, adjustment clips, Beat Detection, Transcript and Visual Search, Generate Captions, Match Color, Edit Detection, two-up trim)
- https://larryjordan.com/articles/new-features-in-apple-final-cut-pro-12-3/

**Open source (lessons only)**
- https://forum.shotcut.org/t/size-position-rotate-video-filter/12881 (Size, Position & Rotate: align and size modes)
- https://shotcut.org/blog/new-release-241029/ (Shotcut 24.10: whisper.cpp speech to text, Jobs panel)
- https://kdenlive.org/news/releases/25.04.0/ (Kdenlive 25.04: local SAM2 segmentation, OTIO rewrite)
