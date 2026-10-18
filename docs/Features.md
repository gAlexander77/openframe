# Features

Everything the app does today, with the intent behind each. Kept
mechanically true to the code; "planned" items live in [[Roadmap]].

## Projects

- **Home screen** with a Create project card and canvas presets named for
  where the video goes (16:9 YouTube, 9:16 TikTok/Reels/Shorts, 1:1, 4:5,
  21:9), and searchable project cards with thumbnails. Delete asks twice;
  **Rename** (in place, without opening) and **Duplicate** ("Name copy",
  sharing the same media files) sit on each card, as in CapCut.
- **Canvas size in pixels** (project Details > Size, CapCut's custom
  ratio): any width and height from 16 to 8192, rounded to even numbers
  as encoders need; `set_project` also takes the frame rate.
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
- **Save a copy:** named independent edit versions, optionally opened after
  saving; source media stays shared. Failed writes keep the original open.

## Media

- Import from the picker, by dropping files anywhere in the window, or on
  the timeline (which also places them).
- Formats the platform decodes: MP4/MOV/MKV/WebM with H.264, HEVC (where
  the OS has it), VP8/9, AV1; MP3, WAV, AAC/M4A, FLAC, Ogg/Opus; PNG, JPEG,
  WebP, GIF, AVIF. On desktop, what the webview cannot decode (ProRes,
  DNxHR, MPEG-2...) gets an FFmpeg proxy when FFmpeg is installed; the web
  build refuses it with the codec named.
- Background filmstrips and waveforms, two files at a time.
- **Hover scrub** on video cards, as in CapCut: moving across a card shows
  the frame under the pointer, with a line, from the timeline's
  thumbnails (nothing extra decodes).
- Phone footage rotation honored.
- **Media organization:** combined name/type/used/unused filtering; import
  order, natural name and source-duration sorts; grid or compact metadata
  list. Usage counts select all referencing clips and seek the earliest.
  Counts follow edits/Undo, including references on inactive tracks.

- **Remove media** (Premiere's Clear and Remove Unused): right-click a
  media card for Add to timeline, Preview, Favorite and Remove from
  project; a file the timeline uses offers to take its clips with it.
  Manage media removes every unused file at once (`remove_media`). The
  files on disk are never touched; one undo step each.
- **Media recovery:** Manage media checks editing-source availability; Locate
  and Relink repair every clip reference while preserving edits, with Undo.
  Replacements require compatible streams and full source duration.
- **Folders and favorites:** saved virtual folders, undoable folder rename/delete
  and assignment, plus intersecting folder/favorite filters.
- **Source preview:** independent video/audio transport, scrubbing and frame
  stepping, In/Out range insertion, and still image preview. **Add range**
  places the range as the timeline would (CapCut); **Insert** (,) splits at
  the playhead and pushes what follows, **Overwrite** (.) covers what is
  there (Premiere's), on the main track or the first audio track.

## Timeline

- CapCut's toggles: main track **magnet** (gapless, reorders on drag),
  **snapping** with a cyan guide, **linkage** (titles, overlays and sound
  effects follow the shot under most of them through ripples and
  reorders; music beds spanning several shots stay put), **preview axis**
  (hover to preview).
- **Undo history**: right-click the toolbar's Undo or Redo for the last 20
  steps by name, nearest first; choosing one goes back (or forward) to it
  (VEGAS's undo list, Premiere's History panel).
- Select and blade tools; split, split all, delete left/right (Q/W),
  delete, ripple delete; freeze frame; mirror; rotate 90°; extract audio;
  deactivate clip; markers; in/out range.
- **Marker management** in the library and View menu: search notes or
  timecodes, filter by color, jump between notes, edit exact positions and
  labels, and undo deletion. **Delete shown** removes what the search and
  color filter show (a run of beat markers, say) in one undo step.
  Double-click a ruler flag to edit it. Markers
  beyond the last clip remain reachable without extending export duration.
- **Export marker text:** preview and save the displayed notes as exact
  timecodes or YouTube-style chapter timestamps. Search/color filters choose
  the exported set; chapter timing checks surface issues before saving.
- Drag to move (across tracks, above the top track for a new one),
  Alt-drag to duplicate, edge drags to trim (ripple on the magnetic main
  track), marquee select, Ctrl+wheel zoom at the cursor, ruler scrub,
  page-flip follow during playback, right-click menu.
- **Library drags land where the preview shows**, by CapCut's rules: video
  and images dropped above the tracks become a picture-in-picture overlay
  on a new track at the drop time; on the magnetic main track they insert
  at the nearest cut, never splitting a shot, and the later shots (with
  what linkage carries) slide aside to open the gap, with a bar at the
  cut. A busy row opens a new track, shown where it goes in; effects and
  filters outline the clip they attach to (on empty timeline, a layer
  there, whatever is selected); a transition marks its cut. The preview is
  a dry run of the drop itself
  ([[ADR-046 A drop preview is a dry run of the drop]]).
- **Group clips** (Ctrl+G; Ctrl+Shift+G ungroups; Edit menu and
  right-click; `group_clips`, `ungroup_clips`): grouped clips select,
  move, copy and delete together across tracks, each keeping its own
  settings; Alt+click picks one alone, as in Premiere. Pasted copies form
  their own group.
- **Clip labels** (right-click > Label; `set_clip_label`; Premiere's
  Label, Resolve's Clip Color): eight muted colors paint the selected
  clips' body and name strip, so an edit can be sorted by eye. Splits and
  copies keep the label.
- **Compound clips** (Alt+G, as in CapCut; Alt+Shift+G breaks one apart;
  Timeline menu and right-click; `create_compound_clip`,
  `break_compound_clip`, `edit_compound`): the selected clips, on any
  tracks, become one green clip that plays them as a nested timeline. Its
  own speed, transform, opacity, blend, color, effects, mask, animations,
  transitions and volume act on the whole, the way Premiere's nests do;
  its filmstrip and waveform show what is inside. Double-click it to edit
  inside, with a breadcrumb above the timeline to go back out; every
  compound clip that plays it changes. Break apart puts the clips back
  where they were. One undo history covers every level, saving and export
  take the whole project wherever you are, and OTIO carries it as a nested
  stack ([[ADR-037 Compound clips are nested timelines composited to a texture]]).
- **Replace clip** (right-click, as in CapCut; `replace_clip`): pick a
  file and it takes the clip's place, keeping its start, length (shorter
  only if the new source runs out), transform, effects, animations and
  sound settings; video and pictures swap freely, sound for sound.
- **Keyboard reach** on the timeline: Tab lands on the selected clip (or
  the first), arrows move between clips and tracks with a focus ring, and
  every edit key acts on it; screen readers hear its name and span.
- **Lift and Extract** (Premiere's ; and ', Timeline menu; `lift_range`):
  take the in/out range out of every unlocked track, cutting clips at its
  edges; Lift leaves the gap (the magnetic main track closes its own),
  Extract closes it. The marks clear after.
- **Close gap**: right-click an empty stretch of a track for Close gap
  (ripple the clips after it left) or Close all gaps on this track
  (Premiere's ripple delete of a gap, Resolve's Delete gaps; `close_gaps`).
- **Nudge clips** by a frame with Alt+Left/Right, five with Shift
  (Premiere's keys; `nudge_clips`), all or nothing: never past the start or
  over another clip.
- **Keyframed pan**: the Audio tab's Pan row (and the keyframe panel)
  animates pan like volume; a track's pan and a compound clip's add to it.
- **Channels** (Audio tab; `set_channel_fill`; Premiere's Fill Left and
  Fill Right): play one channel on both sides, for a lav recorded on one
  side; a mono file is upmixed first, so either choice keeps it whole.
  Paste Attributes copies it with the sound.
- **Equalizer** (Audio tab): low shelf (120 Hz), mid bell (1 kHz) and
  high shelf (8 kHz), -12 to +12 dB, on audio clips and a video's own
  sound; the same biquads in preview and export; copied by Paste
  Attributes with the rest of the sound.
- **Compressor** (Audio tab; CapCut's Enhance voice, Premiere's Dynamics):
  Off, Enhance voice, Gentle or Strong, then threshold, ratio and makeup;
  after the EQ, before volume, the same node in preview and export, and
  Normalize loudness measures through it. Evens out speech so export
  loudness reaches its target without heavy limiting
  ([[ADR-053 One compressor everywhere, measured as it plays]]).
- **Sound crossfades under transitions**: a video transition between two
  clips with sound overlaps their audio across the cut by half the
  transition each way (as far as both have handles) at constant power,
  Premiere's default audio transition, in preview and export alike.
- **Track header**: Solo on audio tracks (while any track is soloed, only
  soloed tracks sound); right-click for Rename (or double-click), Solo,
  Track volume and pan (a dB fader and a pan slider added to each clip's
  pan, one undo step per drag), Small/Normal/Large height and Delete
  track. Agents: `update_track` (solo, height, pan) and `delete_track`.
- Audio clips: draggable volume line (Shift for fine) and fade knobs; a
  selected video's own sound has them too, on its waveform strip (the
  whole range there takes 60 px of travel, the strip being 14 px tall).
- **Record voiceover** (the microphone in the timeline toolbar, as in
  CapCut): pick the input, optionally mute the project, then a 3-second
  countdown and the timeline plays from the playhead while recording.
  Stop keeps the take as `Voiceover N.wav` on an audio track, starting on
  the playhead's frame; Discard or Escape keeps nothing. The samples run on
  the playback clock, so the voice lands where it was heard, corrected for
  output latency, with the pre-roll dropped.
- Pro trim tools: ripple (T), roll (R), slip (Y) and slide (U), with
  readouts of what moves while dragging.
- **Rate stretch tool** (Shift+R, Premiere's Rate Stretch): drag a clip's
  edge and its speed changes so the same source fills the new length
  (0.1x to 100x); the end ripples later clips, the start stops at the clip
  before. Clips with a speed curve or a freeze keep their length.

- **Two-up trim preview:** actual clip-edge frames for trim/ripple/roll/slip/slide,
  clamped source times, one-step Undo and gesture cancellation.

## Workspace

- **Proportional panels**: library, player, inspector and timeline sizes
  are kept as shares of the window, so a bigger screen grows them all
  (CapCut's behavior). Drag the splitters (double-click resets one); View
  has Default, Large preview and Large timeline layouts and Reset layout.
- **Preferences** (Edit > Preferences, Ctrl+,; Premiere's Timeline
  preferences): the lengths new pictures (5 s), titles and effect layers
  (3 s) and transitions (0.5 s) start at. Per viewer, kept with the keymap
  and layout, never in a project.

## Viewer

- WebGL2 compositor: transforms, crop, 13 blend modes (CapCut's 11 plus
  Add, Difference, Exclusion), chroma key, masks, color adjustments,
  24 effects (including CapCut's Reduce image noise, Motion blur, Sketch
  and Halftone, and Premiere 26.3's **Magnify**: a round lens with its
  center, size, zoom and feather, keyframable to follow a pointer in a
  screen recording), 20 transitions, 17 looks, adjustment layers.
- **Masks** (Video > Mask, CapCut's shapes): linear, mirror, circle,
  rectangle with round corners, heart and star, with feather and invert;
  every number takes keyframes, and a rotated mask turns rigidly on any
  picture shape ([[ADR-049 Masks turn rigidly and grow shapes without new fields]]).
  While the Mask tab is open the viewer draws the mask's outline on the
  picture, rotated and mirrored with it: drag inside to move it, the edge
  handles to size it, the knob to turn it (45° catches; Ctrl turns
  freely), the arrow to feather it and a rectangle's corner dot to round
  it. Each drag is one undo step and keys animated numbers.
- On-canvas handles: move, scale, rotate. A moved picture snaps its edges
  and center to the canvas's and to other visible pictures', and to the
  safe margins and thirds while those viewer guides show, with a guide at
  the line; Ctrl moves freely, Shift keeps one axis.
- **Several pictures at once** (a multi-selection or a group): the viewer
  draws one box around the selected pictures showing under the playhead,
  each outlined inside it. Drag inside to move them all, with the same
  edge and center snapping; drag a corner to scale them together about
  the box's center, positions and sizes alike. Each drag is one undo step.
  Clicking a grouped picture on the viewer selects its group, as on the
  timeline (Alt picks it alone).
- **Crop on the canvas** (CapCut's Crop): the crop button in the timeline
  toolbar or the Crop section of the inspector shows the whole picture with
  the crop drawn over it, dimmed outside. Drag the eight handles, or the
  crop itself; ratios under the viewer (Free, Original, 16:9, 9:16, 1:1,
  4:3, 3:4, 4:5, 21:9) crop the largest centered area of that shape and
  keep it while dragging. Reset, Cancel (or Escape) and Done (or Enter);
  Done is one undo step. Works on rotated and mirrored pictures
  ([[ADR-048 Crop is cut from the source and edited on a copy]]).
- **Fit / Fill / Stretch** under Transform (Resolve's and Premiere's
  framing; `frame_clips`): fit shows the whole picture, fill covers the
  canvas and crops the overflow, stretch covers it exactly; each centers.
- **Flip** buttons under Transform (horizontal and vertical; `set_flip`),
  and **arrow keys** on the viewer after clicking it nudge the selected
  pictures 1 px (Shift: 10 px); a held key is one undo step, and the
  arrows step frames everywhere else.
- **Align** (CapCut's Transform row): left, center, right, top, middle,
  bottom against the canvas; with several clips selected, against their
  combined bounds, plus distribute for three or more
  ([[ADR-045 Align measures the resting box, one clip to the canvas]]).
  **Inside title safe** makes one clip stop at the title-safe line (the
  viewer's Title 80% guide) instead of the canvas edge.
- Frame-exact: the framecode drive proves the right source frame at 1x,
  2x and 0.5x across GOPs and backward seeks; the speed drive proves it
  for every frame of a ramp, a reversed ramp and a reversed clip.
- Playback on the audio clock with output-latency compensation; J/K/L
  shuttle; **Loop** (the transport's repeat button, Mod+L) goes round the
  in/out range when it holds the playhead, else the whole timeline; **Play
  in to out** (Mod+Shift+Space, Premiere's key) plays the range once;
  click the current timecode to **type where to go** (Premiere's Playhead
  Position): a timecode, digits read right to left (1000 is ten seconds),
  or +/- an offset (+15 is fifteen frames on);
  preview resolution Full/½/¼ (auto ½ above 1080p while playing).
- Stereo peak meter, and a **loudness line** under it (Premiere's
  Loudness Meter in one row): momentary, short-term and integrated LUFS
  of what plays (EBU R128, an AudioWorklet K-weighting the master bus),
  integrated since play started; it stays after a stop. On the drive it
  agrees with an offline BS.1770 measurement within 0.3 LU.
- **Viewer zoom** (Premiere's Program monitor zoom): Fit or 25 to 400 %
  of the project's own pixels from the transport, Ctrl+wheel to zoom at
  the pointer, the wheel (Shift: sideways) or a middle-button drag to pan;
  the handles, guides and crop and mask tools follow.
- **Ratio menu** in the transport bar, as in CapCut: change the canvas
  shape (16:9, 9:16, 1:1, 4:5, 4:3, 3:4, 21:9) without leaving the clip
  being edited; the short side is kept, and Undo restores the size.
- **Composition guides** in the Player header and View menu: safe margins
  (90% action / 80% title), rule of thirds, or both, and **TikTok, Reels,
  Shorts**: the parts of a 9:16 frame the apps' buttons, captions and
  header cover are shaded (the largest of each side in their ad specs:
  14% top, 35% bottom, 11% left, 19% right), and dragged pictures snap to
  the clear area's edges. Follow the canvas in portrait and full screen;
  preview only, excluded from exported pictures.
- **Canvas** fill behind letterboxed clips: blur or color (CapCut's
  Canvas).
- **Scopes** (Player header or View menu): luma waveform, RGB parade,
  vectorscope with 75% targets and the skin-tone line, and histogram, of
  the graded output; live while paused, 8 updates a second while playing
  ([[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]]).

## Inspector

- CapCut's tab matrix per clip type: Video (Basic, Remove BG, Mask),
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
- **Anchor point** (Premiere's): Anchor X/Y under Transform, as shares of
  the picture's size from its center. The anchor sits at the position, and
  scale and rotation (inspector, handles, keyframes) turn about it; the
  viewer marks it with a crosshair. Align still lines up the picture.
- **Uniform scale** switch under Transform, as in CapCut: off splits Scale
  into Scale X and Scale Y (keys copied, so nothing jumps); on joins them.
  Corner handles keep a stretched picture's proportions.
- Every color field has a **pipette** where the platform has the
  EyeDropper API (WebView2, Chromium): pick a color from anywhere on the
  screen, the viewer included (a text color from the footage, a chroma
  key's green before keying).
- Every numeric row: slider, typed value with units, reset, keyframe
  cluster (‹ ◇ ›); keyframed properties auto-key at the playhead.
- **Several clips at once** (Premiere 25's Properties panel): with more
  than one clip selected, Scale, Rotate and Opacity for the pictures and
  Volume for the clips with sound set all of them, one undo step; a value
  they disagree on shows "Mixed" until it is set.
- On a keyframe, an easing button beside the cluster opens the presets;
  the Transform header's ◇ keys (or unkeys) all four of its properties at
  once, as CapCut's section diamonds do.

- **Reusable effect presets:** local named stacks with animation, rename/delete,
  cross-project reuse and undoable application to unlocked visual clips.
- **Paste Attributes:** choose transform, color, audio and/or effects, with
  animation retiming and optional effect replacement. Clip timing stays intact.

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
- **Auto adjust** (Adjust > Basic, CapCut's): corrects exposure, levels
  and white balance from the clip's own frame at the playhead, measured
  with its adjustments off. Exposure only moves a median outside
  0.35-0.65 and never brightens the brightest 0.2% past white, so a frame
  dark by design (a dark-theme app, a night scene) is left as shot; white
  balance reads the midtone neutral pixels and leaves a frame of saturated
  color alone; every value stays within moderate limits. One undo step;
  `auto_adjust` for agents.
- The grade runs on clips and adjustment layers alike, every number is
  keyframeable, and preview and export render it with the same shader.
- Agents: `set_hsl`, `set_curve`, `set_color_wheel`, `apply_lut`, and
  `window.videoEditor.importLuts`.

## Speed

- **Standard**: one rate, 0.1x to 100x, with quick picks; the clip keeps
  its source and later clips move with the new length. Or type the
  **Duration** (CapCut's) and the speed follows, the same source filling it.
- **Frame blending** (Speed > Playback; `set_frame_blending`; Premiere's
  Time Interpolation): slow motion, or a source rate unlike the project's,
  mixes neighboring source frames instead of repeating them, in preview
  and export ([[ADR-051 Frame blending draws the layer twice from two cursors]]).
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
  stroke, shadow, background box, in/out/loop animations. **Case** (CapCut's
  Aa / AA / aa): shown as typed, UPPER, lower or Title, the typed words
  kept, on the canvas and in the inline editor alike.
- **Saved styles** (CapCut's Save as preset for text, Premiere's Text
  Styles): Text tab > Saved styles keeps a title's whole look under a
  name, in this viewer's storage so it is there in every project; a chip
  with a sample gives it to the selected title in one click, words kept.
- **A new title shows when added**: a title, template or sticker added at
  the playhead plays its In animation once, silently, and stops where it
  has settled (under reduced motion it goes straight there), so the viewer
  never shows an empty box
  ([[ADR-047 A new title shows by playing its In animation]]).
- **Fonts**: the built-in list, **Import font…** (TTF, OTF, WOFF; kept
  per viewer and loaded at startup, so preview, export and headless
  renders draw it) and **Installed fonts** (the computer's families through
  Local Font Access, asked once). A project whose font is missing here
  says so in the picker and falls back to the system font.
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
- **Spoken-word highlight** (a caption's Text tab > Spoken word, CapCut's
  caption highlight): the word being said draws in its own color. Auto
  captions keep each word's start time (`wordTimes`), trims and splits
  carry them, and an edited caption whose word count changed simply
  stops highlighting. `add_captions` takes `words`; `set_text` takes
  `highlight`.
- **Text to speech on this machine** (Text tab > Text to speech, as in
  CapCut): eight English voices from Kokoro-82M (Apache-2.0), Slow/Normal/
  Fast; the voice lands on an audio track at the title's start, one undo
  step. The first voice downloads the model (about 90 MB) once
  ([[ADR-050 Text to speech runs Kokoro on the user's machine]]).
- **Voiceover from a script** (agents: `add_voiceover`): every line spoken,
  laid one after another at its real length on a new Voiceover track (a
  line can be pinned to a time), with a caption per line timed to its
  voice, as one undo step; the answer says where each line landed so the
  footage can be cut to it. Two lines take about five seconds.
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks, or **one word at a time** (CapCut's short-form style); caption
  list editing; apply style to all; SRT/VTT import and export.
- **Find and replace** in captions (Captions tab; CapCut's;
  `replace_caption_text`): fix a misheard name everywhere, whole words
  and case as chosen, with a live match count; titles are left alone.
- **Edit by transcript** (Captions tab; Premiere's Text-Based Editing):
  the selected clip's track as text, clip by clip; select words and press
  Delete to cut them with the pause around them, gaps closed, one undo
  step; click a word to go there; the word under the playhead lights up.
  Pieces of a cut clip read on without hearing it again. Agents:
  `get_transcript` then `cut_ranges`. The words are kept for the session,
  not in the project; clips with a speed curve or reversed are left out.

## AI tools (all on this machine)

- **Remove silences**, **Split scenes**, **Beat markers**, **Normalize
  loudness** (EBU R128, to −14/−16/−23 LUFS without clipping; a mono clip
  is measured as it plays through the mix's equal-power center pan, -3 dB
  each side) and **Auto
  ducking** (music dips under speech as editable volume keyframes) and
  **Stabilize** (Video > Basic, as in CapCut, or the AI tools card: three
  levels, translation only, measured on this computer) and
  **Reduce noise** (a spectral gate for steady hiss and hum; the clip plays
  a cleaned copy, a video's sound extracted first) in the
  library's AI tools tab, one undo step each ([[AI tools]]).
- **Auto reframe** (CapCut's and Premiere's; AI tools card,
  `auto_reframe`): into 9:16, 1:1 or 4:5, the canvas reshaped and the clip
  filling it with position keyframes that keep its subject centered as it
  moves; or from a box, with Tracking > Keep subject centered.
- **Tracking** (CapCut's, in the layer's Animation tab; `track_motion`):
  pin a title, sticker or picture to a moving subject in the video under
  it. A box placed on the viewer is followed from the playhead on this
  computer and the layer gets position keyframes, a handful, editable
  like any others ([[ADR-054 Tracking writes position keyframes]]).
- **Sync audio by waveform** (CapCut's Sync video and audio, Resolve's
  Auto Sync Audio > Based on Waveform; `sync_audio`): select a separately
  recorded sound (a lav, a recorder) and its video, right-click, and
  "Sync audio by waveform" (or "Sync audio and mute camera sound")
  matches the two sounds' onsets on this computer and moves the audio
  clip into sync, exact to the sample, one undo step. Sound from before
  the camera rolled is trimmed off the head; unrelated sounds are
  refused. Also an AI tools card; `sync_to_clip` places a clip by a known
  offset ([[AI tools]]).
- **Remove filler words** (CapCut's and Premiere's; AI tools card,
  `remove_filler_words`): Whisper base or small on this computer
  transcribes the clip and its "um", "hmm" and "ah" are cut with the
  hesitation around each, the gaps closed. Whisper does not transcribe
  "uh" or "er", so those stay ([[Filler words]]).
- **Remove background** (CapCut's Video > Remove BG > Auto removal, also an
  AI tools card): a segmentation model on this computer cuts the person or
  main subject out of every frame, once, with progress and cancel; the
  clip then plays and exports over the tracks below in real time. Off
  keeps the matte, so On again is instant. ormbg on WebGPU, MediaPipe
  Selfie on WASM, both Apache-2.0, downloaded on first use
  ([[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]],
  [[ADR-033 Mattes are made once and stored as grayscale video]]).
  Chroma key sits under it on the same sub-tab.
- **AI assistant** (called Copilot until 2026-10-17, renamed because Microsoft and GitHub use the name): ask for an edit in words; a model on this computer (Ollama
  or LM Studio) applies it with the editing commands, undoable as a whole.

## Export

- CapCut's export dialog: MP4/MOV/WebM/MKV, H.264/HEVC/VP9/AV1 by what
  the device can encode, 480p to 4K, quality levels or a bitrate, frame
  rate, in/out range, audio-only (WAV/M4A/...) and still frames.
- **Save frame as PNG** from the player (the camera button, File menu,
  Mod+Shift+E, Premiere's Export Frame key): the frame under the playhead
  at the project's size, without the export dialog.
- Frame-exact and sample-synced (the export drive reads the framecode
  back); a canceled export never leaves a partial file.
- **Loudness** (Audio > Loudness; Premiere's Loudness Normalization): bring
  the mix to -14, -16 or -23 LUFS. A first pass measures the whole mix
  (BS.1770) and its peaks, then it is rendered through the gain that meets
  the target, with a limiter holding the raised peaks under -1 dBFS (up to
  6 dB of limiting; the whole mix is known, so it looks ahead for free).
  The result notes what it measured, what it reached and how much the
  limiter held. Gain alone stopped the RacePulse promo at -17 LUFS of -14;
  with the limiter it measures -14.3 in ffmpeg, peaks at -0.9 dBTP.
- **Presets** at the top of the dialog: YouTube 1080p and 4K, TikTok,
  Reels and Shorts, Small file (720p), High quality master (HEVC),
  Animated GIF and Audio only (WAV); changed settings read Custom and can
  be saved under a name (per viewer) and deleted.
- **Animated GIF** (Format: GIF, or the Animated GIF preset): the same
  frames the video export draws, 256 colors per frame (gifenc), 10 to 25
  fps with delays that add up to the real duration, silent, up to 720p
  and 60 seconds (it is built in memory). The GIF drive reads every frame
  back against the framecode fixture.
- **Timeline as OpenTimelineIO** (File > Export timeline): tracks, gaps,
  transitions, speed, titles, compound clips (nested stacks) and markers
  for DaVinci Resolve, Premiere's OTIO plugin and other editors
  ([[ADR-034 Timelines leave as OpenTimelineIO]]).
## Library

- **Solid color** in the Adjustment tab (CapCut's color background): a
  white layer on a new top track at the playhead, its color set in the
  inspector; drag it to place it.
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
- **Custom shortcuts**, as in Premiere's Keyboard Shortcuts: Change on any
  row and press the new keys; a chord another action uses is named and
  moves only on Replace. Remove, per-row reset and Reset all; changes are
  per viewer and survive restarts.

## Automation

Three doors, one engine ([[Automation]]):

- **Headless render**: `openframe --render project.json --out file`,
  JSON-line progress, exit codes.
- **MCP for agents** (opt-in, token-locked, local only): every editing
  command plus `preview_frame` and `preview_frames` (a contact sheet) so
  an agent can look at its work, `list_projects`, `open_project` and
  `new_project` to move between projects as the home screen does, and
  `export_video` / `export_status` to make the file; HTTP or
  `--mcp-stdio`. Edits answer with only what they changed; `batch` runs
  many as one undo step; `frame_region` zooms a shot onto a rectangle of
  its picture, still or moving ([[ADR-052 Agents read what changed and export without a dialog]]).
- `window.videoEditor` in the page: commands, actions, import, render,
  pixels, animated values (`paramAt`) and the AI tools — what the drives
  use.
- Keyframe commands: `add_keyframe`, `move_keyframe`, `set_keyframe_ease`
  (preset or bezier), `remove_keyframes`.
- Workflow commands: `relink_media`, `remove_media`, `edit_media_folder`, `organize_media`,
  `apply_effect_preset`, `paste_attributes`.
- Layout commands: `align_clips` (with a `margin`, so titles of any width
  share one left edge inside the safe area), `distribute_clips`, `set_crop`
  (edges as source fractions, or the largest centered crop of a ratio) and
  `set_mask` (any shape and number, or none).
