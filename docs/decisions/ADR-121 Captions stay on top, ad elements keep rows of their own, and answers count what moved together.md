# ADR-121: Captions stay on top, ad elements keep rows of their own, and answers count what moved together

**Date:** 2026-10-21. **Status:** accepted; the versions check sheet labels under each frame too since [[ADR-122 Versions crop around what the editor framed, and callouts stay on what they point at]]. Builds on
[[ADR-116 New titles land on top, masks say where they end, wider versions keep the master's framing]]
(where overlays land), [[ADR-115 A voiceover captions itself a few words at a time, and answers give what they share once]]
(word captions, answer sizes), [[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]]
and [[ADR-114 A duck opens where it is asked and keeps the hand's keys, long words set the pace, a filtered voice keeps its loudness]].

## Context

A third fresh Claude Code session made a 70 s product explainer from
screen recordings through the MCP tools (Claude film test 3, 2026-10-20)
and reported 16 problems. These ten were about elements, layering,
captions and the size and truth of answers; each was reproduced from the
call log, in unit tests and through the web build's MCP server with the
tester's own arguments:

- **5. `add_ad_element lower_third` ignored `logo: "icon"`.** The schema
  took `logo` for every element, the lower third drew none, and the
  answer said nothing. offer_badge and cta_button ignored it too.
- **6. The lower third sat on the voiceover's captions.** Its default
  bottom-left place (name at y 0.31, role at 0.41) crossed the captions
  at y 0.38; check_project passed it, its contrast being fine.
- **7. `caption_words: 3` made a four-word chunk,** "and it runs on"
  (0.73 s), which check_project then judged alone and flagged. The phrase
  "and it runs on your own computer." split evenly as "and it runs / on
  your / own computer."; the little-word rule moved "your" on, leaving
  "on" alone; up 0.12 s, it joined the chunk before past the limit.
- **8. New tracks stacked above the captions.** `add_track` (the
  tester's Spotlight and Callouts), and every new row an overlay made,
  went to the top, so the spotlights' dim would have darkened the
  captions. The tester moved the Captions track up by hand.
- **9. Ad elements scattered their parts.** Each part landed alone on
  whatever row was free: the end card's card on Titles, its icon on
  Spotlight, its headline on Callouts, its button on a new row; the logo
  reveal over three rows. Moving Spotlight below Titles would have hidden
  the icon under its own card.
- **10. Answers too large.** `retake_voiceover ripple: true` answered
  7,784 and 12,241 characters: every caption after the line with its
  whole style (the moved list mixed captions and voice clips, so nothing
  was shared). `plan_music` and `generate_music` answered every beat (140)
  and bar (34). `describe_project clip_ids` repeated the brand kit with
  each clip read.
- **11. `review_voiceover` on two retakes 16 s apart** answered
  `script_words_per_second: 1.03`: their words over a window holding
  eight other lines' speech.
- **13. A cue sheet's final hit was ducked silently.** generate_music put
  the final hit at 60.234 s and a line started at 60.233 s;
  duck_under_speech dipped the hit 10 dB and said nothing.
- **14. preview_frames' time stamp covered each frame's top left,** where
  the section labels were, so the tester thought them clipped.
- **15. `measure_loudness kind` had nothing for a voice-led mix.** `ad`
  called the explainer's 2.4 LU "flat"; its voice alone measured 3.3 LU.

The lead also asked whether "PTIONS" at the 16:9 file's left edge near
31 s was a bug. Frame by frame (ffmpeg, 30 fps) it is the label's
slide-in: "03 TITLES & CAPTIONS" starts at 31.1 s with `slideRight` over
0.45 s, which starts 0.6 of the width to the left (catalog), so at
31.20-31.27 s only the label's tail ("ONS", "PTIONS") has entered; it
settles by 31.55 s and holds whole until its fade at 33.6 s. Nothing to
fix.

## Decision

### Captions stay the top layer

- `topIndex` (lib/project/ops.ts): a new top video track goes under the
  rows of captions at the top of the stack. `addTrack`'s default for a
  video track uses it, so `add_track`, a clip that needs a fresh
  Overlay row, an overlay drop and the app's Effect, Filter, Color and
  Adjustment layers all land under the captions.
- Placement (`placeStack`, lib/overlays.ts) never takes a row of
  captions as what it lands above: titles, shapes, stickers, templates
  and ad elements go under them, as ADR-116 keeps titles above a grade.
- A captions row moved down by hand keeps its place; new tracks go on
  top then, and `move_track above_track_id` still puts any track over
  the captions. `add_track`'s description says so.

### An ad element is one block on rows of its own

`addAdElement` places its parts together (`placeStack(..., own)`): each
part a row (they overlap in time), the rows together above what shows
then, named after the element, sharing no row with anything else. It may
reuse the rows of an earlier element of the same name (a second lower
third), never an empty track made for something else. Moving any other
track, even to between its rows, keeps its parts in order. The brand
kit's logo is a graphic, not footage (`isFootage`), so an end card's or
lower third's icon row no longer counts as a B-roll row that later
overlays must stack above.

### A lower third draws the logo it is given; others refuse it

`lower_third` with `logo` (any variant, or auto) puts the brand's mark
left of the name and role, as tall as both, popping in with them; without
`logo`, none, as before. `offer_badge` and `cta_button` draw no logo and
refuse the argument (`logo: none` passes). end_card and logo_reveal are
unchanged.

### An element lands clear of the captions showing then

After laying an element out, `addAdElement` measures the captions on
screen during it (`seenLetters`, as check_project does) and, when the
element would cross them, gives up that side of the frame and lays it
out again in the room left (above captions in the lower half, below
captions in the upper). The answer says so. When the room left is under
15% of the frame's height, the element stays and the note says to give a
position or move the captions. On the tester's frame the lower third
lands with its role's box 0.02 of the height above the captions (name at
y 0.18, role 0.28; the tester moved them to 0.12 and 0.22 by hand).

### check_project flags text over text

`text_overlaps_text` (a warning): two titles, or a title and captions, on
screen together whose letters' boxes (with their own box or outline)
cross by more than 4 px at 1080p, judged while both rest (after their in,
before either's out: a title rising past a caption is not read there).
Parts of one group (an ad element, a template), of one compound clip, and
a line's chunks are not judged against each other. A title over captions
is one finding naming every caption it crosses and the shorter move that
clears them inside the title-safe area, its group taken as one: on the
tester's placement, "move it up 0.132 of the frame's height (set_param
transform.y 0.278, and its group's other parts by the same amount)".

### Word captions hold their limit, or say why

`chunkCaptions` (lib/captionWords.ts):

- A little word moves on from a chunk's end only when the word before it
  is not little too ("on your" stays together).
- A chunk that would be up under 0.3 s takes time from a neighbor within
  the limit: joined with it when the two hold no more than the limit,
  else their words shared out again between the two, each within it,
  where every chunk then stays up 0.3 s; a split that ends a chunk on a
  little word counts against it, then the longer shortest chunk wins.
- Only when nothing within the limit stays up long enough (one word at a
  time, two words spoken in 0.12 s) does it join past the limit, and the
  answer names the chunk and its seconds (`overLimitNotes`).

The tester's line now reads "and it runs / on your own / computer." with
timed words; through the product, "and it runs (0.63 s) / on your
(0.33 s) / own computer."

### Answers count what moved together, and leave out what is derivable

- **Moved clips:** an app tool's answer (withMoves) gives clips that a
  ripple carried by one amount, four or more on their track unchanged,
  as `shifted_clips: [{by, clips, from, to, tracks: {id: count}}]`
  (`shiftedTogether`, lib/answerSize.ts); clips that moved otherwise (a
  new length, another track) are listed as before.
- **Music:** `plan_music` and `generate_music` answer the bar and beat
  grid as `counts` and a `grid` line (bar n at start + n x bar: a score's
  grid is even) unless `detail: "full"`; chords, sections, drops, the
  final hit, cut points and fit stay. The app's Generate music card calls
  the app directly and is unchanged.
- **describe_project:** a narrowed answer (clip_ids, track_ids, a
  stretch, clips false) leaves the brand kit out unless `brand: true`;
  the whole timeline keeps it, and `brand: false` drops it there too.

### review_voiceover gives the script's pace only over lines in a row

`scriptPace` (lib/voiceReview.ts): when another voice line speaks
between the first and last line reviewed, `script_words_per_second` is
null and `script_window` says why and what to review instead.

### duck_under_speech names a drop or final hit it ducks

`cueMoments` (lib/analysis/duck.ts) reads each ducked clip's grid (the
cue sheet generate_music keeps with its file, or set_music_grid's): every
drop after another part, and the first beat of a closing outro (the final
hit), placed through the clip; Drop markers count too. One that falls
inside a line, from the dip's attack before it to its last word, and was
not asked for in open_at, gets a note: which moment, the line and its
clip, how far down it plays, and the fix ("move_clip the line to start at
20.87 s or later, then duck again with open_at [20.367]").

### Contact sheets label each frame under it

preview_frames, preview_motion and preview_media draw each frame's time
on an 18 px strip under the picture instead of over its top left.
export_versions' check sheet still stamps its tiles (its own drawing,
left for its next change).

### measure_loudness kind explainer

`explainer` (one voice leading over a ducked bed: a tutorial, a narrated
demo, a product explainer) is judged against 1.5-6 LU: a single
narrator's range, compressed, with the music held under it. Under 1.5 is
flat (a limited wall), over 6 wide (music swelling past the voice). The
tester's 2.4 LU is typical there and stays flat for an ad.

## Measured

On the web build's MCP server (characters of each answer's text):

| Answer | Before | After |
|---|---:|---:|
| retake_voiceover ripple, the tester's | 7,784 and 12,241 | |
| retake_voiceover ripple, 4 lines, 19 clips after the line | | 992 (one shifted_clips entry) |
| plan_music, the tester's arguments | 3,240 | 2,208 (full: 3,240) |
| describe_project clip_ids, one voice line | 696 (kit included) | 423 |

## Consequences

- New tracks and overlays land under a captions row at the top: a
  graphic meant to cover the captions needs `move_track above_track_id`.
  The app's effect layers no longer blur or tint the captions.
- An ad element makes a row per part (an end card four or five) instead
  of filling free rows; the timeline has more rows, each holding one
  element's part.
- A lower third added while captions show sits higher than before.
- Any app tool that moves four or more clips by one amount (a ripple, a
  magnet closing a gap after add_voiceover) answers them counted in
  shifted_clips, with the stretch and tracks, instead of listed; the
  gap's sentence (ADR-102) is unchanged.
- A narrowed describe_project no longer carries the brand kit;
  generate_music's MCP answer no longer lists bars and beats (the one
  drive that read them asks detail full).
- Tests: `elementLayers.test.ts` (captions on top, the lower third's
  logo and placement, the refusal, the element's own rows under track
  moves, text over text), `captionWords.test.ts` (the tester's line),
  `mcp.test.ts` (shifted_clips), `music/cues.test.ts`,
  `describeFilter.test.ts`, `voiceReview.test.ts`, `analysis/duck.test.ts`,
  `analysis/delivery.test.ts`. Each new test fails without its change.
- Checked through the web build's MCP server with the tester's arguments
  and screen recordings: the voice's captions (no chunk over three
  words), Spotlight and Callouts under the captions, the lower third with
  its icon above them and its note, the finding on the tester's
  placement, the logo reveal and end card on rows of their own, the
  sheet's labels under the frames, describe_project without the kit,
  plan and generate sizes, the duck's note on a final hit under a line,
  the review's pace on two lines apart, a rippled retake's
  shifted_clips, and measure_loudness kind explainer.
- Left open: the versions check sheet's stamp (above); `text_overlaps_text`
  judges each pair at one moment while both rest, so two titles that
  cross only while one moves by keyframes may pass.
