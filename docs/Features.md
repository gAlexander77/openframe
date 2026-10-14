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

## Inspector

- CapCut's tab matrix per clip type: Video (Basic, Mask, Chroma key),
  Audio, Speed, Animation (In/Out/Combo or Loop), Adjust (filter, color,
  effects), Text, Captions, Transition; project Details when nothing is
  selected.
- Every numeric row: slider, typed value with units, reset, keyframe
  cluster (‹ ◇ ›); keyframed properties auto-key at the playhead.

## Text and captions

- Text presets (title, lower third, outline, neon, caption, quote, label)
  with font, size, color, bold/italic/underline, alignment, spacing,
  stroke, shadow, background box, in/out/loop animations.
- **Word art**: 16 looks (neon, retro, comic, hollow, gold, fire, frost,
  candy, die-cut, chromatic, typewriter, highlight...) from fill, stroke,
  shadow and box combinations. Click with text selected (or drop on a
  text clip) to restyle it, keeping its words, size and layout.
- **Templates**: 12 animated title designs — name and title, name tag,
  subscribe callout, chapter title, quote card, countdown, location tag,
  big opener, news banner, social handle, end card, link in bio — built
  from text and box layers with staggered in/out/loop animations, each
  layer its own clip ([[ADR-025 Stickers and templates are ordinary
  clips]]). Agents: `add_text_template` (with replacement words) and
  `apply_word_art`.
- New text lands above everything showing at that time.
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks; caption list editing; apply style to all; SRT/VTT import and
  export.

## Library

- CapCut's tabs: Media, Audio, Text, Stickers, Effects, Transitions,
  Captions, Filters, Adjustment, with category sub-navigation.
- **Previews drawn by the engine**: filter, effect, transition and text
  cards show the real shaders and text rasterizer on a generated sample
  shot, or on the selected clip's own frame; effects, transitions and
  titles play a loop on hover (a still under reduced motion). Rendered
  lazily for visible cards, one at a time, cached
  ([[ADR-026 Library previews are drawn by the engine]]).

## Stickers

- **A local sticker library**: about 140 stickers in ten categories with
  search — emoji drawn from the system's color emoji font, and original
  graphics drawn in code (curved and scribble arrows, marker circles,
  underlines, highlighter, bubbles, comic bursts, subscribe/like/follow
  style badges, stars, hearts, checks). Nothing is downloaded.
- Click + or drag onto the timeline: the sticker lands above everything
  at that time at about a third of the frame, with a pop-in and a gentle
  loop (the tab's motion menu; per viewer). It is an ordinary image clip,
  so transform, blend, masks and animations all apply
  ([[ADR-025 Stickers and templates are ordinary clips]]).
- Rendered once to a PNG asset per project; adding the same sticker again
  reuses it, and stickers stay out of the Media tab.
- Agents: `add_sticker` by id, label or the emoji itself, with position,
  scale, duration and motion; `window.videoEditor.stickers()` lists them.

## Keyboard

- CapCut's in-app shortcut list, Premiere's where CapCut has none
  (`src/lib/keymap.ts`); a searchable shortcuts panel; tooltips show each
  button's chord, read from the keymap.

## Automation

- `window.videoEditor`: the command registry with JSON Schemas, actions,
  seek, import, and the viewer's pixels — the surface for drives, the
  planned MCP server and the headless renderer.
