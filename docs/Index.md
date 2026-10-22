# OpenFrame — Documentation

Obsidian-style vault. Open the `docs/` folder as a vault (or just read the
markdown); `[[wikilinks]]` connect the notes. Written for users learning the
editor, contributors changing it, and coding agents that need the reasoning
and evidence from earlier sessions. [[AI development]] explains the purpose
of the documentation and how agents use it as shared working memory.

## Ground rules

- The name is **OpenFrame** (renamed 2026-10-17). [[Renaming]] lists what
  kept the old name on purpose and why.
- **Two projects.** The app is in `openframe-application/`: run every app
  command there, and read `src/`, `scripts/`, `src-tauri/` and `fixtures/`
  paths in these notes as inside it. The website is `openframe-website/`;
  these docs serve both
  ([[ADR-081 The app and the website each have a folder, the docs stay at the root]]).
- **Desktop first**, browser support second (ADR-003). The 2026-10-14 owner
  handoff reaffirmed this; web capability checks remain separately documented.
- GPL-3.0-only applies to original project code and documentation. The repo
  remains private pending owner instruction; see [[Release preparation]].
- The owner reads history to learn *why*: commits are small, one intention
  each, and docs land in the same commit as the code ([[Conventions]]).
- What we learn about the products we imitate (CapCut, VEGAS, Premiere,
  Resolve) and the platforms we run on (WebCodecs, WebView2, Tauri) is
  written down in `research/` so nobody pays for a lesson twice.

## Map of content

- [[Development pass 2026-10-16]] — approved workflow additions, decisions and verification
- [[User guide]] — setup, a first editing session, storage and platform limits
- [[AI development]] — the Claude Code/Codex experiment, documentation purpose,
  evidence and continuity across agent sessions
- [[Next agent handoff]] — current owner direction and safe pickup order
- [[Web capability log]] — dated browser checks and limits, separately from desktop
- [[Release preparation]] — GPL license, dependency inventory and remaining
  tasks before a separately authorized public release
- [[Third-party licenses]] — production npm and Cargo license declarations to review
- [Contributing](../CONTRIBUTING.md) — how users, developers and AI agents can help
- [[Features]] — everything the app does today, with the intent behind each
- [[Roadmap]] — what is in flight and next, in priority order
- [[Project format]] — the open JSON schema agents and pipelines write
- [[Automation]] — headless render, MCP for agents, AI assistant: the three doors
- [[UX audit 2026-10-14]] — 38 ranked findings from a first-time CapCut
  user's walk, what was fixed, and what to keep
- [[UI polish 2026-10-16]] — styling audit at three window sizes and the
  splitter extremes: what clipped or overflowed, why, and rules of thumb
- [[UI at every window size 2026-10-19]] — the four-lane sweep at nine window
  sizes: the player's floor, fixed sizes in a fluid shell, layers, the
  inspector below 340 px, and Chromium layout lessons
- [[AI tools]] — the local tools' algorithms, defaults, credits and measurements
- [[Driving the app]] — the web build through Playwright, the desktop app over
  WebView2's debug port; native dialogs, OS drops, the drive scripts
- [[Architecture]] — layers, how an edit becomes pixels, the module table
- [[Conventions]] — where code goes, rules of thumb, commits, testing
- [[History]] — the build story, round by round, including rejected attempts
- [[Renaming]] — every site the placeholder name touches, and the one that
  moves user data
- [[Website]] — the product site in `openframe-website/`: its pages, how it
  stays true to the app, its media and the privacy checklist for them
- [[Keyboard shortcuts]] — every default key, grouped as the app's panel
  groups them

## Research

- [[Media organization]] — source metadata, filtering, sorting and timeline usage
- [[Navigation and composition]] — viewer guides, marker management and
  priorities from the next editor comparison
- [[Effect workflow]] — applied-effect discoverability and stack-editing review

- [[CapCut desktop]] — the UX baseline: layout, every panel, shortcuts,
  export, what users complain about
- [[Feature gaps 2026-10-16]] — what CapCut, Premiere, Resolve, VEGAS and
  Final Cut have that we lack, with a build order
- [[Everyday gaps 2026-10-17]] — the small, frequent gaps the survey
  missed, a UI code audit and a styling sweep, with what was done
- [[Pro workflows 2026-10-18]] — how agencies make ads and editors make
  epic edits, the rules of thumb (with sources) the agent guide teaches,
  and the gaps each toolkit took
- [[Launch film through MCP 2026-10-18]] — the 56 s launch film edited
  entirely through MCP: how it was made, what worked, fourteen limits
  ranked by what they cost, and eleven product issues met while recording
- [[Launch film 3 through MCP 2026-10-19]] — the 68 s voiced launch film and
  its vertical cut, scored and narrated in the app through MCP; the limits
  met, ranked (re-laying out for 9:16, layouts that crop, runs lost on edit).
- [[Natural voiceover 2026-10-19]] — what a natural read measures (pace,
  pauses, melody, silence, level), what Kokoro does against it at each
  precision, speed and voice, what the natural finish changed, pace landed
  in words a second, and why emphasis is beyond Kokoro
- [[Versions keep the subject 2026-10-19]] — how export_versions finds a
  shot's subject without a model (two saliency methods tuned on the launch
  footage), and the trials that lost
- [[Music generation 2026-10-19]] — how professional tracks of five
  styles are built (tempo, swing, progressions, drums, builds and drops,
  mix and master, with sources), what generate_music does with it, and
  what it measures since nobody can listen
- [[Professional NLE features]] — VEGAS, Premiere and Resolve depth: trim
  modes, J/K/L, keyframes, color, audio, formats, interchange
- [[Web media engine]] — mediabunny, WebCodecs, WebGL2, Web Audio,
  ffmpeg.wasm and on-device AI in the browser, with pitfalls
- [[Tauri desktop media]] — serving media to the webview, the frame pipe to
  ffmpeg, ffmpeg packaging and licensing, WebView2 specifics
- [[AI and automation]] — AI features across editors, what runs locally, and
  the pipeline/agent API design

## Decisions (ADRs)

Every non-obvious choice gets a short Architecture Decision Record in
`decisions/`. Oldest first:

- [[ADR-001 Tauri v2 and React, the TermHQ stack]]
- [[ADR-002 The media engine lives in the webview]] — frames never cross IPC;
  Rust supplies bytes, proxies and masters
- [[ADR-003 Desktop first, one build, a platform seam]] — all compute on the
  user's machine; web is a client-only subset
- [[ADR-004 Timeline time is integer frames]] — rational fps, SMPTE timecode
- [[ADR-005 One store, snapshot undo]] — useSyncExternalStore, drags as one
  undo step
- [[ADR-006 Every edit is a named command with a JSON Schema]] — the agent
  and MCP surface
- [[ADR-007 Auto captions run Whisper on the user's machine]] — no upload,
  no limit; the timeline mix at 16 kHz, cut at quiet points
- [[ADR-008 MCP is a handler over the command registry]] — one pure
  JSON-RPC handler; transports only forward; agents see their own frames
- [[ADR-009 Agents reach the app over local MCP, opt-in]] — local HTTP plus a
  stdio bridge, token and origin checks, off by default
- [[ADR-010 Desktop media is served by id over a media protocol]] — exact-range
  reads, the webview never sends raw paths
- [[ADR-011 Desktop projects are JSON files written atomically by Rust]]
- [[ADR-012 Exports are positional raw-body writes into a part file]]
- [[ADR-013 FFmpeg runs as a CLI child for proxies, LGPL in release]]
- [[ADR-014 Export is a deterministic frame loop]] — every frame awaited,
  never dropped; works hidden
- [[ADR-015 Export codecs follow what the device can encode]]
- [[ADR-016 AAC encoder delay is measured, not assumed]] — 0 native, 1024 WASM
- [[ADR-017 Analysis edits take source seconds]]
- [[ADR-018 Local analysis is our own signal processing in the webview]]
- [[ADR-019 Smart edits compile to commands, one undo step]]
- [[ADR-020 The grade lives in adjust, in Lumetri's order]] — schema, order
  and math of HSL, curves and wheels
- [[ADR-021 LUTs are files by reference, sampled as 3D textures]] — no table
  data in the project file
- [[ADR-022 Scopes bin a GPU-downscaled readback on the CPU]] — 320 px
  readback, at most 8 updates a second
- [[ADR-023 The keyframe panel docks under the timeline tracks]] — shares
  the tracks' zoom and scroll; lanes plus a value graph
- [[ADR-024 Keyframes are selected by path and frame, and keys come first]]
  — no ids in the format; Delete, Copy and Paste act on keys before clips
- [[ADR-025 Stickers and templates are ordinary clips]] — rendered PNG
  assets and stacks of clips; no new clip type
- [[ADR-026 Library previews are drawn by the engine]] — an offscreen
  compositor, lazy and cached; cannot drift from the renderer
- [[ADR-027 Speed curves are exponential and anchored to clip frames]] —
  exact time maps; trims keep ramps; reverse reads down from in
- [[ADR-028 Reverse and retimed sound are made in the engine]] — backward
  GOP windows; WSOLA keeps pitch
- [[ADR-029 Headless rendering reuses the app]] — `--render project.json
  --out file`, JSON-line progress, exit codes
- [[ADR-030 The canvas text editor is a transparent textarea over the engine's text]]
  — the engine keeps drawing; the textarea shows only caret and selection
- [[ADR-031 Typing into a text clip is one live session]] — live keystrokes,
  one undo step, ended by any press outside (capture phase)
- [[ADR-032 Remove BG runs ormbg on WebGPU, MediaPipe on WASM]] — two
  Apache-2.0 models by device; download on first use; fall back when the
  GPU can't
- [[ADR-033 Mattes are made once and stored as grayscale video]] — process
  once, play and export beside the source; reuse, smoothing, coverage
- [[ADR-034 Timelines leave as OpenTimelineIO]] — OTIO JSON first, proven
  with the reference library; our clip rides in metadata
- [[ADR-035 Linkage binds a clip to the shot under most of it]] — a clip
  follows the main clip under more than half of it; beds stay put
- [[ADR-037 Compound clips are nested timelines composited to a texture]] —
  nested timelines in `project.compounds`, drawn one framebuffer level deeper
  so a compound clip's settings act on the composite; one undo history.
- [[ADR-038 Copied effects preserve animation and get new identities]] —
  stack reuse, independent IDs, timing conversion and undo
- [[ADR-039 Project navigation waits for current edits]] — save in-flight
  edits and ignore overlapping navigation requests
- [[ADR-040 Media browsing stays outside the project document]] — derived
  usage counts, sorting and session preferences without changing saved assets
- [[ADR-041 Relinking preserves source handles and edit identity]] — recovery
  without silent trim changes
- [[ADR-042 Media organization is optional project metadata]] — folders,
  favorites, compatibility and undo
- [[ADR-043 Reused settings preserve timing and ownership]] — presets,
  selective attributes, animation conversion and source preview isolation
- [[ADR-044 Trim previews read the applied edit]] — exact cut frames,
  source limits and cancellable gestures
- [[ADR-050 Text to speech runs Kokoro on the user's machine]] — Kokoro-82M
  in a worker, downloaded once, placed under the title
- [[ADR-051 Frame blending draws the layer twice from two cursors]] — a
  second cursor lane and a constant-alpha second draw mix slow motion.
- [[ADR-052 Agents read what changed and export without a dialog]] —
  edits answer with a diff, `batch` is one undo step, `export_video`
  writes only into the Videos folder.
- [[ADR-053 One compressor everywhere, measured as it plays]] — the
  platform's compressor in the clip chain, and in loudness measurement.
- [[ADR-054 Tracking writes position keyframes]] — a template-matching
  tracker's path becomes the pinned layer's smoothed, thinned keys.
- [[ADR-055 The MCP guide is generated from the tools]] — groups, hints,
  examples, playbooks and the catalog in one module; the reference and
  playbook docs are generated and tested.
- [[ADR-060 Sound design rings past the clip and is measured as exported]] —
  filters before the volume, echo and reverb after it; export windows
  pre-roll by the longest tail; tape stop through the retimer.
- [[ADR-061 Delivery holds the true peak and says whether it passes]] —
  a 4x true-peak limiter, specs by target, `measure_loudness`.
- [[ADR-063 Versions fit a group as one unit]] — an ad element's parts
  keep their layout in every shape, anchored where they sat, fitted to
  the safe area.
- [[ADR-064 The AI assistant docks as a column the editor makes room for]] —
  a full-height column; the editor scales to what is left and the library
  steps aside below four columns' worth of window.
- [[ADR-065 One-click agent setup runs the agent's own CLI]] — Codex and
  Claude Code add the stdio bridge with their own `mcp add`, never over an
  existing entry; the Codex syntax and its sources.
- [[ADR-066 Keyframes are refused where nothing moves and shown in answers]] —
  one table of animatable paths, keys as [at, value, ease] in
  describe_project, one ease vocabulary.
- [[ADR-067 Versions lay keyframed motion out again around its rest]] —
  sets placed where they rest, keyed offsets scaled to the new frame,
  compound clips placed as pictures, wide words shrunk to fit.
- [[ADR-068 check_project measures the picture and the sound it judges]] —
  WCAG contrast on the rendered frame behind each title, the music's last
  second, shots on the busiest track.
- [[ADR-069 Large blurs run on a downsampled pyramid]] — blur to a
  300-pixel radius past the old maximum (which draws as before); radial
  gradients and feathered edges on shapes.
- [[ADR-070 Drop shadows are cast by the finished picture]] — after
  mask, effects and matte, so rounded and compound windows cast their
  shape; perspective tilt for the same windows.
- [[ADR-071 Keyed title styles redraw the title]] — font weights, and
  size, letter spacing and color keyframes (colors as 0xRRGGBB).
- [[ADR-072 One drag is one undo step and a typed value is kept]] —
  range inputs are gestures (held keys too), a color picker's drag is a
  run, typed values commit however focus leaves, junk changes nothing.
- [[ADR-073 Templates land as a block and the web keeps what it imports]] —
  templates on rows of their own above the footage, presets made for a
  shape, URL imports copied, untouched projects not kept, JPEG contact
  sheets, loudness success shown as success.
- [[ADR-045 Align measures the resting box, one clip to the canvas]] —
  shared on-canvas geometry for align, distribute and edge snapping
- [[ADR-046 A drop preview is a dry run of the drop]] — library drags run
  the drop's own placement and draw the difference
- [[ADR-047 A new title shows by playing its In animation]] — a silent run
  to the settled frame; reduced motion jumps there
- [[ADR-048 Crop is cut from the source and edited on a copy]] — crop
  before flips and transform; the crop mode's session and whole-picture view
- [[ADR-049 Masks turn rigidly and grow shapes without new fields]] —
  rotation in layer pixels; heart, star and round corners as additive fields

- [[ADR-074 Prepare preview decoders before their first visible frame]] —
  adaptive decoder lead, memory admission and transition shader warmup.

- [[ADR-075 Measure music structure and voice balance on the timeline]] -
  two-bar sections, multiple drops and measured ducking before one edit.

- [[ADR-076 The website is a static Astro site that reads docs at build time]] —
  its own package beside the app, two React islands, the MCP reference and
  quoted numbers rendered from docs/
- [[ADR-077 The website deploys to GitHub Pages from main]] — the only
  deployment, on site or docs changes; inactive until Pages is enabled
- [[ADR-078 Deleted projects wait in Recently deleted, marked in their summary]] —
  one click deletes with Undo, thirty days to restore, no new platform
  calls, agents never see the trash.
- [[ADR-079 Audio scrubbing plays snippets through the playback scheduler]] —
  90 ms snippets of the real mix while the ruler is dragged, one after
  another, never while playing; a preference turns it off.
- [[ADR-080 MP3 by LAME in WebAssembly, captions leave an export four ways]] —
  mediabunny's LAME extension for MP3; captions burned in, an SRT beside
  the export, both or neither, timed to the exported range.
- [[ADR-081 The app and the website each have a folder, the docs stay at the root]] —
  the editor in `openframe-application/`, the site in `openframe-website/`,
  `docs/` at the root for both.
- [[ADR-082 CI runs only when the owner starts it]] — CI is manual (cost);
  agents run the gates locally and never start it; Pages deploys on its own.
- [[ADR-083 Voiceover lines are directed in the script and keep it]] —
  per-line voice, speed, time and pause; pause marks lengthen the voice's
  own pause; pronunciations for the voice only; the script kept with the
  take for review and retakes; one undo takes the speech files too.
- [[ADR-084 Voiceover is read at full precision and finished like a recording]] —
  fp32 everywhere by default, the natural finish (a reader's pauses,
  rushed lines read slower, EQ, one loudness, room tone, fades, a touch of
  room), a narrator's speed, voices cast from a described catalog.

- [[ADR-085 Music is composed and synthesized in the app, seeded and offline]] —
  generate_music synthesizes in TypeScript in a worker (no samples, the
  same samples in every webview and test), four stems that add up to the
  mix, the balance measured and the master's gains shared.
- [[ADR-086 A score fits an edit by whole bars and a nudged tempo]] —
  sections in bars, seconds or fixed times, the tempo scanned to land
  them, phrase-aligned default forms, the cue sheet as the answer and
  what analyze_music reads back.
- [[ADR-087 Inline title ranges share the raster layout]]

- [[ADR-088 Layout and group geometry use canvas pixels]]

- [[ADR-089 Mixer taps and timed images share the render engines]] — post-fader
  meters, master gain, timed image loops and profile display preferences.
- [[ADR-090 Collected projects use relative media in a new folder]] — native
  collection, portable paths and fresh identities when opening JSON.
- [[ADR-091 Tall versions stack what stood side by side]] — a window beside
  its headline becomes the window above it on 9:16 and 4:5, a split
  screen's halves are stacked and cut wider, followers ride along, captions
  are a version's choice (burned on tall ones).
- [[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]] — captions and
  transcripts of a voice with a script use its words, timed by Whisper; a
  review hears a doubtful line again with a larger model before blaming the
  voice, fixes are concrete respellings, and a line's pace intent is kept.
- [[ADR-093 An AI agent's changes are announced at the top, under the Bot]] —
  every MCP tool call (desktop bridge or docked assistant) is the agent's;
  an edit raises one retitled notice at the top marked AI agent with the
  Bot icon, and the user's own toasts stay at the bottom.
- [[ADR-094 Library tabs keep their labels only while they fit]] — balanced
  rows of labeled tabs while two rows fit in a modest share of the panel,
  else icons named by tooltips; category lists become chips below 300 px.
- [[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]] —
  an import's kind comes from its source, never its display name, and each
  failed file says why; export and collect take a `folder` and never
  replace a file; the server instructions point to `help` instead of
  carrying the guide; unknown arguments get a "did you mean".
- [[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]] —
  pace in words a second, landed per line by reading again; no emphasis
  (Kokoro can't); a song's grid read from the whole file and mapped
  through each clip; voice-over-music balance named by window (program,
  speech, line) with a per-line floor.
- [[ADR-097 Checks and versions judge by the picture]] — check_project
  renders every title's backdrop and measures contrast with tested fixes,
  floors text size by the frame's short side, judges endings by the last
  second; export_versions frames each shot on its subject, takes a focus,
  flags a cut subject and saves versions as projects.
- [[ADR-098 Sound is mixed by role, beds are synthesized, an agent can listen]] —
  audio tracks carry a role (dialog, music, effects, ambience) that places
  new sounds and splits stems; eight ambience beds are synthesized
  locally; preview_audio returns the mix or a stem as MP3 with numbers;
  previews draw text at the canvas's size.
- [[ADR-099 Feathers blur the shape, title runs share a baseline, pictures take a border]] —
  a feather is the shape blurred (no creases on wide feathers); a run's
  gradient spans its own letters and mixed sizes share a baseline; keys
  and set_param take only what a path holds; a group move keys only what
  it changes; set_border frames any picture around its finished edge.
- [[ADR-100 A compound clip's sound is a bus, and a bed keeps its balance in every take]] —
  a compound clip with an EQ or compressor mixes its clips as a bus
  (EQ, compressor, then its volume and fades); renders pre-roll a second
  for any compressor; beds levelled by a seed-free reference take, peaks
  limited, wind lulls bounded; check_project finds a sound cut off
  mid-video; preview_audio names the picture's stem.
- [[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]] —
  music markers follow their clip through trims, moves, speed and splits
  and a second reading replaces them; set_music_grid keeps a song's tempo,
  downbeat and parts for analysis, mark_beats and check_project; a steady
  song's beats keep one phase; versions refit a title card compound as one
  picture, fill the frame with a full-bleed split screen, hold text at the
  readable size, judge 4:5 by the apps' zones and take overrides by hand;
  unique copies copy nested compounds.
- [[ADR-102 An edit moves only what its answer names, and the main track keeps the gaps it was given]] —
  the magnet closes only the gaps an edit opens, so an agent's pause on
  the main track survives AI tools; agents' commands get linkage, never
  the magnet; every clip a tool moves is in its answer, a closed gap in a
  sentence; trims say why they stop; slip_clip moves the source by its
  seconds; hidden cuts are not counted; half-frame times take the earlier
  frame.
- [[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]] —
  check_project judges titles inside compound clips where they show; a
  title card grows as one picture and is restacked rather than overlapping;
  one title zone for the check and versions, with room for the suggested
  outline; a subject's copy takes the grade it sits above and says where
  it went; a title its subject hides is flagged and shown in front in a
  version; frame-spanning shapes stretch; versions answer their loudness.
- [[ADR-104 Voice and sound an agent can trust without ears]] —
  a words_per_second band asked is held over any pace; pause marks stay
  out of a line's pace and a slow line reads no faster than speed 1; a
  word heard that is not in the script is heard again and counts against
  match; duck_under_speech ducks a whole track under a 15 LU ceiling,
  keeps how it ducked and dips again under a retake; cut_music cuts a
  song on its bars with a crossfade, set_crossfade joins any two audio
  clips, preview_audio measures every join and dropout; decoding starts
  0.1 s early so an MP3 loses no packet.
- [[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]] —
  describe_project narrows to clips, tracks or a stretch with the media
  and markers they use; analyze_music answers a grid and counts unless
  asked for detail full; the design rules and a title's style are listed
  once; lines are laid out without the spacing after the last letter;
  set_colorize makes white a color; the glow starts at luma 85.
- [[ADR-106 What sits on a shot or marks a song follows it through every edit]] —
  linkage moves a run of titles into each other's old spots, follows a
  shot ripple-deleted with its title, and applies inside edit_compound
  and between a batch's steps; a new main-track clip keeps the pause
  before it; cut_ranges keeps the clip's id on its first piece left; a
  song's markers follow it into compound clips and unique copies, never
  double another use's, and round ties as secondsToFrames does; cut_music
  of an intro starts on the bar; reversed trims and frozen slips say why.
- [[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]] —
  a split of one sound plays on with no click guard; cut_music stops
  before the bar line so both downbeats play whole; preview_audio's edges
  judge a join's click and level against the incoming file's own; a duck
  keeps its keys' shape and place, so moved music says its dips moved and
  splits are not hand edits; the lines stay on the speech target under the
  ceiling; voices in compound clips duck music.
- [[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]] —
  set_param refuses a part the clip lacks, naming what adds it (a half
  colorize crashed renders, a half mask wedged describe_project); a keyed
  border, shadow, colorize or mask value needs at; a border no longer
  tints a see-through picture; versions keep borders, drop shadows and
  feathers against the short side; describe_project lists nested
  compounds, finds compound tracks, reads [] as all and start = end as a
  moment; a colorize color's alpha scales it; a tracked range's gradient
  ends on its letters.
- [[ADR-109 What an agent can set, a person can see and change]] —
  a section opens when its header switch turns on and keeps the focus;
  activate and deactivate act on the selection as one, named for what
  they do; agents' notices name the new commands and parameters; a
  title shows the drop shadow, border and colorize it carries; paste
  attributes carries shadow, border and compressor; audio crossfades are
  offered in the clip menu, drawn on the timeline and set in the Audio tab.
- [[ADR-112 An MP3 plays without its encoder delay, as ffmpeg plays it]] —
  the LAME tag's delay and padding are read as ffmpeg reads them and left
  out of every MP3's playback, export, waveform, analysis and duration
  (23 ms earlier at 48 kHz, sample for sample with ffmpeg); markers and
  cuts saved from an old reading stay as measured; AAC was already exact.
- [[ADR-110 Outlines take their color, solids their alpha, borders blur with their picture, and a shot's pieces carry their titles]] —
  a hollow shape's outline takes its color; solids draw any CSS color,
  alpha too (names and rgba() drew black); a motion-blurred picture is
  framed per shutter sample; versions scale effects' pixel sizes and a
  position wiggle with their picture; set_param, set_shape and set_tilt
  need at for a keyed value, set_param starts an EQ again, and
  normalize_loudness scales a duck's keys;
  markers follow a song any compounds deep; a piece cut off a shot (a
  freeze's second half) carries its titles; per-letter border fades stay
  open.
- [[ADR-111 A person checks the project, Space presses what the keyboard reached, and a transition on sound crossfades]] —
  the library's Check tab (and File > Check project, and Export's Check
  row) runs the agent's check_project with the same measuring, on
  request, and says each finding in a person's words, grouped as text,
  timing and sound, jumping to its clip, time and inspector tab; Space
  presses a button, switch or menu item the keyboard reached (a click's
  focus still plays); a transition dropped on an audio join crossfades.
- [[ADR-113 A freeze fills the pause it was given, a run of lines follows its pictures, and a cut rolls in one call]] —
  a clip across several shots follows them when they all moved by one
  amount (a run of voice lines through a freeze), never a music track's;
  freeze_frame overwrite fills a pause and moves nothing, and a still at a
  shot's last frame leaves no one-frame piece; add_voiceover names each
  line its at could not hold; numbers sent as strings are read; roll_edit;
  set_param hold steps instead of ramping; a sound's length rounds up.
- [[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]] —
  add_text without a track lands above everything showing then, never on
  a free row under a grade, the hits or its own button; hits and bars act
  on footage, so a title card stays above them; a title placed under an
  adjustment layer is named; set_mask takes aspect (1 is round on any
  picture) and names an edge it runs past; a version wider than its
  master keeps all the master showed, centered, at the caller's focus;
  pushes relax or hold eases a tall master's push-ins; versions list a
  picture drawn across their captions; preview_media looks inside an
  exported file.
- [[ADR-114 A duck opens where it is asked and keeps the hand's keys, long words set the pace, a filtered voice keeps its loudness]] —
  duck_under_speech plans a whole bed at once (no blip before a first
  line or at a song's cut), holds pauses under min_gap and lists them,
  opens on open_at moments such as the Drop markers, and keeps volume
  keys made by hand outside the lines; a band moves down so long words
  are read at most 5 syllables a second; add_voiceover takes read_as per
  line; set_audio_filter keep_loudness measures a filter's loss and makes
  it up; edges explain a step the music makes itself and flag one in a
  ring-out.
- [[ADR-115 A voiceover captions itself a few words at a time, and answers give what they share once]] —
  add_voiceover and retake_voiceover caption_words time each word by
  Whisper fitted to the voice's own start and pauses (measured against
  Kokoro's durations); check_project reads chunked captions as their
  line; a lone word is never lit; long clip lists share their common
  fields, moved markers are counted, alike findings grouped, a review is
  compact with one duck for the music track; new_project and clips false
  give track ids; check sheets wrap and take tile_width.
- [[ADR-117 A whole file relinks to itself, effects keep their size at every render size, and a split's halves share one compressor]] —
  a file covers a clip when the clip's last frame starts inside it, so a
  whole-file clip relinks to its own file and slips no further than it;
  the RGB split, VHS's scan lines and the pixelate transition are sized
  at 1080p, so the viewer, stills and the export match; glow, denoise and
  sketch take a reach that versions scale (old ones load at the old
  reach); a split's halves share one EQ and compressor and render as the
  whole clip.
- [[ADR-118 A version's captions take its frame, pictures keep clear of them, and fades and push-ins are judged]] —
  a tall short's captions on 16:9 and 1:1 move to the bottom, all at one
  height, on 16:9 at a landscape caption's size (the typical one at most
  72, a countdown staying as much larger), titles keeping the short side;
  a picture-in-picture a version would draw across its captions moves
  above them; check_project names a title whose fade loses a part before
  the rest, and a version names a subject the master's push-in crops.
- [[ADR-119 A person corrects a song's grid and cuts its bars, markers say what they follow, and the check hears its joins]] —
  a song's Audio tab has a Beat grid: Detect keeps the reading as one
  fitted tempo and downbeat, drawn on the clip as CapCut's beat dots;
  tempo typed or tapped, the downbeat nudged or set at the playhead,
  parts added on the nearest bar, all through set_music_grid; the clip
  menu's Cut bars runs cut_music between In and Out; the Markers tab
  names the clip a marker follows and detaches it (update_marker
  detach); check_project hears each audio join on its own track, up to
  24, as click_at_join and sound_cut_at_join with a crossfade as the fix.
- [[ADR-120 Callouts and overlays pinned to footage, and frame_region moves]] —
  add_callout rings a part of a screen recording with the rest dimmed,
  two grouped shapes pinned to the recording that glide on and click as
  they draw; a title or shape takes an anchor (a point of a clip's
  picture) and its position is written from that clip's keys after every
  edit, exactly where they share frames and ease, re-pinned where a hand
  moves it; frame_region takes a list of moves; set_mask at keys from the
  values the mask had.
- [[ADR-121 Captions stay on top, ad elements keep rows of their own, and answers count what moved together]] —
  new tracks and overlays land under a captions row at the top; an ad
  element is one block on rows of its own and lands clear of the captions
  showing then; a lower third draws the logo it is given, a badge or button
  refuses one; check_project flags text over text; word captions hold
  their limit or say why; a ripple's moved clips are counted, music
  answers give the grid as counts, a narrowed describe_project leaves the
  brand kit out; the script's pace only over lines in a row; a drop or
  final hit ducked under a line is named; contact sheets label under each
  frame; measure_loudness kind explainer.
- [[ADR-122 Versions crop around what the editor framed, and callouts stay on what they point at]] —
  a version crops a shot around what its callouts point at, else the
  region the master's push or zoom frames, and the subject only where the
  master shows the shot whole; rings, spotlights' holes and pinned clips
  are written again from the version's picture (reanchor for anchors),
  a ring around a caption stays around it; a shape a version fits is
  sized by its own box, keys and stroke, never a transform scale; the
  check lists a callout off the frame or off what it pointed at, and its
  sheet labels under each frame.
- [[ADR-123 Fitted shots are footage a version reframes, and framing knobs act or say why]] —
  a shot fitted with bands (spanning the frame one way, covering its
  middle, nothing under it) is reframed as footage at its pixels against
  the short side, and every shot with fill covers the new frame at its
  widest; focus points with at make a path; options says what became of
  focus, pushes and overrides, an override carries the rings pointing
  into its picture, and coverage names footage left floating small;
  frame_region place_at puts a region anywhere at any zoom; a batch's
  follow is no hand move, and a re-pinned glide is described as one.
- [[ADR-124 Answers and hints that tell the truth, captions restyled together, lines as tall as their letters]] —
  review_voiceover compares numbers as said (ten eighty for 1080, minus
  for -14) and against the line's caption, never asking a slower read for
  a number written another way; baked keys and an answer's anchor glides
  are counted, a list spanning tracks shares per track, quiet: true on an
  edit answers ids, describe_project takes fields; set_caption_look moves,
  sizes and narrows every caption; check_project gives each zone finding
  the move that clears it and keeps a title's move inside the apps' zone;
  each line of a title is as tall as its letters, style_text_range takes a
  style object and says when the wrap parts a styled stretch.
- [[ADR-125 Elements keep their rows and their room, joins into silence move, callouts click on each part and stay in frame, exports replace when asked]] —
  nothing else lands on an ad element's own rows; an end card in a short
  room gives up its logo before its type, fitted by
  bisection, a pulsing button floored at the bottom of its pulse, and its
  parts overlapping are named; preview_audio and check_project name a
  join into the incoming file's silence and roll it a bar instead of
  asking for a crossfade already set; cut_music repeats bars; a
  main-track add a frame past the clip before starts where it ends;
  add_callout clicks on each glide's arrival; check_project names a
  callout that leaves the frame; export_video and export_versions replace
  a file of their name in the folder named when asked.
- [[ADR-126 The MCP server answers at once when the editor page is not listening]] —
  a listener flag and the main page's load hook answer requests at once
  while the editor is unavailable, drain interrupted requests with a
  warning to check the project, and keep the long timeout for exports.
- [[ADR-127 Timeline conveniences share search and edit paths, monitor mute belongs to preview]] - shared clip search and bulk transition setters, viewer defaults, and a session-only output gain for preview sound.
- [[ADR-128 Sound shaping uses the shared mixer and retimer]] — fade curves,
  independent pitch, editable voice presets, continuous split processing,
  and normalization through the export mixer.
- [[ADR-129 Color matching samples isolated stills and comparison stays in the viewer]] —
  match sampled shots through editable RGB curves and saturation; bypass
  looks on derived plans, and own reference captures only in the player.
- [[ADR-130 Film tools share speech and preserve readable layouts]]
- [[ADR-133 Crop softness, continuous rotation and regional masks]] —
  crop softness follows picture space, the rotation dial preserves turns,
  adjustments mix through masks, and static bezier paths share mask transforms.
- [[ADR-135 Film tools preserve authored timing and degrade previews gracefully]] —
  playable audio fallbacks, master-second version checks, authored lines and
  frame times, score endings, sound events, concrete duck advice, conservative
  subject framing and measured version fades.
