# Features

Everything the app does today, with the intent behind each. Kept
mechanically true to the code; "planned" items live in [[Roadmap]].

## Projects

- **Home screen** with a Create project card and canvas presets named for
  where the video goes (16:9 YouTube, 9:16 TikTok/Reels/Shorts, 1:1, 4:5,
  21:9), and searchable project cards with thumbnails. Delete asks twice.
- **Autosave** 800 ms after every change, never overlapping; "Saved 10:42"
  in the title bar; Ctrl+S saves now. No save dialog, as in CapCut.
- **The first clip sets the canvas** size and frame rate on an empty
  timeline, so phone footage makes a vertical project.
- **Open JSON format** ([[Project format]]).

## Media

- Import from the picker, by dropping files anywhere in the window, or on
  the timeline (which also places them).
- Formats the platform decodes: MP4/MOV/MKV/WebM with H.264, HEVC (where
  the OS has it), VP8/9, AV1; MP3, WAV, AAC/M4A, FLAC, Ogg/Opus; PNG, JPEG,
  WebP, GIF, AVIF. Files the webview cannot decode are refused with the
  codec named (the desktop app proxies them with FFmpeg — in progress).
- Background filmstrips and waveforms, two files at a time.
- Phone footage rotation honored.

## Timeline

- CapCut's toggles: main track **magnet** (gapless, reorders on drag),
  **snapping** with a cyan guide, **linkage** (overlays follow their shot
  through ripples), **preview axis** (hover to preview).
- Select and blade tools; split, split all, delete left/right (Q/W),
  delete, ripple delete; freeze frame; mirror; rotate 90°; extract audio;
  deactivate clip; markers; in/out range.
- Drag to move (across tracks, above the top track for a new one),
  Alt-drag to duplicate, edge drags to trim (ripple on the magnetic main
  track), marquee select, Ctrl+wheel zoom at the cursor, ruler scrub,
  page-flip follow during playback, right-click menu.
- Audio clips: draggable volume line (Shift for fine) and fade knobs.
- Pro trim operations exist as ops and commands (roll, slip, slide,
  ripple trim) — their dedicated UI tools are planned.

## Viewer

- WebGL2 compositor: transforms, crop, 13 blend modes (CapCut's 11 plus
  Add, Difference, Exclusion), chroma key, masks, color adjustments,
  19 effects, 20 transitions, 17 looks, adjustment layers.
- On-canvas handles: move, scale, rotate, snapping to center guides.
- Frame-exact: the framecode drive proves the right source frame at 1x,
  2x and 0.5x across GOPs and backward seeks.
- Playback on the audio clock with output-latency compensation; J/K/L
  shuttle; preview resolution Full/½/¼ (auto ½ above 1080p while playing).
- Stereo peak meter.
- **Scopes** (Player header or View menu): luma waveform, RGB parade,
  vectorscope with 75% targets and the skin-tone line, and histogram, of
  the graded output; live while paused, 8 updates a second while playing
  ([[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]]).

## Inspector

- CapCut's tab matrix per clip type: Video (Basic, Mask, Chroma key),
  Audio, Speed, Animation (In/Out/Combo or Loop), Adjust (filter, color,
  effects), Text, Captions, Transition; project Details when nothing is
  selected.
- Every numeric row: slider, typed value with units, reset, keyframe
  cluster (‹ ◇ ›); keyframed properties auto-key at the playhead.

## Color

- CapCut's Adjust sub-tabs with Resolve and Lumetri math underneath
  ([[ADR-020 The grade lives in adjust, in Lumetri's order]]):
  - **Basic**: filter looks and the temperature, tint, saturation,
    vibrance, hue, exposure, contrast, highlights, shadows, whites, blacks,
    sharpen, grain, fade and vignette sliders.
  - **HSL**: eight color ranges, hue, saturation and lightness each; only
    that color changes, grays never.
  - **Curves**: luma, red, green and blue; click to add a point, drag to
    shape, drag off the graph to remove; arrow keys nudge. Monotone cubic,
    so a curve never overshoots its points.
  - **Color wheel**: lift, gamma, gain and offset pucks (a vectorscope's
    geometry, so the wheel and the scope agree) with luminance rings.
  - **LUT**: import a 1D or 3D .cube (or drop one on the window), pick it,
    set its intensity ([[ADR-021 LUTs are files by reference, sampled as
    3D textures]]).
- The grade runs on clips and adjustment layers alike, every number is
  keyframeable, and preview and export render it with the same shader.
- Agents: `set_hsl`, `set_curve`, `set_color_wheel`, `apply_lut`, and
  `window.videoEditor.importLuts`.

## Text and captions

- Text presets (title, lower third, outline, neon, caption, quote, label)
  with font, size, color, bold/italic/underline, alignment, spacing,
  stroke, shadow, background box, in/out/loop animations.
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks; caption list editing; apply style to all; SRT/VTT import and
  export.

## Keyboard

- CapCut's in-app shortcut list, Premiere's where CapCut has none
  (`src/lib/keymap.ts`); a searchable shortcuts panel; tooltips show each
  button's chord, read from the keymap.

## Automation

- `window.videoEditor`: the command registry with JSON Schemas, actions,
  seek, import, and the viewer's pixels — the surface for drives, the
  planned MCP server and the headless renderer.
