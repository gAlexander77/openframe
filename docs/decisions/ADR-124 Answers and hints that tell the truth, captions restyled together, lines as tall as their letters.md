# ADR-124: Answers and hints that tell the truth, captions restyled together, lines as tall as their letters

**Date:** 2026-10-21. **Status:** accepted. Builds on
[[ADR-115 A voiceover captions itself a few words at a time, and answers give what they share once]]
and [[ADR-121 Captions stay on top, ad elements keep rows of their own, and answers count what moved together]]
(answer sizes), [[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]]
(describe_project's filters), [[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]]
and [[ADR-118 A version's captions take its frame, pictures keep clear of them, and fades and push-ins are judged]]
(the zones titles are judged by), [[ADR-092 A voice's known script decides its words, a second hearing decides who misheard]]
(review_voiceover), and [[ADR-099 Feathers blur the shape, title runs share a baseline, pictures take a border]]
(styled runs), which it amends: each line now takes its own pitch.

## Context

A fourth fresh Claude Code session made a 58.5 s vertical how-to from
screen recordings through the MCP tools (Claude film test 4) and reported
16 problems. These five were about answers, captions and hints that did
not tell the truth. Each was reproduced from the call log and through the
web build's MCP server, rebuilding the tester's timeline (its recordings,
pushes, 41 word captions, four step labels and nine callouts):

- **A. review_voiceover blamed the voice for a number.** The line "Pick
  YouTube ten-eighty p, set loudness to minus fourteen, and hit Export."
  (caption "1080p", "-14") came back to fix: "ten eighty p" heard as
  "1080p", "likely the voice", with `retake_voiceover speed 0.9`. The voice
  was right. The tokenizer spelled out numbers of one to four digits only,
  one way, so "1080p" stayed a word, while "minus 14" passed because 14 is
  spelled "fourteen" either way.
- **C. Answers too large.** In the call log: the first add_callout
  answered 4,648 characters and a batch of 8 callouts 18,012 (each glide
  baked into a key a frame, and every ring and dim repeating the regions
  it was given); two batches restyling the 48 captions and four labels
  answered 16,844 and 15,799 (nothing is common to captions and labels
  together, so every caption came back with its whole style); and
  describe_project of the captions track 9,755, the style repeated on
  every caption.
- **D. No way to move or size every caption at once.** set_caption_look
  took only a look, so the tester sent set_param transform.y and set_text
  style with all 48 ids, four times. check_project's fix said "move the
  captions (set_caption_look y)", which did not exist.
- **E. check_project hints that did not match their finding.** A caption
  reaching into the side rails was told "captions on a tall canvas sit at
  y 0.05". Findings grouped by their fix text alone: "6 alike" mixed the
  hook card (bottom and right), the step labels (top 14%) and the end
  line (bottom 35%), described by the first. A step label over a caption
  was told to move up, into the top 14%.
- **H. Scaled runs.** "YOUR FIRST\nEDIT\nIN OPENFRAME" with "IN OPENFRAME"
  at scale 0.72 drew "IN" and "OPENFRAME" on separate lines spaced as if
  full size; and style_text_range took flat fields while set_text takes a
  style object, so the tester's first batch failed on `style`.

Measured before deciding H: wrapping already measures each run at its own
size. At maxWidth 0.8 the scaled line stays whole (686 px of an 864 px
wrap; at full size it would be 953 px and wrap). The tester's title had
the tall canvas's default maxWidth 0.62, a 670 px wrap, so the 686 px
line wrapped as it should. What was wrong is what the tester saw: every
line took the tallest run's pitch, never less than the size's (ADR-099),
so the two small lines sat a full line apart; and nothing said why the
line broke.

## Decision

### Numbers are compared as said (A)

- `tokens` (lib/voiceReview.ts) reads "-14" as minus fourteen, "1080p" as
  a number and a letter, "3rd" as third, "$20" as twenty dollars, "1,000"
  as one thousand and "3.5" as three point five, and spells numbers up to
  999,999.
- `numberReadings` gives the ways a number in digits is said: counted
  (one thousand eighty), in pairs as years and resolutions are read (ten
  eighty, twenty twenty six, nineteen oh five), with "and" (one thousand
  and eighty), digit by digit (one oh eight oh). `compareScript` reads the
  heard words' numbers as the script says them, and the script's as the
  heard words do.
- It also compares against the line's caption (`SpeechInfo.caption`),
  beside the words as written and as respelled, and keeps whichever
  matches best.
- A difference that is still one number written two ways (`sameNumber`:
  the same value counted or read in groups) is not a difference, so no
  retake, and no slower read, is ever suggested for it. Another number
  ("fourteen" heard "40") stays one.

Through the web build, the tester's line spoken by af_heart: Whisper
heard "Pick YouTube 1080p, set loudness to minus 14, and hit export.";
the review answers ok, match 1, no differences (before: to fix, match
0.77, retake at speed 0.9).

### Answers say what changed, once (C)

- **Baked keys are summed up** (`bakedKeys`, commands.ts): a path with
  four or more keys in a row a frame or two apart (a glide or a pan
  followed key by key) is given as `{count, first, last, range}` as a
  dense path already was, in describe_project and edit answers alike.
  Keys set by hand stay listed.
- **An edit's answer counts a pinned clip's glides** (`leanAnchor`,
  mcp.ts): `anchor.keys` past two become `{count, from, to}`; the regions
  are the ones the call gave, and describe_project lists every key (as
  markers are counted in answers and listed there, ADR-115).
- **What a list shares is given by track when that is shorter**
  (`shareClips`, lib/answerSize.ts): a list spanning tracks gives each
  track's shared part in `*_clips_common_by_track` (each entry keeps its
  track), else the whole list's in `*_clips_common` as before, whichever
  answer is shorter. `wholeClips` merges either back; withMoves uses both.
  Lossless.
- **quiet: true** on batch, or on any command batch takes, answers the
  ids of what was added, changed and removed, with the notes and what the
  edit overwrote (`quietAnswer`); handleMcp takes it off before the
  command runs. batch's schema lists it, and the overview and that
  parameter say every command it takes accepts it: listing it on every
  tool would have added about 15 KB to tools/list. The tools that run on
  this computer (add_voiceover, the AI tools) answer in their own words
  and do not take it.
- **describe_project fields**: each clip's id, type, start and end and
  only the fields named (`fields: ["text"]` for captions as words and
  times), nested timelines too; a name no clip shown has is said in
  `fields_not_found`.

### set_caption_look restyles every caption (D)

`set_caption_look` takes `look` (now optional), `y`, `x`, `size`,
`maxWidth` and `style` (add_text's fields), applied to every caption, the
look first and the rest over it; at least one is needed. The Captions
tab's looks call it as before. The hints that named `set_caption_look y`
are now true, and give the value.

### check_project fixes what each finding found (E)

- **Captions** (`captionZoneFix`): every caption reaching into the same
  zones of a tall frame gets one fix, computed over all of them, since
  set_caption_look moves them together: out at a side, `x -0.04` (the
  middle of the column between the rails) and, when wider than the
  column, the `maxWidth` that fits the widest; out at the bottom or the
  top, the `y` that clears the worst one while each still fits the other
  way; too big for the room, a `size`.
- **Titles** (`titleZoneFix`): the `set_param transform.x` or
  `transform.y` that brings the box inside, or a narrower wrap or a
  smaller size when it is wider or taller than the room; a keyed or
  nested title is told which way to move and where its box must stay.
- The fix names its zones, so alike findings (grouped by rule, level and
  fix) are alike in zone too: the tester's "6 alike" are now three step
  labels in one group, and the hook card, the third label and the end
  line each with their own move.
- **Text over captions** keeps its moves inside `titleZone` (on a tall
  frame clear of the apps' tabs and buttons, not just title-safe), and
  names the captions' move as `set_caption_look y` with its value, when
  that stays inside the zone; with no room either way it says so.

On the rebuilt timeline, the tester's second check: the side-rail
captions' fix went from "captions on a tall canvas sit at y 0.05" to
"set_caption_look x -0.04 maxWidth 0.66 (every caption, between the side
rails (x -0.39..0.31)), or a smaller size"; "4 · EXPORT" over a caption
from "move it up 0.039 (set_param transform.y -0.364), or move the
captions (set_caption_look y)" to "move it down 0.259 (set_param
transform.y -0.066), or move the captions down (set_caption_look y
-0.176)".

### Each line is as tall as its letters (H)

- The rasterizer (engine/text.ts) gives each line its own pitch, its
  tallest letters' (`lineScale`, lib/textRuns.ts: the largest run scale
  on the line, 1 where any letter is in no run, spaces not counted), as
  After Effects' and Photoshop's auto leading does: a line all at 0.72 is
  0.72 of a line high, and a big word's line no longer spaces every other
  line as wide. The box, the gradient across the block and each run's
  gradient box follow the lines' heights.
- style_text_range takes its style flat or as `style: {color, scale...}`
  as set_text does; the flat fields win; a field runs do not take (size)
  is refused by name.
- When the wrap parts a styled stretch, style_text_range's answer says so
  with the lines it is drawn on and the maxWidth it wraps at
  (`wrappedRange`; the rasterizer's layout now carries its `lines`,
  read through `textLines`): "\"IN OPENFRAME\" is drawn on 2 lines (\"IN\"
  / \"OPENFRAME\"): at its size it is wider than the title wraps at
  (style.maxWidth 0.62 of the canvas width); a wider maxWidth, a smaller
  scale or size, or fewer words keeps it on one."

## Measured

On the web build's MCP server, rebuilding the tester's timeline (41
captions where the tester had 48; characters of each answer's text):

| Answer | Tester | Before | After | quiet |
|---|---:|---:|---:|---:|
| add_callout, four glides | 4,648 | 4,438 | 2,054 | 112 |
| batch of 8 add_callout | 18,012 | 15,917 | 8,594 | |
| batch: captions moved and resized, labels moved | 16,844 | 13,300 | 6,186 | 712 |
| batch: captions narrowed, labels resized | 15,799 | 13,149 | 5,985 | |
| describe_project, captions track 12.7-53 s | 9,755 | 8,517 | 2,787 (fields text) | |
| set_caption_look y, size, maxWidth (new) | | | 3,774 | 652 |

check_project's first answer grew from 4,319 to 6,724: the findings
that mixed zones are now apart, each with its own move.

## Consequences

- A model can restyle every caption in one call, read captions as text
  and times, and ask any edit for ids alone.
- An answer spanning tracks may share per track: a reader merges
  `*_clips_common_by_track` by each entry's track (wholeClips does).
- describe_project no longer lists a callout's baked keys one by one,
  only counts them: they are written from its anchor after every edit,
  so no one edits them by hand; the anchor's keys are listed in full.
- Titles with scaled runs on lines of their own draw shorter than
  before, and so does their box; a title whose lines all hold letters at
  full size is unchanged. The canvas editor's textarea keeps one line
  pitch (the tallest), as it already drew runs at the base size.
- Left open: an edit's answer still repeats the `{count, first, last,
  range}` of each baked path of a callout's ring and dim (about 800
  characters a callout); quiet is the short answer.
- Tests: `film4Fixes.test.ts` (per-track sharing and its size, quiet
  through handleMcp, baked keys and anchor counts, fields,
  set_caption_look, the zone fixes and their grouping, a title's move
  kept inside the apps' zone with the captions' move named,
  style_text_range's style object, lineScale, wrappedRange and the note),
  `voiceReview.test.ts` (the tester's line, the caption, readings,
  sameNumber, no slower read). Each fails without its change.
- Drives passed on the web build: caption-looks, karaoke, callouts,
  check-text-box, check-measured, check-panel, inline-text,
  inline-runs-layouts, kinetic-text, title-wrap, text-styles,
  film3-fixes, mcp-guide, mcp-io-surface, one-word-captions,
  voice-review-fixes, mcp-review, voice-trust, voice-caption-words and
  script-captions.
