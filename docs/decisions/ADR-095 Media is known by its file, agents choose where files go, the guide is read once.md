# ADR-095: Media is known by its file, agents choose where files go, the guide is read once

**Date:** 2026-10-19. **Status:** accepted; an agent replaces a file of its export's name in the folder it names when it asks (replace) since [[ADR-125 Elements keep their rows and their room, joins into silence move, callouts click on each part and stay in frame, exports replace when asked]]. Revises the destination rule of
[[ADR-052 Agents read what changed and export without a dialog]].

## Context

Codex made a 72-second documentary through the MCP tools alone and reported
every limit it met (History, 2026-10-19). Six were about the surface between
an agent and the files, not about the film:

- **A display name broke an import.** `import_media` with `{src:
  ".../launch.mp4", name: "launch"}` answered `[]`, no error. The import
  gate and the prober read the format from the display name's extension.
- **No say over where files go.** `export_video` and `export_versions`
  always wrote into `<Videos>/OpenFrame/`, and `collect_project` only opened
  a folder dialog, which an agent cannot answer. Codex had to export there
  and move the files into its task's folder by hand.
- **Tool discovery cost 188,924 tokens.** Codex's client prepends the
  server's instructions to every tool's description. Our instructions were
  the whole 3.5 KB guide, so 156 tools carried 156 copies (measured in the
  client's own log: each entry was the guide, the tool's description and
  its declaration). The server sent the guide once; the client multiplied it.
- **Clip summaries hid what was set:** a title's font, maximum width,
  tracking and line height, and a speed curve's points (only "custom").
- **Mistakes cost a round trip each:** `seek({time: 11})` was refused
  listing the known arguments but not which one was meant, and
  `preview_frames` took at most 6 columns where `preview_motion` took 8.
- Two older limits from the launch film (LIMITS #9 and #14) were to be
  checked: edits beside compound clips echoing their nested timelines, and
  opening a project answering the whole timeline.

## Decision

### Media is known by its file

What a file is comes from the file, never from the name it shows in the
library (`src/lib/mediaKind.ts`, tested):

1. The source's own name: the last part of a path, a URL without its query,
   or the web build's storage key (which keeps the original file name).
2. When that has no media extension, the file's first 512 bytes
   (`platform.head`): PNG, JPEG, GIF, WebP, BMP, ICO, AVIF and SVG; MP4,
   MOV and M4A by their `ftyp` brand; WebM and Matroska by the EBML
   DocType; WAV, AVI, AIFF, FLAC, Ogg (Theora as video), WMV, MPEG-TS, MP3
   and AAC. The format becomes an extension (`upload.mp4`) that the prober
   and the FFmpeg proxy already understand.
3. Neither: the file is refused as not media, with that reason.

Animated pictures and SVGs decode by the same rule, so a GIF renamed in the
library keeps playing (it used to stop: the decoder read the display name).
A `.cube` is told by its source name too, and `import_media` imports it as
a project LUT. `import_media` answers one entry per file, in the order
given: the asset, `{lut_id, name, kind: "lut"}`, or `{src, name, error}`;
when every file failed the call is an error that names each reason. An
answer of `[]` no longer exists. Positions match the request, so
`const [a, b] = answer` keeps working.

### Agents choose where files go

`export_video`, `export_versions` and `collect_project` take `folder`: an
absolute path, created if missing. ADR-052 let the page name only the file,
"so an agent cannot write over anything or anywhere else". The second half
was more than the safety needed. An agent that holds the token already reads
any file it names (`import_media`, `open_project_file`), so naming where its
own output goes adds no reach; what must hold is the first half: **an agent
never replaces a file.** Rust (`export_begin_auto`, `project_collect`)
checks the folder is absolute and not a file, then writes as before: an
export takes the first free name (`Trip.mp4`, `Trip (2).mp4`, a name whose
`.part` is still being written counting as taken), and a collection makes a
new folder inside named after the project (`Trip`, `Trip (2)`; it was
`OpenFrame-<time>` until the desktop check found an agent reading a
nineteen-digit number back). When the export took a numbered name,
the answer's `note` says so ("Trip.mp4 was already there, so this file is
Trip (2).mp4; nothing was replaced."; `lib/export.ts renamedNote`). Without
`folder` nothing changes. The person's own exports keep the save dialog.

The browser build cannot write into a folder of anyone's choosing, so a
`folder` there is refused with that reason rather than ignored, as
`collect_project` already was.

### The guide is read once

The server's instructions are now four sentences (524 characters): who the
user is, "call help first", and the coordinate conventions every tool
shares. The guide (the steps that make a video, tool by tool) is `help`'s
overview and the `guide://overview` resource, read when asked for. A test
keeps the instructions under 700 characters and out of every tool's
description.

`tools/list` lost what restated a default: annotation hints equal to the
spec's defaults (`readOnlyHint: false`; `destructiveHint` on read-only
tools; `openWorldHint: true`) and empty `required` lists. The schemas and
descriptions are the contract, and stay.

Measured with `handleMcp` (bytes of the JSON answer):

| | Before | After |
|---|---:|---:|
| `initialize` | 3,760 | 794 |
| `tools/list` (156 tools) | 193,013 | 190,654 |
| instructions copied per tool by Codex | 3,473 | 524 |

`tools/list` shrank by 2.4 KB net, after `folder` and the fuller
`import_media` text were added. Codex's discovery, re-estimated at the same
characters per token as its log (156 entries of instructions, description
and declaration): about 63,000 tokens instead of 188,924.

### Answers say what is set

- `describe_project` (and so every edit's answer) gives a title a `style`
  with the typography that departs from the default look, named as
  `add_text`'s style takes it: `font`, `maxWidth`, `letterSpacing`,
  `lineHeight`, `align`, `italic`, `underline`, `stroke2`, `gradient`,
  `glow`, `accent`, `highlight`. `weight` shows whenever it is not 700
  (a title with `bold: false` reads 400). A speed curve keeps its name
  (`speed_curve`: a preset or `custom`) and adds `speed_points`, `[t,
  speed]` with `t` from 0 to 1 over the clip, as `set_speed_curve` takes
  them.
- `open_project_file` answers a summary, as `open_project` does.
- Compound clips: verified that an edit beside three compound clips
  answers under 600 bytes with no compound in it, and an edit inside one
  answers that compound summed up (the launch film's fix holds). LIMITS #9
  and #14 are closed.

### Mistakes are named with their fix

Validation names the argument a model most likely meant
(`src/lib/didYouMean.ts`, tested): the same name spelled another way
(`clipId`, a plural, a missing `_id`), a word these tools spell otherwise
(`time` for `at`, `fontSize` for `size`, `output_dir` for `folder`), or a
near spelling. `seek({time: 11})` answers "args.at is required;
args.time is not a known argument; did you mean at? (known: at)". It is
offered only among the arguments not already given, and never guessed when
nothing is close. An unknown tool or batch command gets the same hint.
`preview_frames`, `preview_media` and `preview_motion` share one limit of 8
columns.

## Consequences

An agent can name media anything, deliver straight into the folder its task
names, and learn from each answer what failed and why. Clients that copy
the instructions per tool pay about a seventh of what they did; clients
that show them once (Claude Code) show less up front and find the guide
through `help`, which the instructions point to first. `import_media`'s
answer can now hold failure entries beside assets: a caller that indexes
the answer by position should check `error`. Formats are sniffed only when
a source has no extension, so ordinary imports read no extra bytes.
