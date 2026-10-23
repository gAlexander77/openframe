# Automation

How other programs and AI agents make and edit videos with the app — all
on the user's machine. Three doors, one engine.

## The shot log, beside the speech transcript

In the desktop app, `analyze_footage` takes exactly one `asset_id` or
`clip_id`, an optional maximum moment interval (4–30 seconds, default 8),
`describe` (default true), and `refresh` (default false). It returns counts,
completeness, model, elapsed time and first-use download bytes. Long runs
return a retained job (`wait: 0` returns immediately); use `job_status` and
`cancel_job`. Repeating analysis reuses the running job for that asset, then
resumes missing descriptions from the saved log. `describe: false` measures
only; `refresh` replaces the reading. First description downloads about
2.9 GB once and runs the vision model on this computer, without a separate
installation or server to start.

Read `get_shot_log` in screenplay text or JSON, optionally bounded by `from`
and `to` source seconds. A clip defaults to its visible source window.
`find_shots` searches actions and on-screen text across every analyzed video
(or one `asset_id`); quoted phrases must match. These reads load saved logs
and use already-heard speech windows, never starting transcription.
`suggest_edit_points` takes source `ranges` and a boundary `window` (default
2 seconds), returning In/Out choices, reasons and up to two alternatives,
plus advice between consecutive ranges. Join calls use existing
`set_transition` (dissolve, dipBlack, none), `set_param` (transform.scale),
`detach_audio` and `trim_clip`; replace angle-bracket placeholders with
placed clip IDs and timeline seconds, and multiply a punch-in by the current
scale. Confirm audio handles and preview the join. Sound activity alone does
not prove speech; a J-cut suggestion is conditional on checking the speech.
`describe_moment` inspects three frames around source `time` (`span` default
1 second), answering a `question` in plain text or returning the structured
moment description. It returns a preparation job only when needed.

Order: analyze, read or search, suggest edit points, then check chosen ranges
with `preview_frames` before cutting. The browser build has no describer;
all five tools explain that shot logs need the desktop app. Partial logs
state how many moments are described. See `help` topic `shot_log` and [[MCP tools]].

How other programs and AI agents make and edit videos with the app — all
on the user's machine. Three doors, one engine.

## 1. Render a project file (pipelines)

Write a project as JSON ([[Project format]]; the smallest valid file is a
handful of lines, everything else defaults) and render it:

```
openframe --render project.json --out video.mp4
openframe --render project.json --out video.webm --resolution 720p --quality higher
```

Relative media paths resolve against the project file's folder. Progress
arrives on stdout as JSON lines:

```
{"event":"start","frames":180,"width":1280,"height":720,"codec":"avc","out":"..."}
{"event":"progress","fraction":0.856,"fps":288,"eta":0.1}
{"event":"done","out":"...","frames":180,"seconds":6,"bytes":434781,...}
```

Exit code 0 means the file is complete; 1 a failed render (the `error`
line says why); 2 bad arguments. Try it with `scripts/render-example/`.
([[ADR-029 Headless rendering reuses the app]])

## 2. Drive the running editor (agents, MCP)

Turn on **AI assistant → Connect agents → Allow AI agents** (desktop app).
Then:

- **HTTP** (Streamable HTTP): `http://127.0.0.1:47280/mcp` with
  `Authorization: Bearer <token>` (the panel shows and copies it).
- **stdio**: run `openframe --mcp-stdio` as the server command (the exe was
  `video-editor` before 2026-10-17; the panel always shows the current path).
  The bridge reads the token itself, so its command line holds no secret.

The app must be running with Allow AI agents on whenever the agent works;
start a new agent session after adding the server.
While the editor page is reloading or broken, the agent gets an immediate
error explaining that the editor is not ready, or that it reloaded before
answering and the project must be checked before retrying an edit.
Restarting OpenFrame clears this state so the editor can listen again.

**When the app gains tools.** A client lists a server's tools once, when
it connects, so tools (or parameters) a newer build adds stay invisible to
a session that was already open. Every answer names the tool set it came
from (`result._meta["openframe/tools"]`, a fingerprint of every name and
schema), and the server says `tools.listChanged: true`:

- **stdio** (`--mcp-stdio`): the bridge watches that fingerprint and sends
  `notifications/tools/list_changed` after the first answer from another
  tool set (the app was rebuilt and restarted while the client stayed
  connected), and the client lists the tools again. Nothing to do.
- **HTTP**: this server answers each POST and holds no stream to send a
  notification on, so reconnect: in Claude Code, `/mcp`, choose `openframe`
  and **Reconnect** (or restart Claude Code); in Codex, start a new session.

### Connect Codex CLI

1. Under **Connect agents → Codex**, click **Add to Codex**. The app runs
   Codex's own `codex mcp add` for the stdio bridge and says what happened:
   added, already added (an entry named `openframe` exists and is left
   alone), the `codex` command not found (with a link to its install
   guide), or Codex's error.
2. Or paste the panel's line into a terminal:

   ```
   codex mcp add openframe -- "<path to openframe.exe>" --mcp-stdio
   ```

3. Or add the panel's `config.toml` entry to `~/.codex/config.toml` by
   hand. It also raises the tool timeout to 300 s (Codex's default is 60)
   for long exports:

   ```toml
   [mcp_servers.openframe]
   command = "<path to openframe.exe>"
   args = ["--mcp-stdio"]
   tool_timeout_sec = 300
   ```

`codex mcp list` shows it; in a session, `/mcp` lists its tools.

### Connect Claude Code

1. Under **Connect agents → Claude Code**, click **Add to Claude Code**: the
   app runs `claude mcp add --scope user --transport stdio openframe --
   "<exe>" --mcp-stdio`, so OpenFrame is there in every project. Claude Code
   refuses a name it already has, which the panel reports as already added.
2. Or paste the panel's line, which connects over HTTP with the token:

   ```
   claude mcp add --transport http --scope user openframe http://127.0.0.1:47280/mcp --header "Authorization: Bearer <token>"
   ```

`claude mcp list` shows it and whether it connects.

The buttons need the desktop app and the CLI on PATH; they never write an
agent's config files themselves
([[ADR-065 One-click agent setup runs the agent's own CLI]]). The web
build has no MCP server, so its panel explains how to connect through the
desktop app instead.

**Start with [[MCP tools]]**: every tool, generated from the code, grouped
in the order a video gets made, with each parameter (nested fields
included) and an example call. [[Agent playbook]] is how a model should
make an ad, an epic edit or a short. A connected model gets the same
guidance from the `help` tool (topics `overview`, `ad`, `epic_edit`,
`social_short`, `design`, `params`, or a tool's name), from the MCP prompts
`make_ad`, `epic_edit` and `social_short`, and from the resources
`guide://...` and `catalog://all`. Tools carry MCP titles and behavior
hints (read-only, destructive, open-world; each only where it differs from
the spec's default), so clients can run reads without asking
([[ADR-055 The MCP guide is generated from the tools]]).

The server's instructions are four sentences: call `help` first, and the
conventions every tool shares. The guide itself (the steps that make a
video, tool by tool) is `help`'s overview, read once when asked for. Some
clients copy the instructions into every tool's description: Codex's
discovery did, and with the old 3.5 KB guide as the instructions it came to
188,924 tokens for 156 tools; about 63,000 now. `initialize` answers 794
bytes (was 3,760) and `tools/list` 190,654 (was 193,013)
([[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]]).

An argument a tool does not take is refused with the one it most likely
meant: `seek({"time": 11})` answers `args.at is required; args.time is not
a known argument; did you mean at? (known: at)`. The same goes for a nested
field (`style.fontSize`: did you mean `size`?), an unknown tool and a batch
step's command.

`import_media` (`{"files": [{"src", "name"?}]}`) knows a file by the file:
its path's or address's extension, else its first bytes (an MP4, PNG, MP3
and the rest by their signatures), never by `name`, which is only the label
the library shows; `{"src": "D:/promo/launch.mp4", "name": "launch"}` once
answered `[]`. It answers one entry per file in the order given: the asset
(`id`, `name`, `kind`, `duration`, `width`, `height`), a `.cube` as
`{"lut_id", "name", "kind": "lut"}` for `apply_lut`, or `{"src", "name",
"error"}` saying why that file failed. When every file fails, the call is
an error naming each reason.

Tools: every editing command (`add_media_clip`, `add_text`, `split`,
`trim_clip`, `set_transition`, `add_captions`, `cut_ranges`, ...) with JSON
Schemas, plus `describe_project`, `list_catalog`, `import_media`, `undo`,
`redo`, `seek` and `preview_frame` (returns the composited frame as a
PNG, drawn as the export draws it and `max_width` pixels wide, at most
the canvas's width, so an agent can look at its work; it once read the
viewer's canvas, which is only as big as it is on screen, and a 9:16
project came back 222 pixels wide whatever was asked; it and the contact
sheets draw each frame at the canvas's size, its short side at most 1080,
and bring it down, so a title weighs what it weighs in the exported file:
drawn at 640 wide, small type came out 3 to 21% heavier,
[[ADR-098 Sound is mixed by role, beds are synthesized, an agent can listen]]), the project tools
`list_projects`, `open_project` (by id or name; it saves the open project
first) and `new_project` (a scratch project, so an agent's experiments
leave the user's projects alone), both answering a summary (name, canvas,
fps, duration, counts) rather than the whole timeline (about 20 KB on the
launch film), as `open_project_file` does too, `preview_frames` (one contact sheet of
up to 24 moments, each stamped with its time; it, `preview_media` and
`preview_motion` all take up to 8 `columns`), `export_video`,
`export_versions` (every shape and cut-down of an ad, one file each) and
`export_status`, and the local AI tools:
`remove_silences`, `split_scenes`, `mark_beats`, `normalize_loudness`,
`duck_under_speech`, `reduce_noise`, `stabilize_clip`, `sync_audio`
(line a separately recorded sound up with its video by waveform; the
`sync_to_clip` command places one by a known offset),
`track_motion` (pin a layer to a subject in the video under it),
`auto_reframe` (into another canvas shape, following the subject),
`add_sound_effect` (a built-in whoosh, pop, ding... at a time; `sounds`
places a list, `[{name, start | end_at, volume, track_id}]`, in one call and one
undo step, since it cannot go in `batch`; they land on the SFX track, made
the first time, never in a gap on the voiceover or the music, or on
`track_id`), `add_ambience` (a natural sound bed under the pictures, see
Sound by role below), `preview_audio` (hear the mix or one stem: an MP3
and its measurements, below),
`set_caption_look` (one of six caption looks, and a place, size and wrap width, for every caption),
`slip_clip` (a later or earlier part of a shot's source, same place and
length), `roll_edit` (a cut between two touching clips moved in one call,
nothing else moving: the Roll tool), `move_track` (up or down the stack, so a grade sits under the
titles), `save_project_copy` (a variant to work by hand, the original
kept), effect parameters by place, id or type in `set_param` and the
keyframe tools (`effects.0.amount`, `effects.glow.threshold`), `batch` steps that name clips earlier steps added (`"$1"`,
`"$2.2"`), `check_project` (the design rules measured on the edit: title safe, the
vertical apps' buttons, text too small for a phone (named by its share of
the frame's height; the floor is 4.5% of the short side, 5% on a tall
frame or `kind: social_short`) and reading time, the WCAG contrast of
every title with the rendered picture behind it at a few moments of its
life, its box, shadow and outline counted, each low one named with its
time and a box or outline measured on the same pixels (`contrast.lowest`
lists every ratio), caption speed, fonts, flashes over 3 a second, black
gaps, music that stops dead (its last second decoded, so a track that
fades out in its own audio passes), an ad's end card, an epic edit's cuts
on the beat; shots counted where the viewer sees them, across tracks, or
on the busiest picture track; `ok` is true when there are no errors and
`verdict` says what is left in words; `not_checked` says what was not
measured and why; each finding names the fixing tool,
[[ADR-068 check_project measures the picture and the sound it judges]],
[[ADR-097 Checks and versions judge by the picture]]),
`preview_motion` (consecutive frames of a stretch, with the cuts and beats
in it, tiles up to 640 wide as `preview_frames`'), `preview_media` (an imported video's own frames, to choose
moments), `set_blend`, `set_chroma_key`, `set_canvas_fill`, `set_fades` (sound fades
in seconds) and `duplicate_clips` (what the inspector could do and agents
could not), `text_behind_subject` (titles behind a video's subject) and
`remove_background` ([[AI tools]]); the `set_background_removal` command
turns an existing matte off and on. Every agent edit is undoable and
visible as it happens. ([[ADR-008 MCP is a handler over the command registry]],
[[ADR-009 Agents reach the app over local MCP, opt-in]])

Edits answer with what they changed, not the whole timeline:
`{"duration": 6, "added_clips": [...], "changed_clips": [...],
"removed_clips": ["c_..."]}` (and `*_tracks`, `added_assets`, any other
part that differs), each clip as `describe_project` shows it plus its
`track`; `{"unchanged": true}` when nothing did. Compounds are answered
only when they changed, summed up (`added_compounds`, `changed_compounds`:
`{id, name, duration, clips}`, plus the clips changed inside, as an
`edit_compound` changes them; `removed_compounds`), never with their whole
nested timelines (3 KB an edit on the launch film's six windows). `undo`
and `redo` answer the same way. `describe_project` is still the whole
picture by default; `clip_ids`, `track_ids` or a stretch (`start`, `end`)
narrow it to those clips with the media and markers they use, `assets` and
`markers` false leave those lists out, and `shown` says how much of each
list the answer holds ([[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]]).
The compounds a clip shown plays come whole, nested ones too; a track or
clip inside a compound is found by its id; an empty id list is no filter,
and `start` equal to `end` is a moment ([[ADR-108 set_param sets what a clip has, borders stay outside see-through pictures, versions keep a frame's pixels]]).
Keyframes are included: each keyed path's keys as `[at, value]` or
`[at, value, ease]` in timeline seconds (`"transform.x": [[3, 0.75,
"fastIn"], [3.5, 0.16]]`; a path with more than 24 keys as `{count,
first, last, range}`), so an edit to a key shows in its answer. A title
shows the type that departs from the default look under `style`, named as
`add_text` takes it (`"style": {"font": "Georgia", "maxWidth": 0.5,
"letterSpacing": 12, "lineHeight": 0.95}`; also `align`, `italic`,
`underline`, `stroke2`, `gradient`, `glow`, `accent`, `highlight`), beside
its `size`, `color` and `weight` (shown whenever it is not 700). A speed
curve shows its name and its points: `"speed_curve": "custom",
"speed_points": [[0, 2], [0.5, 0.5], [1, 2]]`, each `[t, speed]` with `t`
from 0 to 1 over the clip, as `set_speed_curve` takes them.

Keyframes go only where something moves ([[ADR-066 Keyframes are refused where nothing moves and shown in answers]]):
`add_keyframe` refuses a path the renderer or the mixer does not read on
that clip, and the error lists the ones it does (`help` topic `params`
has them all; `src/lib/animatable.ts` is the one table). `set_param` with
`at` refuses to add a key to dead keys. `add_keyframe`,
`set_keyframe_ease` and `set_audio_filter`'s sweep share one ease
vocabulary, the easing menu's twelve presets, and the keyframe tools take
a `bezier` `[x1, y1, x2, y2]` too: `fastIn` is the modern expo-out, so a
window sliding in is `{"path": "transform.x", "at": 3, "value": 0.75,
"ease": "fastIn"}` then the landing key. Text styles take `lineHeight`.

`batch` runs `{"commands": [{"command": "set_animation", "args": {...}},
...]}` in order as one edit and one undo step, all or nothing: a failing
step names its number (`step 2 (set_animation): no clip with id nope`).

`apply_layout` takes `fit`: `cover` (default) crops each picture to its
cell, `contain` shows the whole picture centered in it (screen
recordings), with `background` (a CSS color) filling the cell behind it as
an editable shape. The Layout tracks go directly above the highest of the
chosen clips' tracks, so titles already above them stay on top.

`set_compressor` evens out a video's or audio clip's sound: `{"clip_ids":
[...], "preset": "voice"}` (voice, gentle, strong or off), with threshold,
ratio, knee, attack, release and makeup to adjust it; `describe_project`
names the preset or `custom`. `normalize_loudness` measures through it.

Sound design ([[ADR-060 Sound design rings past the clip and is measured as exported]]),
on video and audio clips:

- `set_audio_filter` `{"clip_ids", "type": "lowpass"|"highpass", "cutoff"
  (Hz), "resonance" (dB), "sweep": {"to" (Hz), "start", "end" (timeline
  s), "ease"}, "off"}`: 24 dB per octave; `sweep` keys the cutoff, on a
  log scale ("muffled build, open on the drop": `cutoff` 400, `sweep`
  `{"to": 20000, "start": 4.5, "end": 5}`).
- `set_reverb` `{"clip_ids", "preset": "room"|"hall"|"cathedral", "size"
  (0..1), "decay" (s, RT60), "mix" (0..1), "off"}`.
- `set_echo` `{"clip_ids", "time" (s), "feedback" (0..0.9), "mix", "off"}`.
- `set_tape_stop` `{"clip_ids", "duration" (s), "off"}`: the sound slows
  to a stop, pitch diving, over the clip's last seconds.
- `add_keyframe` animates `lowpass.cutoff`, `highpass.cutoff`,
  `reverb.mix` and `echo.mix`; `describe_project` lists the effects on
  (`lowpass`, `highpass`, `reverb`, `echo`, `tape_stop`).

Sound by role ([[ADR-098 Sound is mixed by role, beds are synthesized, an agent can listen]]):

- Every audio track is a stem: `role` `dialog`, `music`, `effects` or
  `ambience`, set by the tool that made it (`add_voiceover`,
  `generate_music`, `add_sound_effect`, `add_ambience`) or by `add_track`
  and `update_track` (`role`; `auto` clears it). A track without one is
  judged by its files (a spoken line is dialog, a made effect effects, a
  bed ambience, an imported song music), never by its name;
  `describe_project` names each audio track's `role`. New sounds land on
  their stem's track; an imported song never in the voiceover's gap.
- `add_ambience` `{"name", "start", "end" | "length", "fade_in" (default 1),
  "fade_out" (1.5), "volume", "seed", "track_id"}` lays a bed made on this
  computer: `wind`, `stream`, `waterfall`, `surf`, `rain`, `rocket`,
  `city`, `roomTone` (`list_catalog` section `ambience`). Each moves as a
  recording does (gusts with no lull running into the next, waves every
  6.5 to 13 s, cars passing near and far, the first wave or car within
  1.5 s), is made at a level that sits under a voice at volume 1 (about -27
  LUFS; waterfall -24, rocket -21, room tone -46) and loops without a seam;
  past 300 s the file repeats. It answers `clip_ids`, `asset_id`,
  `track_id`, `start`, `end`, `file_seconds` and `reused` (the same name
  and seed reuse a long enough file). `{"name": "waterfall", "start": 22,
  "end": 34, "volume": 0.7}`.
- `preview_audio` `{"start", "end" (default start + 10, at most 30 s),
  "solo": "mix" | "voice" | "music" | "effects" | "ambience", "loudness",
  "audio"}` renders the stretch through the mixer export uses and answers
  an MCP audio block (`audio/mpeg`, 96 kbps stereo, about 12 KB a second)
  and, as text, `integrated_lufs`, `short_term_max_lufs`,
  `momentary_max_lufs`, `true_peak_dbtp`, `per_second_lufs`, `silent`
  (stretches under -60 LUFS), `spectrum` (`low`, `mid`, `high` shares,
  `slope_db_per_octave`), `correlation`, `clipped`, and for the mix
  `stems` (each stem's loudness). `loudness` hears it as `export_video`
  with that target delivers it; `audio: false` answers the numbers alone.
  The picture's own sound plays only in the mix.

Delivery ([[ADR-061 Delivery holds the true peak and says whether it passes]]):

- `measure_loudness` `{"spec": "online"|"ebu_r128"|"atsc_a85", "loudness",
  "start", "end", "kind", "by_track", "per_second"}` renders the mix as
  export does and answers `integrated_lufs`, `loudness_range_lu`, `range`
  (the LRA against what `kind` usually spans: film 5-15 LU, ad 3-8, social
  3-10, podcast 3-8, any 3-15, with a `verdict` and a note when it is flat
  or wide), `short_term_max_lufs`, `momentary_max_lufs`, `true_peak_dbtp`,
  `sample_peak_dbfs`, `pass` and `problems` (every spec when none is
  named; `clips` when the mix passes full scale; a `fix` when it fails).
  With `loudness` it measures what `export_video` at that target delivers.
- `by_track` measures each audio track alone as mixed, with its `role`
  (`integrated_lufs`,
  `short_term_max_lufs`, `loudness_range_lu`; `per_second: true` adds the
  three-second loudness every second) and the voice (the dialog tracks) over
  the music (the music tracks, by role) in three named windows ([[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]]):
  `program` (the whole stretch, the music between lines in: it reads
  lowest), `speech` (while the voice speaks, its lines from first word to
  last, together) and `per_line` (each line alone: `min_lu`, `median_lu`,
  `max_lu` and where the lowest is).
- `duck_under_speech` `{clip_id | track_id, voice_above_music_lu?,
  min_line_lu?, max_line_lu?, depth?}` keys the music down under speech:
  one clip, or every clip of a track as one bed (`track_id`, a song cut
  into pieces in one call). `voice_above_music_lu` aims the speech window;
  `min_line_lu` holds every line to at least that many LU, each line's dip
  as deep as it needs (`depth`, or the depth the speech target chose, is
  the usual dip); `max_line_lu` (default 15, or 3 over a higher target or
  minimum, whenever the call measures) to at most, a line over a quiet
  passage dipping less, the others moving so the lines together stay on
  the target (a ceiling under the target is refused); all are met by
  rendering the stems and measuring again. Voices inside compound clips
  count. `balance` answers the speech window's numbers, `target_lu` and
  `met`, and `per_line` (`min_target_lu`, `max_target_lu`, `each` line's
  margin and dip). The music keeps how it was ducked: `retake_voiceover`
  dips it again under the new take (`ducking` in its answer), and an edit
  that moves a line under it, or moves the music and its dips, answers a
  note ([[ADR-104 Voice and sound an agent can trust without ears]],
  [[ADR-107 A split plays on, a cut keeps its downbeat, and a duck follows its music]]).
- `cut_music` `{clip_id, from, to, snap?, crossfade?}` takes bars out of a
  song (the file's seconds, on its grid's bar lines, each piece meeting
  the cut on the frame before its bar so both downbeats play whole) and
  joins the pieces with a 30 ms crossfade ending on the downbeat; `set_crossfade`
  `{clip_id, seconds}` crossfades any audio clip into the next on its
  track. `preview_audio`'s `edges` measure each join (`dip_db`,
  `click_db`, `step_db`, `tail_cut_db`; a click or a jump only where the
  incoming file has none of its own there) and `dropouts` any few
  milliseconds of silence inside sound.
- `normalize_loudness` takes `spec` for a spec's target and true-peak
  ceiling; `export_video`'s `loudness` holds the true peak under -1 dBTP
  (-2 at ATSC's -24) and answers the `loudness` it reached.

`add_voiceover` narrates a script, directed
([[ADR-083 Voiceover lines are directed in the script and keep it]]):

```json
{"lines": [
  {"text": "Meet OpenFrame. [pause 0.4] The editor on your own computer."},
  {"text": "Every edit is a tool an agent can call,", "voice": "am_michael"},
  {"text": "so a whole film can be made by asking.", "voice": "am_michael", "pause_after": 0.8},
  {"text": "Free. [beat] Yours.", "at": 12, "caption": "Free and yours.", "pace": "slow"}],
 "voice": "af_heart", "read_as": "ad", "pronounce": {"OpenFrame": "Open Frame", "MCP": "M C P"}}
```

- Each line is read on this machine, whole, and placed after the one
  before at its real length (or at its `at`, never overlapping) on a new
  Voiceover track, with a caption per line, as one undo step with its
  speech files.
- Pace ([[ADR-096 A voice's pace, a song's grid and a mix's balance are measured where they apply]]):
  each line lands on its words a second over its speech (first word to
  last): `read_as` `narration` (2.3-2.8, the default), `ad` (2.6-3.1) or
  `social` (2.8-3.4), or `words_per_second` `[lowest, highest]` for the
  call or a line. With no `speed`, a line is read at a speed guessed from
  its syllables, measured, and read again at the speed the measure calls
  for (up to three reads, speeds 0.6-1.3; the audio is never stretched).
  Heart narrates at 0.6-0.9. A `speed` given is kept as given.
- Per line: `voice` (another speaker, or a blend `"af_heart:70,af_bella:30"`),
  `speed`, `words_per_second`, `at`, `pause_after`, `paragraph`, `caption`,
  `pace` (`slow`, `normal`, `fast`: the pace the line is meant to have,
  kept with its script; it moves the line's band half a word a second, for
  the read and the review). The gap after a
  line follows its ending unless `pause_after` or the call's `gap` says
  otherwise: 0.4 s after a sentence, 0.1 s after a comma, 0.6 s after an
  ellipsis, 0.8 s after a paragraph.
- Emphasis cannot be directed: Kokoro takes phonemes, punctuation and one
  speed per input, and raising a word's stress (its author's own emphasis
  mark) or quoting it measured no emphasis (ADR-096). `*word*` stars are
  dropped from the voice and the caption, and the answer's `notes` says
  so and what works instead: the word last in its phrase, or
  `[pause 0.2]` before it.
- Pause marks inside a line: `[pause]` (0.5 s), `[pause 0.4]`,
  `[pause 300ms]`, `[beat]` (1 s), `<break time="0.4s"/>`. The voice's own
  pause there is lengthened; where it ran through, the line is read in two
  parts at that phrase boundary (the answer's `pauses` says `stretched` or
  `split`). Captions never show a mark.
- `pronounce` respells words for the voice only; captions keep them.
- `quality`: `best` (fp32, the default) or `draft` (8-bit); `finish`:
  `natural` (the default: a reader's pauses, EQ, one loudness, room tone,
  fades, the voice compressor and a touch of room), `clean` or `raw`
  ([[ADR-084 Voiceover is read at full precision and finished like a recording]]).
  `enhance: false` drops the compressor.
- It answers `{"lines": [{"text", "start", "end", "seconds", "voice",
  "speed", "words_per_second", "target_words_per_second", "speed_chosen"?,
  "reads"?, "voice_clip", "caption_clip", "pauses"?}], "end", "finish",
  "engine": {"quality", "device", "dtype"}}`: cut the footage to those
  times.

`review_voiceover` (`{"clip_ids"?, "music"?, "recheck"?}`, read-only) hears each voice
line with Whisper and answers per line `script`, `heard`, `match` and
`differences` (`missing`, `extra` or `misheard`, with `at` on the
timeline; a short word a letter off is `minor`; `match` counts a word
heard that is not in the script, which is heard again too), `pace`
(`target_words_per_second`, `over_speech` with its pause marks out and
`over_clip` words and syllables a second, `on_target`), `lead_silence`, `tail_silence`,
`longest_pause`, `loudness_lufs`, `true_peak_dbtp`, `pitch` (`median_hz`,
`range_st`), `voice_above_music_lu` (the line window: this line, first
word to last), a `verdict` (`ok` when nothing fails, or the problems),
`fixes` (`{problem, tool, args}`) and `advice` (`{note, tool?, args?}`:
notes that do not fail the line, such as a pace within a tenth of its
band), plus a `summary` (lines ok, to fix and with advice; the lines'
words a second, the script's words a second with the gaps between lines
in, the lines' margins over the music, the loudness spread). Pace is
judged in words a second against the band the line was read to;
syllables a second only catch long words rushed. A line that differs from
its script is heard again by Whisper small (`recheck`, default true; about
250 MB downloaded once): each difference gains `likely`, `recognizer` (heard
right the second time: no fix, a `notes` entry says so) or `voice`, and the
line `heard_again` and `match_again` ([[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]]). A misread word's fix is a
`pronounce` respelling as it sounds ("does" "duz", "home" "hohm", "MCP"
"M C P"), or, when it was respelled already or nothing reads differently,
a slower read with the advice to reword; never a placeholder.
Automatic captions and `get_transcript` give a whole voice take with a
known script its script's words, timed by Whisper. `retake_voiceover`
(`{"clip_id", "text"?, "caption"?, "voice"?, "read_as"?,
"words_per_second"?, "speed"?, "pronounce"?, "quality"?, "finish"?,
"pace"?, "ripple"?}`) reads one line again in its place: same clip id,
its caption follows, the old take leaves the library, `ripple` moves the
lines and captions after it. A pace asked for (or a line whose speed was
chosen) is landed again by measuring; a speed given before is kept. `list_catalog` section
`voices` describes every voice for casting; `help` topic `voiceover` is
the playbook.

`frame_region` shows part of a picture full screen: `region` is a
rectangle in fractions of the source (`{"x": 0.5, "y": 0, "w": 0.5,
"h": 1}` is the right half), `fill` (default) covers the canvas, `fit`
shows the whole region; the picture slides back where it would uncover
empty canvas. `to_region` (with optional `from`/`to` seconds) eases from
one to the other: the push-in on a screen recording.

Original music ([[Features]], Generated music;
[[ADR-085 Music is composed and synthesized in the app, seeded and offline]],
[[ADR-086 A score fits an edit by whole bars and a nudged tempo]]):

- `generate_music` `{style: launch | cinematic | corporate | lofi |
  ambient, bpm?, key?, mode?, length? | sections?: [{name, bars? |
  seconds? | at? | end_at?, energy?, seed?}], seed?, ending?: ring | stop,
  fx?, max_nudge?, loudness?, stems?, place?: mix | stems | none, start?,
  markers?, name?, brightness?}` composes and renders a score on this computer (about
  10-15 s for a minute with stems, in a worker), imports it (and the drums, bass, harmony
  and lead stems when asked) and places it, as one undo step. It answers
  the cue sheet in timeline seconds: `bpm`, `key`, `progression`, `beat`,
  `bar`, `sections` (`name`, `role`, `start`, `end`, `bars`, `energy`),
  `drops`, `final_hit`, `breaths`, `bars`, `beats`, `cut_points` (`at`,
  `kind`: drop, section, phrase, bar), `fit` (each asked-for time, what it
  got, the error and the tempo nudge), `measured` (LUFS, true peak, PLR,
  stereo correlation, the power below 250 Hz, to 4 kHz and above, the
  octave slope, the `brightness` used) and the new `asset_id`, `clip_id` and `stems`. A drop at
  8.4 s after a four-bar intro: `{"style": "launch", "sections": [{"name":
  "intro", "bars": 4}, {"name": "drop", "at": 8.4, "bars": 8}, {"name":
  "outro", "end_at": 30}]}` plays at 114.3 BPM.
- `brightness` (-1..1, default the style's: launch 0.4, the rest 0) tilts
  the master about 1 kHz: 1 lifts the highs 6 dB from 3 kHz and lowers the
  lows 3 dB under 300 Hz; the loudness and true peak are met after it, and
  the stems still add up to the mix.
- `plan_music` (read-only) answers the same cue sheet, and the chord of
  every bar, without rendering: try a form, then generate with the seed
  it answers.
- `analyze_music` on a generated score finds its tempo, drops and section
  starts within a bar, except a ring-out outro (its final chord has no
  onsets for the beat tracker; it reads as the end of the last drop): the
  cue sheet is the authority on the ending.
- `window.videoEditor.ai.generateMusic(args)` is the same call for scripts.

Epic edits ([[Features]], Epic edits), music-synced montages in a few calls:

- `analyze_music` `{clip_id, markers?, bpm?, first_downbeat?, cues?, detail?}`:
  tempo, the beat grid (`first_beat`, `beat_seconds`, `bar_seconds` and the
  beats `off_grid`), downbeats, phrases, sections (intro, verse, build,
  drop, breakdown, outro, with energy), counts and the drops, in timeline
  seconds; `detail: "full"` adds every beat, its energy and the hits; `markers` (`beats`, `bars`, `phrases`, `sections`,
  `drop`) also drops markers. The whole music file is read (once per file
  and hints; files over ten minutes, the clip's stretch and a minute either
  side) and its grid mapped through the clip's in-point, speed or speed
  curve and position, so a trimmed or moved clip keeps the file's bar phase
  and drops; `source` says what was read and whether it was cached.
  `confidence` (0..1: `tempo`, `bars`, `sections`) says how sure each
  reading is, with a `note` naming the hint to give when one is low. Hints
  in the file's own seconds replace what is detected: `bpm`,
  `first_downbeat` (a bar's first beat; with `bpm`, the whole grid) and
  `cues` (`[{at, label}]`, each part to the next; a drop cue after another
  part is a drop).
- `cut_to_beats` `{media: [{asset_id, in?, beats?}], grid?, beats?,
  every?, pattern?, start?, end?}`: shots end to end on the main track,
  every cut on a beat, bar or phrase.
- `add_beat_hits` `{effect | effects, times? | at_cuts? | marker_label?,
  every?, from?, to?, duration?, intensity?}`: flash, zoom, shake,
  rgbSplit, glow or zoomBlur hits on a Hits track; at most three flashes
  a second.
- `add_cinematic_bars` `{ratio?, start?, end?, animate_in?, animate_out?}`:
  letterbox bars (2.39 by default) under the titles.
- `set_speed_ramp` `{clip_id, at?, moment?, speed?, base?, hold?, ease?,
  preset?}`: the slow (or fast) moment of a ramp on a beat; the clip keeps
  its place and length.
- `fit_music` `{clip_id, drop_at?, drop?, end?, end_at?, fade_out?,
  fade_in?, trim_picture?}`: the drop where it belongs, the end with the
  picture or on a bar, faded.
- `add_sound_effect` takes `end_at` (the sound ends there: a riser peaks
  on the drop) and offers impact, subDrop, braam, reverseCymbal, glitch,
  shutter and swooshUp; `set_transition` takes whipLeft, whipRight,
  zoomPunch and spinBlur.

`add_text` (and a title added from the library) wraps inside the safe area
where the title stands unless `style.maxWidth` says otherwise: 0.9 of the
width centered (as before), on 9:16 the apps' column (0.62 centered), off
center twice the room on the nearer side. Titles already made keep their
width.

Text styles take `background` (`{"color": "rgba(0,0,0,0.6)", "padding":
16, "radius": 8}`), `stroke` and `shadow`, so a title reads over busy
footage; an empty color removes one. Ad looks: `glow` (`{"color":
"#00e5ff", "blur": 24, "strength": 2}`), `gradient` (`{"from": "#ffffff",
"to": "#ff3d7f", "angle": 0}`), `stroke2` (a second outline) and `accent`
(the kinetic sweeps' color).

Ads ([[Features]] > Ads and deliverables): `set_brand` keeps the brand kit
in the project (`describe_project` shows it as `brand`), `add_text`
takes a `role` from it, `apply_brand` restyles titles and solids,
`add_ad_element` adds an `end_card`, `lower_third`, `offer_badge`,
`cta_button` or `logo_reveal` in one call (`{"element": "end_card",
"start": 12, "headline": "Fresh roast, every morning", "cta": "Order
now"}`), and the app tool `text_behind_subject` (`clip_id`,
`text_clip_ids`) puts titles behind a video's person or product.
`set_fades` fades music in seconds (`{"clip_ids": ["c_..."],
"fade_in": 0.5, "fade_out": 1.5}`); the clip stores frames.
`export_versions` renders the deliverables in one call: `{"ratios":
["16:9", "9:16", "1:1"], "durations": [15, 6], "textless": true,
"loudness": -14}` (or `versions` spelled out, each `ratio`, `duration`,
`textless`, `fit`, `name`, `reframe`, `focus`), one file each, the project
untouched; with `"check": true` it answers a contact sheet of every
version instead, and with `"save_projects": true` it saves each version as
a project of its own (named as its file, sharing the media) to fine-tune
and export with `export_video`. Footage a new shape crops is framed on its
subject and follows it ([[ADR-097 Checks and versions judge by the picture]]):
the app looks at every full-frame shot every half second, finds what
stands out (minimum barrier distance plus spectral residual), places the
crop over it inside what the master showed (keyed pushes and pans kept),
and keys the shot's position; `reframe: "center"` keeps the old centered
crop and `focus: [{clip_id, x, y}]` puts a point of a clip's picture at
the frame's center. The check sheet outlines in orange a subject a
framing still cuts and lists each in `subjects`, with the focus that
keeps it.
Cut-downs keep the end card (`keep_end` seconds, default the end card's
length). `captions` (on the call or a version) is `burn`, `none` or
`as_project`: a tall version (9:16, 4:5) burns them by default, even from
a hidden caption track, at the tall frame's caption place with their type
kept against the short side; the rest keep the project's. In another shape an ad element, or any group, moves and scales
as one unit: its parts keep their layout, it stays against the edges it
was against (or centered), and it shrinks to fit the safe area when it
must ([[ADR-063 Versions fit a group as one unit]]). Hand-animated
layouts adapt too ([[ADR-067 Versions lay keyframed motion out again around its rest]]):
each layer is placed where it rests (a slide-in where it lands), its keyed
motion laid out again around that (a slide from off the edge still starts
off the edge); a compound clip moved or scaled as a picture (a floating
window) is refit as one picture and placed like a logo, shrunk into the
safe area when the frame would cut it; a word too wide to wrap shrinks to
the safe width. A tall version of a wide film stacks what stood side by
side ([[ADR-091 Tall versions stack what stood side by side]]): a picture
in one half with a title or picture in the other becomes the picture above
the title, each as wide as the safe column (a split screen's cells cut
again wider), what sat on a picture (a label, a glow) moving with it, all
above the burned captions; a square version moves such a pair as one
group. `check_at` (fractions of each version's length) picks the
moments the check sheet shows. Long runs answer
`running`; `export_status` follows them and lists the `versions` when
done.
`describe_project` now names a clip's `name` and `group`, so an
element's parts are easy to find.

`set_animation` plays kinetic typography on titles: the presets
`typewriter`, `letterRise`, `letterFade`, `wordPop`, `wordRise`,
`wordSlide`, `lineRise`, `highlightSweep` and `underlineWipe`, or any
animation with `unit` (`letter`, `word`, `line`), `stagger` (0..1) and
`order` (`forward`, `backward`, `center`, `random`): `{"clip_id": "c_...",
"slot": "in", "type": "rise", "unit": "word", "stagger": 0.6, "duration":
0.8}`. `duration` covers every unit.

`export_video` (`name`, `format`, `resolution`, `quality`, `loudness`,
`start`, `end`, `folder`, `replace`) writes to `<Videos>\OpenFrame\` with no
dialog, or into `folder` (an absolute path, created if missing), and never
replaces a file: a name already there gets a number (`Trip (2).mp4`) and the
answer's note says so. `replace: true`, with `folder` only, replaces a file
of the same name in that folder when the export finishes, so an agent can
supersede its own earlier export; the note says so
([[ADR-125 Elements keep their rows and their room, joins into silence move, callouts click on each part and stay in frame, exports replace when asked]]).
It answers with the path, size and a note (what the loudness pass did, and
any new name). Past about four minutes it answers `running`; follow it with
`export_status`. `export_versions` takes the same `folder` and `replace` for
every version, and `collect_project` (`{"folder"}`) makes its new
`OpenFrame-<time>` folder inside the one named instead of asking in a
dialog. In the browser build `folder` is refused with the reason, not
ignored. ([[ADR-052 Agents read what changed and export without a dialog]],
[[ADR-095 Media is known by its file, agents choose where files go, the guide is read once]])

Graphics and compositing, for ads and title sequences
([[ADR-056 Track mattes cut a layer with another clip]] to
[[ADR-062 Overshoot eases are named and wiggle is seeded noise]]):

- `add_shape` `{kind: rectangle | rounded_rectangle | ellipse | line, start, duration, x, y, width, height, color, gradient: {from, to, angle, kind: linear | radial, x, y, radius}, fill, stroke_color, stroke_width, radius, draw, feather, rotation, opacity, track_id}`: a shape layer, above everything at that time; sizes are canvas fractions, stroke and feather pixels at 1080p. A radial gradient runs from `from` at the center to `to` at the rim (an ellipse fitting the box; `x`, `y` move the center by fractions of the box, `radius` is a fraction of its half size); `feather` fades the edge over that many pixels ([[ADR-069 Large blurs run on a downsampled pyramid]]). A soft glow: `{kind: "ellipse", width: 0.6, height: 0.8, gradient: {kind: "radial", from: "#6a5cffcc", to: "transparent"}, feather: 120}`, plus `add_effect` blur with `amount` up to 500 (a 300-pixel radius).
- `set_shape` `{clip_ids, kind, width, height, color, gradient, fill, stroke_color, stroke_width, radius, draw, feather, at}`: change shapes; animated numbers get a key at `at` (paths `shape.width`, `shape.height`, `shape.radius`, `shape.stroke.width`, `shape.draw`, `shape.feather`, `shape.gradient.angle`, `shape.gradient.x`, `shape.gradient.y`, `shape.gradient.radius`).
- `set_shadow` `{clip_ids, color, blur, x, y, opacity, off, at}`: a drop shadow cast by the finished picture (after mask, effects and track matte), so a rounded compound window casts one rounded shadow; blur 0..600 and offsets in pixels at 1080p; keyframe `shadow.blur`, `shadow.x`, `shadow.y`, `shadow.opacity` ([[ADR-070 Drop shadows are cast by the finished picture]]).
- `set_tilt` `{clip_ids, x, y, perspective, at}`: perspective tilt, degrees (x tips the top away, y turns the right side away, as CSS rotateX and rotateY), seen from `perspective` pixels at 1080p (default 2000); keyframe `transform.rotateX`, `transform.rotateY`, `transform.perspective`. A three-quarter window: `{y: -18, x: 6}`.
- `set_track_matte` `{clip_id, matte_clip_id: <clip id> | "above" | "none", mode: alpha | alphaInverted | luma | lumaInverted}`: the clip shows only where the matte clip's picture is (video inside text, wipe reveals); the matte is not drawn.
- `set_motion_blur` `{clip_ids, on, shutter_angle}`: moving clips (and slides, pushes, zooms, spins) blur over the shutter, 180 degrees by default.
- `set_edge_mode` `{clip_ids, edge: none | mirror | repeat}`: copies of the picture fill the canvas around it when it moves, shrinks or shakes.
- `set_wiggle` `{clip_ids, target: position | x | y | rotation | scale, frequency, amplitude, strength, seed, at}`: seeded shake or drift (pixels, degrees, percent); `strength` with `at` keys a ramp; amplitude 0 removes it.
- `add_keyframe` and `set_keyframe_ease` take `spring`, `elastic` and `bounce`, which overshoot and settle, among the twelve presets they share.

`describe_project` shows a color clip's `color`, a shape's `shape`, and
`track_matte`, `motion_blur`, `edge`, `wiggle` and `shadow` where set.

Type ([[ADR-071 Keyed title styles redraw the title]]): `style.weight`
(100..900, wins over `bold`; `bold` alone clears it) in `add_text` and
`set_text`; `animate_text_style` `{clip_id, keys: [{at, size,
letter_spacing, color, ease}]}` keys a title's size, tracking and color
(a tracking expand: `[{at: 1, letter_spacing: 0, ease: "easeOut"}, {at:
2.5, letter_spacing: 24}]`). `add_keyframe` keys `style.size` and
`style.letterSpacing` too; `style.color` keys hold 0xRRGGBB numbers.

## 3. Ask in plain words (AI assistant)

The AI assistant panel runs a model on this computer (Ollama or LM Studio,
found automatically) over the same tools. With a 9B local model, "add a title
Welcome from 1 to 4 seconds" takes about 10 s; "split at 5 s and put a
dissolve between the parts" about 2 s. Each answer can be undone as a whole.

## In the page

`update_marker` takes `marker_id` plus optional `at` (timeline seconds),
`label`, `color`, and `detach` (a marker that follows a clip stays where
it is, the timeline's own; ADR-119). `delete_markers` takes `marker_ids`; unknown IDs reject
the entire command. Both are undoable and leave clip positions unchanged.
Marker descriptions now include `id`, integer `frame`, and `color` alongside
the existing `at` and `label`, so agents can target the note they described.

`edit_effects` manages one clip's stack: `move_up`, `move_down`, `reset`,
`remove`, `clear`, `enable`, `disable`. Supply `effect_id` for individual
effects; enable/disable without it targets the whole stack. `describe_project`
retains the existing effect-type list and adds `effectStack` entries with
`id`, `type`, `enabled`. Reset/remove/clear clean only the affected effect
keys. Stack edits reject locked tracks; `add_effect` now fills catalog
defaults before applying parameter overrides.

`copy_effects` takes `source_clip_id` and target `clip_ids`, appending an
independent copy of the effect stack and its keyframes in one undoable
command. Existing target settings are preserved. Every target must be a
visual/adjustment clip on an unlocked track; invalid targets reject the
command before any change. The UI's multi-selection filters ineligible clips
and shows the receiving count before calling the same pure paste operation.

Compound clips ([[ADR-037 Compound clips are nested timelines composited to a texture]]):
`create_compound_clip` takes `clip_ids` (any tracks, at least one on a video
track) and an optional `name`; `break_compound_clip` takes the compound
clip's `clip_id` (at speed 1). `describe_project` lists nested timelines
under `compounds` (`id`, `name`, `duration`, `tracks` in the same shape as
the project's, times their own), and a compound clip names its `compound`.
`edit_compound` runs any other command inside one: `compound_id`,
`command`, `args`, with the nested timeline's ids and times;
`rename_compound` takes `compound_id` and `name`. A compound is one
shared timeline, so `duplicate_clips` of a compound clip plays the same
one, unless `unique: true`: then the copy gets its own timeline under
fresh ids (answered under `added_compounds`). That makes a styled precomp
a template, as the launch film's floating windows wanted: build one window
(footage, mask, border, shadow) and `create_compound_clip` it, then for
each use `duplicate_clips` it with `unique: true` and `edit_compound`
`replace_clip` its footage, keyframing each copy's own slide. Agents always see and
edit the whole project, even while the user has a compound clip open
(`describe_project` then adds `open_compounds`, outermost first).

`window.openFrame` (`src/automation.ts`; `window.videoEditor` is the same
object under its pre-rename name) is the same surface for scripts
in the web build or over the WebView2 debug port: `exec(name, args)`,
`describe()`, `import(...)`, `render(options)`, `still(frame)`, `pixels()`,
`mcp(message)`, and the AI tools (`ai.removeSilences`, ...,
`ai.removeBackground`). See
[[Driving the app]].

`memory()` is a developer readout of known retained bytes by kind, counts
and byte budgets. Model and GPU numbers are estimates; browser/driver
allocations and decoder queues need process measurements too. It does not
force garbage collection. `render()` and `still()` return temporary Blob
URLs: fetch the bytes, then call `releaseUrl(url)` in `finally`. Abandoned
URLs expire after 60 seconds, are evicted within 128 MiB, and are revoked
when the project closes. In-memory exports stop at 128 MiB; larger deliveries
use the streaming file export. MCP previews return bytes directly and
release retained image/audio payloads after delivery; MCP exports return
file paths. `memory-long-media` records known resources and a warmed
before/after JS heap, with a 64 MiB heap allowance and 8 MiB retained limit
after returning Home ([[ADR-144 Session resources have byte budgets and explicit owners]]).

`onFrame(callback)` reports the timeline frame after a viewer draw and
returns an unsubscribe function. `playbackStats()` reports dropped frames,
measured decode throughput and recent preroll timings. The `longgop-cut`
headless drive measures gaps and transition coverage using these hooks.

Analysis regression drives: `music-structure` reads the private track and
cue sheet from `scratch/`, checking every section and drop within one bar.
`music-trimmed` generates a score shaped like it and checks that trimmed
and moved clips keep the file's bar phase and drops, and that hints apply.
`voice-balance` voices three lines over the music fixture, one turned
down, and checks the three windows, the speech target, every line held
to `min_line_lu`, summaries unless `per_second`, and the range for a film.
`voice-pace` checks that narration lines land on 2.3-2.8 words a second,
an ad's on 2.6-3.1, a given speed is kept, a retake lands a pace, and
emphasis stars are dropped from voice and caption with a note. Speech synthesis still requires
its initial model download. MCP tool reference pages are regenerated from
the tool schemas.

The `mcp-io-surface` drive checks the edge of the surface as an agent meets
it in the web build: the short instructions and `help`'s guide, imports by
a label without an extension, by URLs without one (a video, an animated
GIF), a `.cube` and a text file, a renamed GIF still moving after a reload,
`folder` refused in the browser, the "did you mean" hints, 8 columns, a
title's type and a curve's points in answers, and an edit beside three
compound clips answering 164 bytes. The desktop half of `folder` (Rust's
`agent_folder` and `free_name`) is covered by `cargo test`.
