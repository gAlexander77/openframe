# Features

Everything the app does today, with the intent behind each. Kept
mechanically true to the code; "planned" items live in [[Roadmap]].

## Projects

- **Home screen** with a Create project card and canvas presets named for
  where the video goes (16:9 YouTube, 9:16 TikTok/Reels/Shorts, 1:1, 4:5,
  21:9), and searchable project cards with thumbnails. **Delete** moves a
  project to **Recently deleted** at once, with **Undo** on the toast;
  there it waits 30 days (Restore, or Delete forever, which asks twice)
  and is then deleted for good. Agents never see it there
  ([[ADR-078 Deleted projects wait in Recently deleted, marked in their summary]]).
  **Rename** (in place, without opening) and **Duplicate** ("Name copy",
  sharing the same media files) sit on each card, as in CapCut, and in
  its right-click menu (Open, Rename…, Duplicate, Delete). A **list view**
  beside the search (CapCut's toggle) shows a row per project with its
  canvas, length and last edit; the choice is remembered per viewer.
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
- **No empty drafts:** a new project is saved once something is done in
  it; pressing Create and leaving at once keeps nothing on Home (undoing
  every edit counts as nothing done)
  ([[ADR-073 Templates land as a block and the web keeps what it imports]]).
- **Open JSON format** ([[Project format]]).
- **Save a copy:** named independent edit versions, optionally opened after
  saving; source media stays shared. Failed writes keep the original open.

## Media

- Import from the picker, by dropping files anywhere in the window, or on
  the timeline (which also places them).
- **Web build: imports by address are kept** in the browser's storage, as
  picked files are, so a project keeps playing when the address goes
  away; a toast shows the copy. Over 1 GB a file stays linked to its
  address, and a toast says so.
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

- **Record** from the camera or the screen (CapCut's Record; Media >
  Record, beside Import): a live pill with the elapsed time, Stop or
  Discard; the take (MP4 where the webview can record it, else WebM) is
  imported and placed at the playhead it started from. Checked in the
  web build with the browser's fake camera; the desktop app's camera and
  screen permissions are not checked yet.
- **Remove media** (Premiere's Clear and Remove Unused): right-click a
  media card for Add to timeline, Preview, Favorite and Remove from
  project; a file the timeline uses offers to take its clips with it.
  Manage media removes every unused file at once (`remove_media`). The
  files on disk are never touched; one undo step each.
- **Media recovery:** Manage media checks editing-source availability; Locate
  and Relink repair every clip reference while preserving edits, with Undo.
  Replacements require compatible streams and full source duration.
- **Rename media** (right-click a media card > Rename, or in the grid
  view double-click its name; `rename_media`): the project's name for the
  file, which stays as it is on disk; clips without a name of their own
  follow it. In the grid a double-click on the name renames and the rest
  of the card adds the file to the timeline; in the list view, a row's
  double-click always adds.
- **Folders and favorites:** saved virtual folders, undoable folder rename/delete
  and assignment, plus intersecting folder/favorite filters.
- **Source preview:** independent video/audio transport, scrubbing and frame
  stepping, In/Out range insertion, and still image preview. **Add range**
  places the range as the timeline would (CapCut); **Insert** (,) splits at
  the playhead and pushes what follows, **Overwrite** (.) covers what is
  there (Premiere's), on the main track or the first audio track.

## Timeline

- CapCut's toggles: main track **magnet** (gapless, reorders on drag, including a drop at the very front),
  **snapping** with a cyan guide, **linkage** (titles, overlays and sound
  effects follow the shot under most of them through ripples and
  reorders; music beds covering two or more complete shots stay put, even when one shot is longer), **preview axis**
  (hover to preview).
- **Undo history**: right-click the toolbar's Undo or Redo for the last 20
  steps by name, nearest first; choosing one goes back (or forward) to it
  (VEGAS's undo list, Premiere's History panel). Agent edits use readable
  labels too, such as "Add clip" and "Change opacity".
- Select and blade tools; split, split all, delete left/right (Q/W),
  delete, ripple delete; freeze frame; mirror; rotate 90°; extract audio;
  deactivate clip; markers; in/out range (a cyan band on the ruler,
  which stays in view as the tracks scroll).
- **Linked picture and sound** (Premiere's linked clips, for J and L
  cuts): Extract audio keeps the video and its sound linked as a group,
  so they select, move and delete together; Alt-click takes one side
  alone, each edge trims on its own, and red frame counts (+15 / −15)
  show on both when one is moved out of sync. Ungroup unlinks them.
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
- **The clip menu** (right-click a clip; CapCut's and Premiere's): Cut,
  Copy, Paste, Duplicate, Delete, **Ripple delete**; Split, **Speed…**
  (opens the inspector's Speed tab), **Reverse** (a check: every selected
  clip that can play backward turns, by `set_reverse`'s own rule), Freeze
  frame, Extract audio, Replace clip; **Copy effects** and **Paste
  effects** (the inspector's effect clipboard, onto every selected clip
  that takes effects); Rename, Group, **Ungroup** (always listed, off
  unless a selected clip is grouped), Activate, compound clips; keyframes,
  range and Label. Every row runs the action or command the rest of the
  app uses. A menu taller than the window scrolls inside it.
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
- **Rename clips** (right-click > Rename, or double-click the name on a
  clip's strip; `rename_clip`; Premiere's Rename): the name shows on the
  timeline instead of the file's name, a title's words or an effect
  layer's effects; an empty name gives the default back. Titles keep
  CapCut's double-click for their words, so they rename from the menu.
  One undo step each.
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
  `duplicate_clips` with `unique: true` copies a compound clip with a
  timeline of its own, so a styled precomp (a floating window) is a
  template whose copies take other footage (`edit_compound` `replace_clip`).
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
  high shelf (8 kHz), -12 to +12 dB, on audio clips, a video's own
  sound and a compound clip (over the mix of everything in it); the same
  biquads in preview and export; copied by Paste Attributes with the
  rest of the sound.
- **Compressor** (Audio tab; CapCut's Enhance voice, Premiere's Dynamics):
  Off, Enhance voice, Gentle or Strong, then threshold, ratio and makeup;
  after the EQ, before volume, the same node in preview and export, and
  Normalize loudness measures through it. Evens out speech so export
  loudness reaches its target without heavy limiting
  ([[ADR-053 One compressor everywhere, measured as it plays]]). On a
  compound clip it compresses the mix of everything inside as one bus,
  after its EQ and before its volume and fades; export's windows start a
  second early so a compressor never starts cold
  ([[ADR-100 A compound clip's sound is a bus, and a bed keeps its balance in every take]]).
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
  clamped source times, one-step Undo and gesture cancellation. In a short
  player the frames shrink so its header and footnote always show.

## Workspace

- **Proportional panels**: library, player, inspector and timeline sizes
  are kept as shares of the window, so a bigger screen grows them all
  (CapCut's behavior). Drag the splitters (double-click resets one); View
  has Default, Large preview and Large timeline layouts and Reset layout.
- **About** (Help > About, on Home and in the editor): name, version and
  platform; the GPL-3.0-only license with a link to its text; links to the
  source code, the user guide and [[Third-party licenses]]; and the
  open-source packages the app uses directly, with versions and licenses,
  read from `package.json`, the installed packages, `Cargo.toml` and
  `Cargo.lock` when the app is built (`src/lib/about.ts`), so the list
  cannot drift. The desktop app opens these pages by name through Rust
  (`about_open`), never a URL from the webview; the web build opens a tab.
- **Preferences** (the gear in the title bar, Edit > Preferences, Ctrl+,;
  Home too; Premiere's Timeline preferences): the lengths new pictures
  (5 s), titles and effect layers (3 s) and transitions (0.5 s) start at,
  and audio scrubbing. Per viewer, kept with the keymap and layout, never
  in a project.

## Viewer

- WebGL2 compositor: transforms, crop, 13 blend modes (CapCut's 11 plus
  Add, Difference, Exclusion), chroma key, masks, color adjustments,
  26 effects (**Blur** up to a 300-pixel radius at 1080p, amount 500, for
  big soft glows: past the old maximum of 100 it runs on a downsampled
  pyramid, and up to 100 it draws exactly as before,
  [[ADR-069 Large blurs run on a downsampled pyramid]]; CapCut's Reduce image noise, Motion blur, Sketch
  and Halftone, Premiere 26.3's **Magnify**: a round lens with its
  center, size, zoom and feather, keyframable to follow a pointer in a
  screen recording, and **Zoom** and **Letterbox** for epic edits),
  24 transitions, 17 looks, adjustment layers. The **Strobe flash**
  starts at 2 flashes a second: more than 3 can trigger seizures (WCAG
  2.3.1), so keep it there.
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
- **Viewer selection** uses the picture's on-canvas box, top track first,
  skipping hidden and locked tracks. Empty canvas or stage space deselects;
  rotation and crop use the same geometry as the transform handles.
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
- **Motion path** (Premiere's): a selected picture whose position is
  keyframed shows the dashed line its center travels, with a dot at each
  position key, so a tracked or reframed path reads at a glance.
- **Flip** buttons under Transform (horizontal and vertical; `set_flip`),
  and **arrow keys** on the viewer after clicking it nudge the selected
  pictures 1 px (Shift: 10 px); a held key is one undo step, and the
  arrows step frames everywhere else.
- **Align** (CapCut's Transform row): left, center, right, top, middle,
  bottom against the canvas; with several clips selected, against their
  combined bounds, plus distribute for three or more
  ([[ADR-045 Align measures the resting box, one clip to the canvas]]).
  **Inside title safe** makes one clip stop at the title-safe line (the
  viewer's Title 90% guide) instead of the canvas edge.
- Frame-exact: the framecode drive proves the right source frame at 1x,
  2x and 0.5x across GOPs and backward seeks; the speed drive proves it
  for every frame of a ramp, a reversed ramp and a reversed clip.
- Playback on the audio clock with output-latency compensation; J/K/L
  shuttle; **Go to start** and **Go to end** buttons around the frame
  steps in the transport (CapCut's and Premiere's, the keymap's Home and
  End actions, so their tooltips name the keys as rebound); **Loop** (the transport's repeat button, Mod+L) goes round the
  in/out range when it holds the playhead, else the whole timeline; **Play
  in to out** (Mod+Shift+Space, Premiere's key) plays the range once;
  click the current timecode to **type where to go** (Premiere's Playhead
  Position): a timecode, digits read right to left (1000 is ten seconds),
  or +/- an offset (+15 is fifteen frames on);
  preview resolution Full/½/¼ (auto ½ above 1080p while playing).
- **Audio scrubbing** (CapCut's, Premiere's "Play audio while
  scrubbing"): dragging the playhead on the ruler while paused plays
  90 ms snippets of the mix where it lands, one after another, through
  playback's own scheduler, so every effect and fade is heard; never while
  playing. Preferences > Playback turns it off
  ([[ADR-079 Audio scrubbing plays snippets through the playback scheduler]]).
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
  (93% action / 90% title, SMPTE ST 2046-1), rule of thirds, or both, and **TikTok, Reels,
  Shorts**: the parts of a 9:16 frame the apps' buttons, captions and
  header cover are shaded (the largest of each side in their ad specs:
  14% top, 35% bottom, 11% left, 19% right), and dragged pictures snap to
  the clear area's edges. Follow the canvas in portrait and full screen;
  preview only, excluded from exported pictures. The action box is
  labeled at its top and the title box at its bottom, so the labels never
  meet on a small picture.
- **Canvas** fill behind letterboxed clips: blur or color (CapCut's
  Canvas).
- **Scopes** (Player header or View menu): luma waveform, RGB parade,
  vectorscope with 75% targets and the skin-tone line, and histogram, of
  the graded output; live while paused, 8 updates a second while playing
  ([[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]]).

## Graphics and compositing

- **Shape layers** (After Effects' shape layers, ADR-057): rectangle,
  rounded rectangle (1 is a pill), ellipse and line, with a solid or
  two-color gradient fill, an outline, and a draw-on amount (Trim Paths)
  that runs round the outline from its top center or along a line from its
  left end. Width, height, corners, outline thickness, draw and gradient
  angle all keyframe; drawn by the GPU at any size, so edges stay crisp at
  4K and under any scale or rotation. The Shape section of the Video tab
  edits them; the timeline names the clip after its shape. The pieces of
  lower thirds, callouts, CTA buttons and end cards (`add_shape`,
  `set_shape`).
- **Soft light** (ADR-069): a shape's **radial gradient** (from the
  center to its rim, an ellipse fitting the box, with a center and
  radius that keyframe) and **feather** (the shape blurred: the edge fades
  over that many pixels with a Gaussian's falloff, and a long ellipse
  feathered wider than it is tall stays one smooth glow, ADR-099) make
  soft background glows without
  image files; with the Blur effect at 300 to 500 they are as soft as
  any launch film's. Kind (Linear, Radial), Fade out, Radius, Center and
  Feather in the Shape section.
- **Drop shadow on pictures** (After Effects' Drop Shadow, ADR-070): any
  video, image, title, shape or compound clip casts a soft shadow (color,
  blur up to 600 px, offset, opacity, all but the color keyframable). It
  is cast by the finished picture, after its mask, crop, effects and
  track matte, so a rounded window casts a rounded shadow and a compound
  clip (footage, a border and a bar) casts one shadow for the whole
  floating window. Shadow section of the Video tab (`set_shadow`).
- **Border on pictures** (After Effects' Stroke layer style, outside,
  ADR-099): any video, image, title, shape or compound clip gets a border
  around its finished picture (color, width up to 200 px at 1080p,
  opacity; width and opacity keyframe). It follows the picture's edge
  after its mask, so a rounded picture-in-picture gets a rounded frame
  and a circle mask a ring; it keeps its width however the clip is
  scaled, fades with the clip, and the drop shadow is cast by the picture
  and its border together. Border section of the Video tab
  (`set_border`).
- **Perspective tilt** (CSS rotateX and rotateY, ADR-070): Tilt X and
  Tilt Y in the Transform section turn a picture in depth, seen from a
  camera 2000 pixels (at 1080p) in front of the canvas center, the
  picture drawn perspective-correct; both keyframe, so a window swings
  into place, and its shadow follows it (`set_tilt`).
- **Track mattes** (After Effects', ADR-056): a clip shows only where
  another clip's picture is opaque (Alpha) or bright (Luma), or the
  reverse: video inside text, logo and wipe reveals. The matte is the clip
  on the track directly above (keeps working after cuts) or a named clip;
  it is not drawn itself, and its own animation animates the reveal.
  Preview and export match to the level (`set_track_matte`; Compositing
  section of the Video tab).
- **Motion blur from movement** (ADR-058): a clip that moves (keyframes,
  in/out animations, wiggle) is averaged over a 180-degree shutter (or any
  angle to 720), with more samples the faster it travels; slides, pushes,
  zooms and spins between clips blur too. Full quality paused and in
  export, lighter while playing; still frames cost nothing
  (`set_motion_blur`).
- **Mirror edges** (Motion Tile's, ADR-059): a picture moved, shrunk,
  spun or shaken off the canvas fills it with mirrored (seamless) or
  repeated copies instead of black (`set_edge_mode`).
- **Wiggle** (After Effects' wiggle(), ADR-062): seeded smooth noise on
  position, rotation or scale for camera shake, nervous titles and floating
  logos, in pixels, degrees and percent; its strength keyframes to ramp a
  shake in or out, and the same seed repeats the same path (`set_wiggle`).
- **Spring, Elastic and Bounce** eases for keyframes, overshooting and
  settling exactly on the next value (ADR-062).

## Inspector

- Adding a transition or clicking its timeline marker opens its **Transition**
  settings immediately. Choosing another tab returns to that clip's controls.

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
- **One drag, one undo step**, on every slider (held arrow keys too) and
  on the color picker's square
  ([[ADR-072 One drag is one undo step and a typed value is kept]]).
- **Typed values are kept** however focus leaves the field (Enter, Tab,
  clicking another clip); Escape reverts. An empty or non-numeric entry
  changes nothing, a decimal comma reads as a point ("1,5" is 1.5), and a
  unit after the number is ignored.
- **Sections remember** being open or closed, per section, across clips
  and reloads (in this browser, like the layout). A switch that opens
  rows (Low-pass, Reverb, Echo) scrolls them into view.
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
  (passes once, no bounce), Anticipate, Spring, Elastic, Bounce. Smooth to
  Anticipate and hand-drawn curves are stored as CSS beziers; Spring,
  Elastic and Bounce are named curves no bezier can draw (ADR-062).
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
  stroke, shadow, background box, in/out/loop animations. **A new title
  wraps inside the safe area** where it stands (`titleWrap`): a centered
  one within 90% of the width (the old default, so 16:9 is unchanged), on
  9:16 within the column the apps' buttons leave (0.62 centered, 0.7 on the
  column's own center), one off center within twice the room on its nearer
  side, so a long line wraps instead of running off. A width asked for is
  kept; titles already made keep theirs, so older projects draw the same;
  `export_versions` gives the titles it lays out again the new frame's
  width. A word wider than that still runs past it (`check_project` says
  so). **Case** (CapCut's
  Aa / AA / aa): shown as typed, UPPER, lower or Title, the typed words
  kept, on the canvas and in the inline editor alike.
- **Font weight** (100 thin to 900 black): the Text tab's Weight list
  shows the weights the chosen font really has (each face it draws), so
  a heavy display line pairs with a light one; Bold is weight 700, and a
  weight wins over it (`style.weight`, ADR-071).
- **Animated size, spacing and color** (ADR-071): a title's size, letter
  spacing and color keyframe (the diamonds beside Size, Spacing and
  Color), so a tracking expand, a grow or a color change plays; a
  left-aligned title keeps its left edge as it grows, a right-aligned one
  its right (`animate_text_style`, or `add_keyframe` on `style.size` and
  `style.letterSpacing`).
- **Enter splits a caption** at the caret while editing it on the canvas
  (CapCut's): the second half starts where its first word is spoken (or
  as far in as the characters go, untimed), each half keeps its words'
  timings, typing goes on in the second, and it is one undo step.
- **Caption looks** (CapCut's caption templates, Resolve 20's subtitle
  styles): the Captions tab offers Classic, Bold yellow, Boxed, Word pop
  (capitals with the spoken word highlighted), Neon and Minimal, each
  previewed on its card; one click restyles and places every caption,
  words and timings kept (`set_caption_look`). On a tall canvas a look,
  and `add_captions`' default style, is sized by the short side: a caption
  has the same pixels on 1080x1920 as on 1920x1080, instead of growing
  with the height to a dozen letters a line (a size asked for is kept).
- **Saved styles** (CapCut's Save as preset for text, Premiere's Text
  Styles): Text tab > Saved styles keeps a title's whole look under a
  name, in this viewer's storage so it is there in every project; a chip
  with a sample gives it to the selected title in one click, words kept.
- **Preview a new title**: a title, template or sticker added at
  the playhead plays its In animation once, silently, then returns to the
  original playhead. Reduced motion skips the preview. Pausing the preview
  cancels it without a later jump back
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
- New text lands above everything showing at that time, and never on a
  footage row (a B-roll row stays B-roll). A multi-layer template lands
  as one block of Text rows directly above the footage: overlapping
  layers stacked in order, layers that follow one another on one row; a
  later template reuses the same rows; its layers are grouped, so they
  select and move together (Alt+click picks one).
- **Animation presets preview on pick**, as in CapCut: choosing an In
  plays the clip from its start to where the In settles, an Out to the
  clip's last frame, a loop one cycle, once and silently. Each tile shows
  the motion: the layer settled and a dashed ghost where it starts (In),
  ends (Out) or swings to (loops), titles' per-letter, word and line
  presets as units part-way; the tile plays on hover.
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
  CapCut): thirteen English voices from Kokoro-82M (Apache-2.0), Slow/
  Normal/Fast and Best or Draft quality; the voice lands on an audio track
  at the title's start, one undo step with its speech file. The first
  voice downloads the model once: 325 MB at Best (full precision, on
  WebGPU or the CPU), 92 MB at Draft (8-bit)
  ([[ADR-050 Text to speech runs Kokoro on the user's machine]],
  [[ADR-084 Voiceover is read at full precision and finished like a recording]]).
- **Natural voice** (every voice the app makes; [[Natural voiceover 2026-10-19]]):
  read whole, a sentence at a time, at a narrator's speed (0.95); pauses
  at commas and sentence ends lengthened to a reader's (0.28 s, 0.55 s);
  a line the voice rushed read again slower; a low cut and a little
  presence; every line at one loudness; quiet room tone under the pauses
  instead of digital silence; faded edges; the voice compressor and a
  touch of room on the clip. `finish: clean` or `raw` for less.
- **Voiceover from a script, directed** (agents: `add_voiceover`): every
  line read and laid one after another at its real length on a new
  Voiceover track, with a caption per line timed to its voice, as one
  undo step with its speech files (undo leaves nothing in the library).
  Each line can have its own voice (several speakers in one call; blends
  such as `af_heart:70,af_bella:30`), speed, time (`at`, on a beat or a
  cut) and pause after; the gap after a line otherwise follows its ending
  (a comma runs on, a sentence rests, a paragraph rests longer). Pauses
  inside a line are written in it (`[pause 0.4]`, `[beat]`,
  `<break time="0.4s"/>`) and lengthen the voice's own pause there, so
  the sentence keeps its intonation; captions never show them.
  `pronounce` respells names and acronyms for the voice while captions
  keep the words ([[ADR-083 Voiceover lines are directed in the script and keep it]]).
  Each line lands on a pace: a narrator's 2.3-2.8 words a second (or an
  ad's, a social video's, or as asked), its speed chosen by reading and
  measuring it, never by stretching the audio. A word cannot be marked
  for emphasis: the voice model has no such control, measured
  ([[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]]).
- **Listen back** (agents: `review_voiceover`): Whisper hears each line
  and it is compared with the script word by word; each line's pace
  (words and syllables a second over its speech and over its clip, judged
  against the pace it was read to), silences, longest pause, loudness, true
  peak, pitch range and margin over the music (that line alone) are
  measured, with a verdict, the tool calls that fix what fails, and advice
  that does not fail it. A line that differs from its
  script is heard again by a larger Whisper (small) before the voice is
  blamed: what only the first one misheard needs no retake, and each
  difference says whether the recognizer or the voice is likely wrong. A
  misread word gets a respelling as it sounds ("does" "duz", "home"
  "hohm"), or a slower read and the advice to reword when it was respelled
  already; never a placeholder. A line marked `pace: slow` (an end-card
  tagline) is not flagged as slow ([[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]]).
- **Retake one line** (agents: `retake_voiceover`): new words, a voice, a
  speed or a pronunciation, read and put in the line's place; its caption
  follows, the old take leaves the library, and `ripple` moves the lines
  after it; one undo step.
- **Voices to cast** (`list_catalog` section `voices`): each voice's
  accent, gender, its author's grade, character (measured pitch, melody
  and pace) and what it suits, the most natural first.
- **Auto captions on this machine** (Whisper, [[ADR-007 Auto captions run
  Whisper on the user's machine]]): no upload, no limit; readable line
  breaks, or **one word at a time** (CapCut's short-form style); caption
  list editing; apply style to all; SRT/VTT import and export. A voice
  read from a script (a voiceover line, text to speech) is captioned in its
  script's words, timed by what Whisper heard, so a synthetic voice's "All
  of it, home" is no longer "Olivet Helmed"; the transcript of a whole take
  says its script too ([[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]]).
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

## Generated music

An original, royalty-free score made on this computer, for agents first
and in the Audio tab's **Generate music** card
([[ADR-085 Music is composed and synthesized in the app, seeded and offline]],
[[ADR-086 A score fits an edit by whole bars and a nudged tempo]],
[[Music generation 2026-10-19]]). Nothing is downloaded or sampled; the
same arguments and seed give the same music.

- **Five styles**: product launch (four on the floor, a pumping supersaw
  pad, sub and offbeat bass, a 16th arp, a bright hook), cinematic (string
  ostinato, legato strings, horns and choir, taiko and toms, braams and
  hits, a long hall), upbeat corporate (piano eighths, a plucked guitar
  strum, glockenspiel, claps and shaker, an eighth-note bass), lo-fi chill
  (a swung boom-bap, Rhodes sevenths and ninths, a round bass on the
  kick, vinyl and tape wow) and ambient (evolving pads, glass bells, a
  tonic drone, a soft pulse).
- **Composed, not looped**: each style's chord progressions in any key
  and mode, voice-led bar to bar; a four-bar hook in key that repeats in
  every drop and is teased in the intro and breakdown; drums with
  velocity, swing and fills into each change; risers, reverse cymbals,
  impacts and a beat of silence into drops; sidechain pumping; breakdowns
  that thin out; a final hit that rings out (or a hard stop).
- **Mixed and mastered**: stereo width with a mono low end, convolution
  reverb sends, a ping-pong delay on the lead, each stem's loudness set
  to the style's balance, then a glue compressor and a true-peak limiter
  to -14 LUFS (or any target) under -1 dBTP. **Brightness** (agents:
  `brightness`, -1..1) tilts the master about 1 kHz (at 1 the highs 6 dB up
  from 3 kHz and the lows 3 dB down under 300 Hz), darker under a busy
  voice or brighter for a launch, the loudness and true peak held; the
  launch style leans bright by default (0.4), as its measurements against
  the hand-made track it imitates asked.
- **Fits the edit**: a length, or sections with bars, seconds or fixed
  times (a drop at 8.0 s, an outro ending at 56 s); the tempo moves a
  little so they land on bar lines, and the answer says how each fit.
- **A cue sheet**: tempo, key, chords, every bar and beat, the sections,
  drops, the final hit, cut points, and Bar, section and Drop markers on
  request, so `cut_to_beats` and `add_beat_hits` work on it at once.
- **Stems**: drums, bass, harmony and lead as files of their own (they add
  up to the mix), on four grouped tracks if asked.
- **One section again**: a section's own seed regenerates its drums,
  fills and touches and leaves the rest note for note.

## Epic edits

Music-synced montages (hype, velocity and AMV edits, CapCut's beat-synced
templates done by hand) for agents first: each is a command or MCP tool,
so a model makes a whole edit in a dozen calls (`scripts/drive/epic-edit.js`
makes a 13 s one). Times are timeline seconds.

- **Read the music** (`analyze_music`; Final Cut's beat grid is the
  model): tempo, every beat, downbeats (bars of four), phrases (four
  bars), sections named intro, verse, build, drop, breakdown or outro with
  their energy, each beat's loudness, strong hits on or off the beat, and
  the drop, as data in timeline seconds, and as Beat, Bar, Phrase,
  section and Drop markers when asked ([[AI tools]]). The markers follow
  the music clip: trimmed, moved, split or sped up, they stay on the
  song's beats, and reading again replaces them; the tempo answered is the
  one heard.
- **Give the song's grid** (`set_music_grid`): when the reading is wrong
  (bars between the kicks, a drop missed), its tempo, a bar's first beat
  and its parts, kept with the file; every later reading, `mark_beats` and
  `check_project` use it, and its markers are placed at once
  ([[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]]).
- **Cut to the beat** (`cut_to_beats`): a list of shots laid end to end on
  the main track, every cut on a beat, bar or phrase (or the agent's own
  times): N beats a shot, a pattern such as 4, 4, 2, 2, 1, 1 that speeds
  up, or a shot's own count. One long clip gives many shots (each reads on
  from where the last stopped); a source window past the file's end slides
  back, and a file too short for its slot ends on an earlier beat.
- **Hits on the beat** (`add_beat_hits`): flash (blown out to white),
  zoom punch, camera shake, RGB split, glow or zoom blur, several as one
  hit, on beats, bars, the main track's cuts or given times. Each is a
  short adjustment layer on a Hits track (above the footage, below bars
  and titles) whose effects peak on the beat and ease out, keyframed, so
  preview and export match and the user can retime or delete any of them.
  Flashes keep to three a second (WCAG 2.3.1): a beat that would break it
  keeps its other effects.
- **Cinematic bars** (`add_cinematic_bars`): letterbox to 2.39, 2.35, 2 or
  1.85:1 on any canvas (pillarbox when the canvas is wider), sliding in
  and out if asked; an adjustment layer with the Letterbox effect on a
  Bars track, under the titles. New titles and media never land on a
  track of adjustment layers.
- **Speed ramp on the beat** (`set_speed_ramp`, velocity edits): a shot's
  slow moment (or fast one) lands exactly on a beat while the shot keeps
  its place and length, so the cuts stay on the beat; the ramp reads more
  of the media instead. A speed curve preset can be aligned the same way.
- **Fit the music** (`fit_music`): slide a song so its drop lands where
  the cut wants it (its markers move along), then end it with the
  picture, on the last beat or bar, or at a time, faded out; optionally
  cut the picture there too.
- **Moves and sound**: Whip pan left and right, Zoom punch and Spin blur
  transitions (motion-blurred, so the cut hides in the move), and
  `add_sound_effect`'s `end_at`, so a riser or reverse cymbal peaks on the
  drop.

## AI tools (all on this machine)

- **Remove silences**, **Split scenes**, **Beat markers**, **Normalize
  loudness** (EBU R128, to −14/−16/−23/−24 LUFS, the true peak under
  its ceiling, −2 dBTP for ATSC's −24; `spec` names one; a mono clip
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
  It docks as a resizable full-height column the editor makes room for,
  like Premiere's side panels, instead of covering the inspector and the
  timeline's zoom; the library steps aside in a window too narrow for four
  columns ([[ADR-064 The AI assistant docks as a column the editor makes room for]]).
  The composer grows to five lines, sends on Enter, and shows the steps
  as they run with a Stop; failed requests can be tried again, and a
  stopped or failed turn's edits stay undoable as one. Offline, it says
  whether the server is not answering or has no model that can call tools.
- **Connect agents** (desktop, the AI assistant's second tab): after Allow
  AI agents, **Add to Codex** and **Add to Claude Code** run that CLI's own
  `mcp add` for the stdio bridge, reporting added, already added (never
  replaced), not found (with its install guide) or the CLI's error; the
  ready-made `codex mcp add` and `claude mcp add` lines and a Codex
  `config.toml` entry are there to copy
  ([[ADR-065 One-click agent setup runs the agent's own CLI]],
  [[Automation]]).

## Sound design and delivery

- **Effects** (Audio tab, under Compressor; `set_audio_filter`,
  `set_reverb`, `set_echo`, `set_tape_stop`): the trailer and epic-edit
  moves on any video or audio clip, built into the clip's one Web Audio
  chain, so preview and export sound the same
  ([[ADR-060 Sound design rings past the clip and is measured as exported]]).
  - **Low-pass and high-pass**, 24 dB per octave, resonance 0 to 24 dB.
    The cutoff keys like any slider (a log slider, typed in Hz) and moves
    between keys on a log scale, the same octaves each second; the
    agent's `sweep` writes the two keys of the "muffled build, open on
    the drop" in one call.
  - **Reverb**: Room, Hall or Cathedral, then mix, decay (RT60) and size.
    A convolution reverb whose impulse response is made here from those
    numbers (seeded noise, unit energy, highs dying first), mixed at
    equal power so the clip stays as loud.
  - **Echo**: delay time, feedback (repeats), mix.
  - **Tape stop**: the sound slows to a stop over the clip's last
    seconds, its pitch falling with it (speed falls linearly, a
    turntable coasting; the level follows the speed under half speed).
    Only the sound: a video's picture plays on. A split keeps it on the
    part with the end.
  - Echo and reverb come after the clip's volume, so their tails ring on
    past the clip's end and its fade (Premiere cuts clip-effect tails at
    the edit); export windows start early by the longest tail, so a
    reverb rings across them too. The keyframe panel lists the cutoffs
    and the two mixes; Paste Attributes copies the effects with the
    sound.
- **Loudness report** (`measure_loudness`): the mix measured as export
  renders it, effects and tails included: integrated loudness
  (BS.1770), loudness range (EBU Tech 3342), the loudest 3 s and 400 ms,
  true peak (4x oversampled, BS.1770-4 Annex 2) and sample peak, with
  pass or fail and the reasons against online (-14 LUFS, -1 dBTP), EBU
  R128 (-23, -1 dBTP) or ATSC A/85 (-24 LKFS, -2 dBTP). It flags a mix
  that passes full scale, and measures as export with a target would
  deliver it, so an agent checks before it exports
  ([[ADR-061 Delivery holds the true peak and says whether it passes]]).
- **Broadcast targets**: export Loudness and Normalize loudness offer
  -24 LKFS (ATSC A/85, US TV) beside -14, -16 and -23; the limiter holds
  the **true peak**, not the sample peak, under -1 dBTP (-2 for ATSC),
  and the export's answer says what the mix reached.

## Ads and deliverables

- **Kinetic typography** (After Effects' text animators, CapCut's
  per-character text animations): a title's in, out or loop animation can
  play by each letter, word or line, with a stagger (0 all together, 1 one
  after another) and an order (first to last, last to first, from the
  center, random, the same on every render). Presets: Typewriter (letters
  typed behind a caret; as an out it deletes from the end), Letter rise,
  Letter fade, Word pop, Word rise, Word slide, Line rise, and two sweeps,
  Highlight (a marker box drawn behind the words) and Underline, in the
  title's accent color; a finished sweep stays drawn. Any other animation
  moves per unit too (Rise by word, Float by letter is a wave). The
  rasterizer draws each unit, so the viewer and the export agree; the
  Animation tab lists the presets for titles only and adds Moves by,
  Stagger and Order (`set_animation` `unit`, `stagger`, `order`).
- **Ad looks for titles**: a glow (neon, three strengths), a gradient fill
  (two colors at an angle) and a second outline (sticker style), in the
  Text tab and in every text style an agent sends.
- **Brand kit** (kept in the project; Details > Brand, `set_brand`):
  primary, secondary, accent, background and text colors, a heading and a
  body font (two families at most), logo pictures by variant (main, light
  for dark backgrounds, dark for light ones, icon), the brand's name,
  website and tagline. Titles take a role from it (`add_text` `role`:
  headline about 9% of the frame high with a shadow, subhead, body, label,
  a pill button, a badge), and `apply_brand` restyles existing titles and
  solids. Labels on a fill pick white or near-black by WCAG contrast.
- **Ad elements** (`add_ad_element`), each one call, built from ordinary
  clips in the brand's colors, grouped, inside the 90% title-safe area
  (on 9:16 clear of the apps' buttons and captions): an **end card**
  (logo, headline typed in by word, a pulsing call-to-action button, the
  website), a **lower third** (name in a box over the title in the primary
  color), an **offer badge** (tilted, pulsing, with a small tag), a
  **call-to-action button**, and a **logo reveal** (the logo pops in, with
  an optional glow flare and white flash, and the tagline).
- **Text behind the subject** (`text_behind_subject`): a title sits behind
  the person or product in a video or a photo. The background is removed
  on this computer (a video's Remove background matte; a photo cut out once
  into a new picture with transparency) for a copy on a track above the
  title, silent and grouped with the original; one undo step. The copy
  takes the grade of an adjustment layer it sits above, and a version
  whose shape lets the subject hide the title shows the title in front
  ([[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]]).
- **Deliverables** (`export_versions`): a campaign's versions in one call
  (a group, such as an ad element, moves and scales as one unit, anchored
  where it sat; [[ADR-063 Versions fit a group as one unit]]),
  each its own file: 16:9, 9:16, 1:1 and 4:5, 30/15/6 s cut-downs (the
  opening and the end card kept, the middle cut, the music fading at the
  new end) and a textless master (titles and captions off). Footage that
  fills the frame keeps filling it, or fits over a blurred copy of itself;
  titles, logos and badges keep their size against the short side and
  move inside the new frame's safe area. Hand-animated films adapt too:
  layers are placed where they rest and their keyed motion is laid out
  again around it, a window compound sliding in from off the edge still
  does on 9:16, and a one-word wordmark too wide to wrap shrinks to the
  safe width ([[ADR-067 Versions lay keyframed motion out again around its rest]]).
  A tall version of a wide film stacks what stood side by side: a window
  above the headline beside it, a split screen's halves one above the
  other (cut again wider), each as wide as the safe column, a label or a
  glow on a window moving with it; a square version moves each such pair
  as one group. Captions are burned in on tall versions by default (even
  from a hidden caption track), sized by the short side and kept clear of
  the stacks; `captions` says `burn`, `none` or `as_project`
  ([[ADR-091 Tall versions stack what stood side by side]]).
  A title card built as a compound refits as one picture, a split screen
  whose halves filled the frame fills the new one, text never ends under
  the frame's readable size, and `overrides` move, resize or hide a clip
  in one version by hand, kept in a saved version project (ADR-101).
  The versions are built from the master as separate documents, so the
  project in the editor never changes; `check` answers one contact sheet
  of them all first (`check_at` picks the moments). Seven 480p versions of
  a 5 s ad took 4.4 s headless.
- **A whole ad through MCP alone**: `scripts/drive/ad-spot.js` makes a
  15 s spot with 27 tool calls (brand, push-in, kinetic headline, title
  behind the roaster, lower third, offer, end card, faded music), checks
  it on a contact sheet and exports 16:9, a 6 s 9:16 cut-down and 1:1.

## Export

- CapCut's export dialog: MP4/MOV/WebM/MKV, H.264/HEVC/VP9/AV1 by what
  the device can encode, 480p to 4K, quality levels or a bitrate, frame
  rate, in/out range, audio-only (AAC in M4A, MP3, WAV) and still frames.
- **MP3** (audio only, and the Audio only (MP3) preset): 256 kbps, 48 kHz
  stereo, encoded by LAME in WebAssembly (`@mediabunny/mp3-encoder`), loaded
  by the first MP3 export, on the desktop and the web alike;
  `export_video` format `mp3` (or `m4a`, `wav`) for agents.
- **Captions on export** (the dialog's Captions row, shown when the
  project has captions; `export_video` `captions`; Premiere's burn-in or
  sidecar): **Burn into the picture** (the default), **SRT file beside
  it** with the picture left clean, both, or leave them out. The SRT is
  timed to the exported range (an In-to-Out export starts at 0). The
  desktop app saves `<name>.srt` beside the export; the web build
  downloads it. Agents get its path as `captions_file`
  ([[ADR-080 MP3 by LAME in WebAssembly, captions leave an export four ways]]).
- **Save frame as PNG** from the player (the camera button, File menu,
  Mod+Shift+E, Premiere's Export Frame key): the frame under the playhead
  at the project's size, without the export dialog.
- Frame-exact and sample-synced (the export drive reads the framecode
  back); a canceled export never leaves a partial file.
- **Loudness** (Audio > Loudness; Premiere's Loudness Normalization): bring
  the mix to -14, -16, -23 or -24 LUFS. A first pass measures the whole mix
  (BS.1770) and its true peaks, then it is rendered through the gain that
  meets the target, with a limiter holding the raised true peaks under
  -1 dBTP, -2 for ATSC's -24 (up to 6 dB of limiting; the whole mix is
  known, so it looks ahead for free).
  The result notes what it measured, what it reached and how much the
  limiter held: reaching the target shows as success (green, a check);
  a mix held short of it is a warning, with how far under it landed. Gain alone stopped the RacePulse promo at -17 LUFS of -14;
  with the limiter it measures -14.3 in ffmpeg, peaks at -0.9 dBTP.
- **Presets** at the top of the dialog: YouTube 1080p and 4K, TikTok,
  Reels and Shorts, Small file (720p), High quality master (HEVC),
  Animated GIF and Audio only (WAV); changed settings read Custom and can
  be saved under a name (per viewer) and deleted. TikTok, Reels and Shorts
  is made for 9:16: it is never named for a canvas of another shape, and
  picked there it says what will export (16:9 stays 1920×1080) and offers
  **Make the canvas 9:16**, which only that click does, as one undo step.
  A codec the device cannot encode at that size gives way to one it can,
  and the dialog names both. In to Out, with no marks, is shown disabled
  with the reason under it.
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

- **Sound effects** in the Audio tab (CapCut's is a cloud library;
  Resolve ships a local one): Whoosh, Swish, Pop, Click, Ding, Success,
  Riser and Boom, and for epic edits Impact, Sub drop, Braam, Reverse
  cymbal, Glitch, Camera shutter and Swoosh up, synthesized on this
  computer from sines, saws and seeded noise, so they are the same
  everywhere and nobody's license applies.
  The card's play button auditions one; double-click, + or a drag adds it
  on an audio track, the WAV made once per project and reused
  (`add_sound_effect` for agents).
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
  command plus `preview_frame` and `preview_frames` (a contact sheet,
  JPEG so it stays under what MCP clients pass a model; as PNG, clients
  re-encoded big sheets with 256 colors and skies banded) so
  an agent can look at its work, `list_projects`, `open_project` and
  `new_project` to move between projects as the home screen does, and
  `export_video` / `export_status` to make the file; HTTP or
  `--mcp-stdio`. A model learns the tools from the `help` tool, three MCP
  prompts (make an ad, an epic edit, a short) with design rules, guide
  resources and a full `list_catalog`; [[MCP tools]] is the generated
  reference. Edits answer with only what they changed; `batch` runs
  many as one undo step; `frame_region` zooms a shot onto a rectangle of
  its picture, still or moving ([[ADR-052 Agents read what changed and export without a dialog]]).
  Every answer names the tool set it came from, so the stdio bridge tells
  a connected client (`notifications/tools/list_changed`) when a newer
  build brings other tools; over HTTP the client reconnects ([[Automation]]).
- `window.videoEditor` in the page: commands, actions, import, render,
  pixels, animated values (`paramAt`) and the AI tools — what the drives
  use.
- Keyframe commands: `add_keyframe`, `move_keyframe`, `set_keyframe_ease`
  and `remove_keyframes`, with one ease vocabulary (twelve presets or a
  bezier). `add_keyframe` refuses a path that does not animate on the
  clip, naming the ones that do, and `describe_project` shows every key as
  `[at, value, ease]`, so edits to keys show in answers
  ([[ADR-066 Keyframes are refused where nothing moves and shown in answers]]).
- Answers stay small as a project grows: compounds are answered only when
  they change, summed up; `open_project` and `new_project` answer a
  summary; `add_sound_effect` places a list of sounds in one call and one
  undo step.
- `check_project` measures what it judges: each title's WCAG contrast
  with the rendered picture behind it, a music clip's last second, and the
  shots on the busiest picture track
  ([[ADR-068 check_project measures the picture and the sound it judges]]);
  an audio clip cut off before the end while it still sounds, with no
  fade, is a warning (`sound_cut_off`, ADR-100).
- Workflow commands: `relink_media`, `remove_media`, `edit_media_folder`, `organize_media`,
  `apply_effect_preset`, `paste_attributes`.
- Layout commands: `align_clips` (with a `margin`, so titles of any width
  share one left edge inside the safe area), `distribute_clips`, `set_crop`
  (edges as source fractions, or the largest centered crop of a ratio) and
  `set_mask` (any shape and number, or none).

- Preview prepares long-GOP video before cuts and transition handles, with
  adaptive lead time and a bounded admission estimate (ADR-074). Clips
  larger than the preparation budget still decode on demand.

- Music analysis reports every detected drop as well as the biggest, and
  supports short two-bar sections and breakdowns.
- Loudness reports can include isolated audio tracks and Voiceover-to-music
  balance. Ducking can target a measured LU difference, returning the
  achieved result and editable keys rather than only taking a fixed depth.

### Icon consistency

The toolbar uses drawn icons for every trim tool and timeline Fit. Reset is
counterclockwise; Rotate is clockwise. The assistant uses Bot, automatic tools
use WandSparkles, and effects use Sparkles. Track icons reflect their contents,
including pictures, captions, stickers, shapes and adjustment layers. Empty
results include an icon, title and next-step hint. See [[Icons]] for the mapping.

### Compact layouts and keyboard controls

Library tabs lay out in balanced rows (all eleven in one row at 2560 px, six
and five below), keeping every destination visible; where labels would need a
third row or a quarter of a short panel, the tabs show icons alone, named by
tooltips (`src/lib/libraryLayout.ts`). Below 300 px the catalog categories
move above the cards as wrapping chips, so cards keep two columns. The media
browser's folder filter sits with the others and Favorites only is a heart
toggle beside the views; AI tool cards tile two across in a wide library.
Details ratios and canvas dimensions fit the narrow inspector; text style, case
and audio channel choices wrap between whole buttons. Segmented radio controls
support arrow keys, Home and End with one tab stop. Fit, Fill and Stretch share
an inset button group.

Home thumbnails draw hover and keyboard focus rings over their images, project
names have styled tooltips, and preset cards align their image and text rows.
Track headers show their names with ellipsis and a tooltip when space is short.
Marker editing preserves a multi-row list. Shortcut search keeps the dialog size
stable. The keyframe dock reserves room to scroll the timeline's tracks.

Narrow viewers keep current and total frame-exact timecodes on a compact row.
Toasts appear at the bottom, clear of Guides. Toolbar Split and trims reflect
whether an unlocked clip can be edited at the playhead. Add marker remains
available on empty timelines and at existing markers because both are valid
operations. Mirror and Rotate use the shared edit boundary. Title-bar project
renaming accepts at most 120 characters, matching Home.

## Inline title styling

In the text inspector, expand **Style range**, choose a word, and set its color or weight. Clear word style restores that word to the title style. Agents can use `style_text_range` with character offsets or a literal match, including all occurrences, to apply color, gradient, weight, italic, underline, or size scale. Ranges use UTF-16 offsets with an exclusive end. Typing shifts and trims ranges; inserted characters inside a range inherit it. Run colors override animated base color. Preview, alignment, text checks and version exports use the same run-aware raster layout.

## Layout presets

Select two to four overlapping pictures and open **Layouts** in the inspector. A picture on the main track stays there (in picture in picture it must be the full-frame one), so the timeline never ripples; the others stack above it on Layout tracks. Tiles offer side-by-side, stacked, grid, triptych (three pictures), and picture-in-picture arrangements. **Fill** (the default) crops each picture to its cell; **Fit** shows the whole picture centered in it, for screen recordings (`fit: "contain"`, with `background` filling the cell behind it as an editable shape). The Layout tracks go directly above the highest of the chosen clips' tracks, so labels already above them stay on top. `apply_layout` also accepts gap and margin (fractions of the shorter canvas side), rounded mask radius, editable border shapes, and a slide or scale entrance. Clips are placed in input order, with the first PIP picture full frame. Layout replaces position, scale, rotation, crop, mask and their keys, plus clip animations, canvas fill, edge repetition and wiggle. Other effects remain. The whole layout is one undo step. Borders are separate shapes grouped with their pictures; remove an old border before applying another bordered layout.

## Group transforms

A multi-selection has one viewer box: drag it to move, use a corner to scale the arrangement, or the rotation handle to rotate it about its combined center. Each gesture is one undo step. `transform_group` accepts a `group_id` or explicit `clip_ids`, canvas-fraction x/y offsets, a scale multiplier and a rotation offset in degrees. Add `at` in timeline seconds to key every visual member using its own clip-relative time. Existing keys are preserved; audio members remain unchanged. Without `at`, geometry is evaluated at the latest member start and existing keyed paths receive keys there. Times outside a member clamp to that member’s span.

## Motion path points

Select a picture with position keyframes to see its motion path. Drag a dot to move that key position; the gesture is one undo step. A focused dot can also move one canvas pixel with an arrow key. The `move_motion_point` command takes a clip id, an existing key time in timeline seconds, and x/y positions in canvas fractions from center. Both axes receive a key at that time, with existing easing preserved.

## Mixer, animated images, and timeline display

- **Audio track mixer:** open Mixer from the timeline toolbar or View menu.
  Every audio track and visual track carrying audio has a dB fader, pan,
  mute, solo, and live post-fader peak/RMS readings. Master has a fader,
  stereo readings and the player's short-term LUFS. Dragging a fader or
  pan makes one undo step; double-click resets it. Master gain is included
  in preview, offline loudness measurement and export. Commands:
  `update_track`, `set_project` (`master_volume`).
- **Animated GIF, WebP and APNG:** when ImageDecoder supports the format,
  import reads real frame durations and retains alpha. The initial clip
  lasts one loop; extending it repeats the loop. Timeline thumbnails,
  library hover scrub, player and export share these frames. Platforms
  without ImageDecoder use their still-image decoder. A decoded loop over
  256 MiB is refused with a readable error (ADR-089).
- **Timeline display:** the toolbar's display menu remembers waveforms,
  video thumbnails, clip names, and small/medium/large track height per
  browser profile. Track header color swatches use the clip-label palette;
  a clip's own label wins. `update_track.color` sets or clears a track tint.

## Portable project files

**File > Collect files** on desktop creates a new folder inside the chosen
folder, with `project.json` and a `media` folder. Originals, proxies, LUTs,
and cutout files are copied once per distinct path; the JSON uses relative
paths. Existing files are not overwritten. Progress reports completed files;
missing or nonlocal sources fail the collection. On the web, this downloads
JSON only and explains that media stays in the browser.

**File > Open project file** imports JSON through normalization with a fresh
project id, preserving existing saved projects. Desktop resolves relative
media beside the JSON. Missing media uses Manage media's existing relink
workflow. On the web, browser media keys work in the same profile; files
from another computer need relinking. Commands: `collect_project` (desktop
only), `open_project_file` (optional absolute desktop path, otherwise picker).
See ADR-090. Native dialogs and copying still need a desktop validation pass.
