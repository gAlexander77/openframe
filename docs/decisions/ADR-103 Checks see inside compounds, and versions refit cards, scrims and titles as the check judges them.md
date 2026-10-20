# ADR-103: Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them

**Date:** 2026-10-20. **Status:** accepted.

## Context

A fresh Claude Code session made a 38-second ad through the MCP tools
(the Northbound test, 2026-10-20), with 9:16, 1:1 and 4:5 versions, and
listed what held it back. The parts this ADR answers, all reproduced on
the web build's MCP server with the tester's own layouts rebuilt from
its call log:

- **check_project could not see inside compound clips** (3.2). The end
  card, built as a compound (a wordmark, a Georgia-italic tagline, a CTA
  pill, a url and a radial glow) as the brief asked, drew "no_end_card",
  `fonts` listed only Inter, and none of the card's titles had its
  contrast measured.
- **export_versions broke the compound card on tall frames** (3.3).
  [[ADR-101 A song's markers follow its clip, its grid can be given, and designed layouts refit as designed]]
  refits a card as one picture, then raised each of its titles to the
  frame's readable size on its own. On 9:16 the card's offsets were
  scaled 0.32 times while the tagline, pill and url grew to the floor
  (64 became 34.97), so the pill sat on the tagline.
- **Adapted titles failed the check's own safe-area rule** (3.4). The
  adapter wrapped a centered title to the 9:16 column exactly (x
  -0.31..0.31, the check's edge at 0.31); the outline the check then
  suggested for contrast pushed GO FURTHER and NORTHBOUND to 0.313,
  "under the apps' buttons". The adapter measured a title by its raster
  less its margin, with 3% to spare; the check by its letters with their
  box and outline.
- **text_behind_subject put the subject's copy above the grade** (3.5).
  The copy goes on a track above the titles, so above the grade's
  adjustment layer kept under the titles: the rocket played ungraded over
  its graded self, and the answer did not say. On 9:16 and 4:5 the rocket
  then covered the middle of LEAVE THE GROUND ("LEA E / T E / GRO ND")
  and the check sheet only called the rocket too wide.
- **Full-frame shapes did not stretch** (3.6). The gradient scrim behind
  GO FURTHER (1.02 of the width, the top half) kept its pixels against the
  short side like a box and was fitted into the safe area: hard edges on
  9:16 and 4:5, short of the top.
- **export_versions did not answer the loudness it reached** (3.22),
  where export_video does.

## Decision

### Every text rule sees the titles inside compound clips

- `seenTexts` lists every title the viewer sees: on the project's
  timeline, and inside enabled compound clips on visible tracks, nested
  ones too, at their times on the project's timeline (each compound
  clip's in point and speed applied). Each appearance has a key
  (`c_card/c_head`); a compound played twice is two appearances.
- `seenLetters` measures one at a project frame: its letters' box (with
  its box and outline, as before) on its own timeline, then through each
  compound clip's layer (its place, scale, turn and flips), with the
  opacity and the scale it is drawn at.
- Safe areas, the apps' zones, the size floor (at the drawn scale),
  reading time, captions, fonts, the end card and contrast all use them.
  Contrast is measured with every title off inside compounds too
  (`withoutTitles`). A finding about a compound's title names the title
  and `compound_clip_id`, and its fix names the compound clip to move or
  scale, or `edit_compound` for the title itself.

### A card grows as one picture, and is restacked when it must be

- Inside a picture compound no title is raised on its own any more
  (`keepReadable` leaves them to `readableCards`). A card whose smallest
  type the version drew under the frame's floor grows about its center,
  as a whole, until that type meets it (`readableNeed`, the same rule as
  a lone title: the floor when the master's type met the master's).
- Grown, the card is fitted to its room (the safe area, even about the
  center line for a centered card, above burned captions) by `fitCard`.
  When it fits, it only moves inside. When it does not (a 16:9 wordmark
  tracked +34 is 70% of a 9:16 frame's width at that size), its layout
  shrinks to the room as the whole card would, and its parts are
  restacked so nothing overlaps:
  - type that would fall under the floor is held there and wraps within
    the card's width; a word too wide for the room shrinks to it;
  - parts side by side (a row: shown together, their heights overlapping
    by 30%) that are still too wide stack, left to right becoming top to
    bottom;
  - the rows are laid out again in their order with their gaps, shrunk
    with the layout, the stack where the card's titles sat up and down the
    master's safe area (`titlesPlace`: by the titles, not by the card's
    box, which a glow made so tall that the card went to the top);
  - a panel behind the titles (a part a title's middle lies on) keeps its
    margins around them; a soft one (a glow: feathered, fading to
    transparent, or screen-blended) is fitted to the new stack as it was
    to the old, and need not stay in the room.
- Never type grown inside a layout that shrank around it. The tester's
  9:16 card by hand (wordmark 42, tagline 38, pill 34, url 32, gaps about
  28 px) is what the restack now makes on its own.

### One zone for titles, with room for the outline the check suggests

- `titleZone` (align.ts) is the area check_project judges titles by and
  versions place them in: the 90% title-safe area, and on any frame
  taller than wide the apps' column (`VERTICAL_SAFE`). versions' `safeOf`
  is it; the check's two rules read the same constants.
- After everything else (before the overrides, which stay the last
  word), `settleTitles` measures every title as the check does
  (`seenLetters`), a card's through its compound clip, with room on every
  side for the outline check_project would suggest (contrastFixes: 5% of
  the type size, less what the title already draws around its letters).
  What reaches out of the zone moves inside: a group, a card, a title. A
  lone title centered on the frame shrinks a few percent instead, to
  stay centered, never under the readable size.

### The subject's copy takes the grade it sits above, and says so

- `putBehindSubject` still puts the copy on a new track right above the
  titles' (topmost) track. An adjustment layer between the copy and its
  clip, covering its time (a grade kept under the titles, as the
  playbook asks), grades the clip and not the copy, so the copy takes
  that grade as its own (`withGradeOf`): the layer's Basic sliders added
  to the clip's, mixed by its opacity; its look (or, when the clip has
  another look, that look's slider moves); its LUT, curves, wheels and
  HSL where the clip has none; its effects after the clip's. One pass on
  the clip for two on the frame is close, not exact; a vignette or grain
  is drawn on the clip's own picture. On the Northbound hook the copy's
  rocket now differs from the graded original under it by 0.29 levels on
  average (of 255); ungraded it was 3.72.
- The answer says where the copy went (`placed`: its track and the track
  it is above), what it took (`graded`: each layer and what was copied,
  and what was not), and a `note` in words, with the reminder that a
  grade changed later goes on the copy too.

### A title its subject hides is measured, and shown in front in a version

- `behindPairs` finds a title with a subject's copy above it (a video
  with its matte on, or a cut-out picture named Subject) at the title's
  moments. `measureBehind` renders the title alone and the copy alone,
  each over black and over white (the project's background), 320 pixels
  wide; their alphas give the share of the letters the subject covers
  (`hiddenShare`), the worst moment kept.
- At 25% or more the words no longer read (`HIDDEN_LIMIT`): the master's
  hook was 18% under the rocket at its worst and read; 9:16 (41%) and 4:5
  (36%) did not.
- check_project names it (`title_hidden_by_subject`, a warning). A
  version shows that title in front instead (`titlesInFront`: the copy
  off in that version, the effect given up where the words would not
  read, as the tester did by hand), unless its overrides place the title
  or the copy; the check sheet outlines the title ("title in front", or
  "title 41% hidden" when left as it is), and the sheet, each export and
  each saved project list it in `titles` with the master's share and what
  was done or what to do.

### A shape that spans the frame keeps its share of it

A shape whose edges are at or past the frame's on one axis where it
rests (a scrim, a band, a dimmer) is part of the frame, like footage: it
keeps its box as fractions of the new frame (its stroke its pixels) and
is not placed in the safe area as an overlay (`spansFrame`). The scrim
covers the top half of every version, edge to edge.

### Every version answers its loudness

Each file export_versions writes answers `loudness` (integrated LUFS,
true peak) and `info` when a loudness was asked, and its warnings in
`note`, as export_video does (`versionSound`).

## Consequences

- A version's titles sit a few pixels further from the zone's edges, or
  a few percent smaller when centered and as wide as the column; a
  badge in a corner is about 2 px in.
- A card on a tall version is often restacked: its wordmark smaller
  against its tagline than in the master (the frame is narrower than the
  wordmark), its type at the floor. Its panels follow; a glow may grow or
  narrow with the stack.
- `export_versions` renders more when the master has a title behind its
  subject: four small renders per moment for the master and each version.
- A version can turn a subject's copy off; the answer says so and how to
  keep it (an override `{clip_id, hidden: false}` with the title moved).
- ponytail: a card played by several compound clips is restacked once,
  for the one that needs it most; a compound's crop or mask is not
  followed when its titles are judged; the copy's grade is copied where
  the layer rests (its keyframes are named, not followed).
- Tests: `src/lib/designCheck.compound.test.ts` (titles in compounds),
  `src/lib/versions.northbound.test.ts` (the card, the scrim and room for
  the outline on 9:16, 1:1 and 4:5), `src/lib/behind.test.ts` (pairs,
  coverage, the note, in front), `src/lib/ads.test.ts` (the copy's grade
  and place), `src/lib/versions.test.ts` (`versionSound`).
- `scripts/drive/export-versions.js` checks each file's loudness; the
  scenario was run again through MCP on the launch footage: the 9:16 and
  4:5 cards restacked and readable, the scrim edge to edge, the hook
  title in front where the rocket would hide it, check_project finding
  nothing in the layout of any version before or after the suggested
  outlines.
