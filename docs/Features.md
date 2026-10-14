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
  WebP, GIF, AVIF. On desktop, what the webview cannot decode (ProRes,
  DNxHR, MPEG-2...) gets an FFmpeg proxy when FFmpeg is installed; the web
  build refuses it with the codec named.
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
- Pro trim tools: ripple (T), roll (R), slip (Y) and slide (U), with
  readouts of what moves while dragging.

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
- **Canvas** fill behind letterboxed clips: blur or color (CapCut's
  Canvas).

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
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks; caption list editing; apply style to all; SRT/VTT import and
  export.

## AI tools (all on this machine)

- **Remove silences**, **Split scenes**, **Beat markers** and **Normalize
  loudness** (EBU R128, to −14/−16/−23 LUFS without clipping) in the
  library's AI tools tab, one undo step each ([[AI tools]]).
- **Copilot**: ask for an edit in words; a model on this computer (Ollama
  or LM Studio) applies it with the editing commands, undoable as a whole.

## Export

- CapCut's export dialog: MP4/MOV/WebM/MKV, H.264/HEVC/VP9/AV1 by what
  the device can encode, 480p to 4K, quality levels or a bitrate, frame
  rate, in/out range, audio-only (WAV/M4A/...) and still frames.
- Frame-exact and sample-synced (the export drive reads the framecode
  back); a canceled export never leaves a partial file.

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
  pixels and the AI tools — what the drives use.
