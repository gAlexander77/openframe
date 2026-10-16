# Features

Everything the app does today, with the intent behind each. Kept
mechanically true to the code; "planned" items live in [[Roadmap]].

## Projects

- **Home screen** with a Create project card and canvas presets named for
  where the video goes (16:9 YouTube, 9:16 TikTok/Reels/Shorts, 1:1, 4:5,
  21:9), and searchable project cards with thumbnails. Delete asks twice.
- **Autosave** 800 ms after every change, never overlapping; "Saved 10:42"
  in the title bar; Ctrl+S saves now. No save dialog, as in CapCut.
- **Safe project switching:** edits made during a slow save are persisted
  before leaving; overlapping navigation requests are ignored. Save errors
  keep the project open. Home shows a loading status and supports keyboard
  opening/deletion without triggering both actions.
- **The first clip sets the canvas** size and frame rate on an empty
  timeline, so phone footage makes a vertical project — unless a canvas
  was chosen (a Home preset or the Details ratio), which it then keeps.
- **Open JSON format** ([[Project format]]).

## Media

- Import from the picker, by dropping files anywhere in the window, or on
  the timeline (which also places them).
- Formats the platform decodes: MP4/MOV/MKV/WebM with H.264, HEVC (where
  the OS has it), VP8/9, AV1; MP3, WAV, AAC/M4A, FLAC, Ogg/Opus; PNG, JPEG,
  WebP, GIF, AVIF. On desktop, what the webview cannot decode (ProRes,
  DNxHR, MPEG-2...) gets an FFmpeg proxy when FFmpeg is installed; the web
  build refuses it with the codec named.
- Background filmstrips and waveforms, two files at a time.
- Phone footage rotation honored.
- **Media organization:** combined name/type/used/unused filtering; import
  order, natural name and source-duration sorts; grid or compact metadata
  list. Usage counts select all referencing clips and seek the earliest.
  Counts follow edits/Undo, including references on inactive tracks.

## Timeline

- CapCut's toggles: main track **magnet** (gapless, reorders on drag),
  **snapping** with a cyan guide, **linkage** (overlays follow their shot
  through ripples), **preview axis** (hover to preview).
- Select and blade tools; split, split all, delete left/right (Q/W),
  delete, ripple delete; freeze frame; mirror; rotate 90°; extract audio;
  deactivate clip; markers; in/out range.
- **Marker management** in the library and View menu: search notes or
  timecodes, filter by color, jump between notes, edit exact positions and
  labels, and undo deletion. Double-click a ruler flag to edit it. Markers
  beyond the last clip remain reachable without extending export duration.
- **Export marker text:** preview and save the displayed notes as exact
  timecodes or YouTube-style chapter timestamps. Search/color filters choose
  the exported set; chapter timing checks surface issues before saving.
- Drag to move (across tracks, above the top track for a new one),
  Alt-drag to duplicate, edge drags to trim (ripple on the magnetic main
  track), marquee select, Ctrl+wheel zoom at the cursor, ruler scrub,
  page-flip follow during playback, right-click menu.
- Audio clips: draggable volume line (Shift for fine) and fade knobs.
- Pro trim tools: ripple (T), roll (R), slip (Y) and slide (U), with
  readouts of what moves while dragging.

## Viewer

- WebGL2 compositor: transforms, crop, 13 blend modes (CapCut's 11 plus
  Add, Difference, Exclusion), chroma key, masks, color adjustments,
  19 effects, 20 transitions, 17 looks, adjustment layers.
- On-canvas handles: move, scale, rotate, snapping to center guides.
- Frame-exact: the framecode drive proves the right source frame at 1x,
  2x and 0.5x across GOPs and backward seeks; the speed drive proves it
  for every frame of a ramp, a reversed ramp and a reversed clip.
- Playback on the audio clock with output-latency compensation; J/K/L
  shuttle; preview resolution Full/½/¼ (auto ½ above 1080p while playing).
- Stereo peak meter.
- **Composition guides** in the Player header and View menu: safe margins
  (90% action / 80% title), rule of thirds, or both. Follow the canvas in
  portrait and full screen; preview only, excluded from exported pictures.
- **Canvas** fill behind letterboxed clips: blur or color (CapCut's
  Canvas).
- **Scopes** (Player header or View menu): luma waveform, RGB parade,
  vectorscope with 75% targets and the skin-tone line, and histogram, of
  the graded output; live while paused, 8 updates a second while playing
  ([[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]]).

## Inspector

- CapCut's tab matrix per clip type: Video (Basic, Mask, Chroma key),
  Audio, Speed, Animation (In/Out/Combo or Loop), Adjust (filter and color),
  **Effects** (applied stack with its count), Text, Captions, Transition; project Details when nothing is
  selected.
- Applied effects have their own inspector tab, with enable/disable and
  removal controls, top-to-bottom reordering, reset including effect keys,
  Enable/Disable all, and undoable Remove all. Text/captions are supported.
  Tabs wrap at narrow widths so none are hidden offscreen.
- **Copy/Paste effects** between visual clips (including text/captions and
  adjustment layers), or onto a multi-selection in one undo step. Appends
  independent effect instances and animation; preserves existing effects
  and other clip settings. A session clipboard keeps normal clip/keyframe
  copying separate ([[ADR-038 Copied effects preserve animation and get new identities]]).
- Every numeric row: slider, typed value with units, reset, keyframe
  cluster (‹ ◇ ›); keyframed properties auto-key at the playhead.
- On a keyframe, an easing button beside the cluster opens the presets;
  the Transform header's ◇ keys (or unkeys) all four of its properties at
  once, as CapCut's section diamonds do.

## Keyframes

- **Keyframe animation panel** (CapCut's Show keyframe animation: toolbar,
  clip right-click menu, or its shortcut), docked under the tracks on the
  same time axis ([[ADR-023 The keyframe panel docks under the timeline
  tracks]]): one lane per animated parameter, and a value graph of the
  focused one in inspector units. Drag keys in time and value (Shift locks
  an axis, the axis holds still mid-drag), drag bezier handles on a
  selected key's segments, Shift+click to add, box-select, click to seek;
  one-click keys for a clip with none.
- **Easing presets** wherever keys are selected, with curve previews:
  Linear, Hold, Ease in, Ease out, Ease in-out, Smooth, Fast in, Overshoot
  (passes once, no bounce), Anticipate. Presets beyond the named five and
  hand-drawn curves are stored as CSS beziers.
- **Diamonds on the selected clip**: click to select (Shift/Ctrl adds),
  drag to retime with snapping to the playhead and the other keys,
  right-click for easing, double-click to seek; the tooltip names what is
  keyed at that frame.
- Delete, Copy, Paste and Escape act on selected keyframes before clips
  ([[ADR-024 Keyframes are selected by path and frame, and keys come
  first]]); paste lands at the playhead with spacing kept. A moved key
  replaces one it lands on, and keys stay inside their clip.

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

## Speed

- **Standard**: one rate, 0.1x to 100x, with quick picks; the clip keeps
  its source and later clips move with the new length.
- **Curve** (CapCut's curve speed): None, Custom, Montage, Hero time,
  Bullet time, Jump cut, Flash in, Flash out, and a graph editor. The graph
  has a log speed axis from 0.1x to 10x, draggable points, add at the
  playhead, delete, reset, a playhead line and the live duration. The line
  drawn is exactly what plays, and trims and splits keep the ramp
  ([[ADR-027 Speed curves are exponential and anchored to clip frames]]).
- **Reverse**: frame-exact, on any GOP length, with sound reversed too.
  Reversed 1080p plays without dropped frames ([[ADR-028 Reverse and
  retimed sound are made in the engine]]).
- **Change pitch**: off by default, as in CapCut. Voices keep their pitch
  at any speed and through ramps; on, pitch follows the speed like tape.
  Sound stays within a frame of the picture in preview and export.

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
- **Type on the canvas**, as in CapCut: double-click a title or caption in
  the viewer or on the timeline (or press Enter with it selected) and a
  caret appears in the rendered text with everything selected; the frame redraws as you type,
  in the real style. Escape or a click outside finishes, and the whole
  session is one undo step. Enter breaks a title's line; in a caption it
  finishes and Ctrl+Enter breaks the line. Shortcuts stay off while typing
  ([[ADR-030 The canvas text editor is a transparent textarea over the
  engine's text]], [[ADR-031 Typing into a text clip is one live session]]).
- The inspector's Text box is live too, and mirrors typing on the canvas.
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks; caption list editing; apply style to all; SRT/VTT import and
  export.

## AI tools (all on this machine)

- **Remove silences**, **Split scenes**, **Beat markers**, **Normalize
  loudness** (EBU R128, to −14/−16/−23 LUFS without clipping) and **Auto
  ducking** (music dips under speech as editable volume keyframes) in the
  library's AI tools tab, one undo step each ([[AI tools]]).
- **Copilot**: ask for an edit in words; a model on this computer (Ollama
  or LM Studio) applies it with the editing commands, undoable as a whole.

## Export

- CapCut's export dialog: MP4/MOV/WebM/MKV, H.264/HEVC/VP9/AV1 by what
  the device can encode, 480p to 4K, quality levels or a bitrate, frame
  rate, in/out range, audio-only (WAV/M4A/...) and still frames.
- Frame-exact and sample-synced (the export drive reads the framecode
  back); a canceled export never leaves a partial file.
- **Timeline as OpenTimelineIO** (File > Export timeline): tracks, gaps,
  transitions, speed, titles and markers for DaVinci Resolve, Premiere's
  OTIO plugin and other editors
  ([[ADR-034 Timelines leave as OpenTimelineIO]]).
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

Three doors, one engine ([[Automation]]):

- **Headless render**: `video-editor --render project.json --out file`,
  JSON-line progress, exit codes.
- **MCP for agents** (opt-in, token-locked, local only): every editing
  command plus `preview_frame` so an agent can look at its work; HTTP or
  `--mcp-stdio`.
- `window.videoEditor` in the page: commands, actions, import, render,
  pixels, animated values (`paramAt`) and the AI tools — what the drives
  use.
- Keyframe commands: `add_keyframe`, `move_keyframe`, `set_keyframe_ease`
  (preset or bezier), `remove_keyframes`.
