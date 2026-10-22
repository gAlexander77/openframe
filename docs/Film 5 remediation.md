# Film 5 remediation

Date: 2026-10-22. Lane T, branch imp7-film5, port 1444. No commits,
pushes, merges, branch changes, dependencies or Rust changes.
The source report is the worktree's ignored
`openframe-application/scratch/film5-REPORT.md`. All thirteen problems were
read in full. Reproduction used its arguments, dimensions, timestamps and
executing code paths. The original saved film projects were not available
here, and the NASA film was not re-rendered.

## Findings and fixes

| # | Assessment and cause | Change and evidence |
|---|---|---|
| 1 | Real portability limitation. FCPXML wrote titles as gaps/private metadata, omitted levels/fades/volume keys, and wrote chapter flags as ordinary markers. OTIO's empty warnings hid foreign-renderer losses. | `export_timeline` writes native Basic Titles, font/size/color/alignment/placement, track/clip levels, frame-sampled volume keys, linear fades, existing dissolves, range and chapter markers. Source-clock timestamps are tested. Both formats warn about unsupported finishing and advise finished video plus final WAV references. Color/shape generators, grading, picture transforms/crops, advanced title backgrounds/animation, pan, crossfades and custom fade curves remain explicitly reported limitations. No implicit flattening or media collection. `fcpxml.test.ts`, `warnings.test.ts`. |
| 2 | Real heuristic failure. Contrast saliency can favor the Saturn monitor; it cannot identify the speaker. Explicit focus was still judged against the excluded candidate. | Saliency-decided crops receive a low-confidence `options` note with `preview_media`, focus instructions/current candidate, and full-picture alternatives. Explicit focus owns the subject choice and suppresses contradictory saliency-cut diagnostics. Chose truthful diagnostics over an unvalidated skin-color heuristic; detector ranking is unchanged. `reframe.test.ts`, matching A55/A63 coordinates. |
| 3 | Real layout omission. Safe-area fitting did not reserve the framed subject's area. | Tall interview identifiers sample the subject through their visible window and move above/below it where clear space exists. Focus uses a conservative envelope, not claimed face detection. Authored groups, anchors, position keys and overrides keep their placement with overlap diagnostics; lack of room names a repair. `versions.film5.test.ts` uses Epps's title, offsets, size and duration. |
| 4 | Real plan defect. Color fill inherited crop, foreground scale/vertical scale and picture state. | `set_canvas_fill` color creates a stationary full-canvas layer with identity geometry/color adjustments. Exact A72 crop and transformed portrait are covered by `render/plan.test.ts`; the layout drive checks actual corner pixels. Blur also clears inherited vertical scale/motion. |
| 5 | Real checker inconsistency. Any nonzero fade exempted a clip; preview still judged fades under 50 ms for an audible tail. | `check_project` uses the same 50 ms eligibility threshold. The regression checks a warning with 1/30 s and exemption after 0.2 s. The finishing drive compares the actual preview and checker. |
| 6 | Real false success. A zero dip exempted a line over the requested ceiling. | `duck_under_speech.met` follows measured finite per-line margins, including the maximum: 20.1 LU against 15 is false even at zero dip. Missing measurements are not success. A note explains infeasible ceilings at base volume. The 12/10/15 target band is tested in `analysis/balance.test.ts`. |
| 7 | Mixed. Vocabulary errors belong to the recognizer; overlapping timestamps and duplicated window-boundary words are app defects. | Normalize before transcripts/captions: sort, merge overlapping repeated words, make remaining words monotonic/non-overlapping. Sequential intentional repetitions remain. Test reproduces planet 27.5–28 / 27.77–28.55. `auto_captions` already offered small.en; help/guide now point to it for difficult words. Editorial spelling review remains necessary. |
| 8 | Real grouping/layout defects. Greedy character cuts left orphan 0.7 s cues; portrait adaptation wrapped captions into three/four lines. | Whole-line generation chooses readable phrase groups together, up to two lines, with reading-time rules shared with the checker. Punctuation is preferred, weak endings/orphans penalized, pauses can hold cues, and no words are dropped. Remaining reading-time failures are reported. Portrait overflow regroups at word times, estimated within the cue when absent. Explicit short word chunks retain their behavior. Exact frames decide success before timestamps are rounded. `captions.test.ts`, `versions.film5.test.ts`, `state/transcript.test.ts`. |
| 9 | Real terminology/diagnosis defect. Generic edges called all material music and treated dialogue decay as a music ring-out. | Pass track roles to edge analysis. Voice joins name speech onsets/pauses, effects/ambience name their material, and dialogue is excluded from music ring-out diagnosis. `analysis/edges.test.ts`; finishing drive checks a voice-only response. |
| 10 | Real silent truncation. Both check arrays were sliced to eight. | Schema and execution reject more than eight with instructions to split the check. Regression recreates nine moments, including an ending, and nine fractional moments. `mcp.test.ts`. |
| 11 | Documented fit behavior, not incorrect scaling; a real cutaway workflow gap. 1920×1012 inside 1920×1080 leaves transparent bands. | Keep whole-source fit as the general default. `add_media_clip fit: "fill"` covers the frame; `fit: "blur"` covers behind a fitted source. Default fit reports exposed bands. Existing clips can use `frame_region mode: "fill"`. Exact A35 dimensions/start/duration/in-point are tested; fill computes 1080/1012 scale. No new persisted field. |
| 12 | Real API/verification omission, not evidence original chapter encoding failed. | Chapter-enabled results return actual titles/seconds written, including title truncation. `preview_media file` independently range-reads Nero MP4/MOV chapters. It names unsupported QuickTime chapter tracks/other containers and reports read failures. Tests cover reported starts, UTF-8 limits, skipped media payloads, malformed data and bounded reads; finishing drive checks actual muxer/readback. |
| 13 | Not an app defect. The session/model could not consume returned audio. | Preserve audio plus numerical measurements; improve terminology under item 9. No encoder/playback change or subjective listening claim. |

Native elements follow Apple's [published FCPXML DTD](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/LegacyDTDsFinalCutPro/FCPXMLDTDv1.7/FCPXMLDTDv1.7.html);
the existing writer remains version 1.10. Receiving-editor interpretation,
fonts/template availability and subjective sound were not validated. This
does not claim a visually identical Final Cut/Resolve import. OpenFrame's
importer still has its existing limited finishing subset; portable output
does not imply a full finishing round trip.

## Validation

- `npx tsc --noEmit`: exit 0, no output.
- `npx vitest run --configLoader native --pool threads --maxWorkers 2`:
  **Test Files 207 passed (207); Tests 1838 passed (1838)**, exit 0.
- MCP documentation regeneration: 11 tests passed. MCP tools changed;
  Agent playbook regenerated with no content difference.
- `git diff --check`: exit 0.
- Rust gates: not run, no Rust changes.
- New drives: `node --check` on module.exports-wrapped copies of all three,
  exit 0 with no output.
- No browser/dev server launched; no server needs stopping.

### Proof the tests bite

The original implementation failed four initial regressions: cropped fill,
short-fade cutoff, overlapping words and nine check times. The finishing
group failed four more: native titles/audio, framing confidence, stem
wording and readable captions. Portrait tests initially failed both title
clearance and two-line captions. Ducking failed the old zero-dip exemption;
chapter readback failed without a reader; cutaway fitting failed without its
diagnostics. The final full suite passes.

Additional controlled mutations restored greedy grouping, suppressed
interchange warnings, and used rounded timestamps for reading checks. Each
exited 1 and failed the matching regression. Source bytes were restored in
finally blocks. Logs remain in ignored `openframe-application/scratch/film5-*.log`.

### Drives for the lead

All entries below are **NOT RUN** here, as instructed: this sandbox cannot
launch the browser (spawn EPERM). Use this worktree's Vite on **1444** and
`--base http://localhost:1444`. Do not edit source while a drive runs.

- New: `film5-layout.js` — actual canvas pixels, cutaway fitting, portrait
  identifiers/captions, confidence and excess check moments.
- New: `film5-captions.js` — real Whisper, normalization, grouping/checker.
- New: `film5-finishing.js` — actual mixer cutoff checks, stem prose,
  infeasible duck ceiling, native interchange elements and muxed chapters.
- Existing: `interchange.js`, `export-versions.js`, `versions-stack.js`,
  `auto-captions.js`, `caption-looks.js`, `duck-open.js`, `range-markers.js`,
  `export.js`, `check-measured.js`, `canvas-tools.js`, `mcp-io-surface.js`,
  `mcp-guide.js`.

### Layout drive hang follow-up (2026-10-22)

The lead reported `film5-captions`, `film5-finishing` and the twelve existing
drives passing in headless Edge, while `film5-layout` hung with an uncaught
`Cannot read properties of undefined (reading 'toLocaleLowerCase')`.

The failing input was the layout drive's first import:
`ve.import([{ src: location.origin + "/fixtures/media/color-bars.png" }])`.
Unlike MCP import, automation import passed an absent display name through.
The web copy then restored that undefined name over its storage-key name.
`LibraryPanel` rendered the new asset through `filterMedia`, which called
`asset.name.toLocaleLowerCase()` and threw. The resulting viewer teardown
can leave `ve.rendered()` waiting for a frame with no compositor attached;
`player.idle()` polls pending work without a deadline. The drive also had
neither a deadline nor rejection on page errors.

`mediaName` now resolves a missing/blank/non-string label from the original
source (or "Media" when there is no basename). Automation import accepts an
optional name, and the shared import boundary resolves it before copying.
Library filtering and name sorting use the same fallback for old unnamed
assets without mutating them. Explicit labels survive URL copying.
The drive retains its nameless import as a regression, races all awaited
work against 60 seconds and page errors, throws failures with the page's
stack, and removes its listener/timer on completion.

The whole-src audit was
`rg -n 'toLocaleLowerCase|toLowerCase' src` (87 matching lines; saved in
ignored `scratch/film5-layout-lowercase-audit.log`). The reached sites were
checked as follows:

- Library query comes from `DEFAULT_MEDIA_BROWSER`; asset names were the
  missing-value conversion and are now resolved for filtering and sorting.
- Caption case conversion and the new caption grouping code consume text
  supplied by validated commands or generated word strings. The portrait
  drive supplies both title/caption text and default-completed text styles.
- Command/inspector labels come from fixed catalogs, validated parameter
  paths or required component props. Shape/color conversions receive command
  defaults or validated color strings. Image extension conversion receives
  `formatName`'s source-derived string, independently of the display label.
- Project folder conversions follow string guards/normalized folder lists;
  no optional folder is lowercased without those guards. Preset/style name
  comparisons run on saving a preset/style, outside this drive's path.
- Portrait framing, title clearance, design checks and canvas planning do
  not lowercase optional clip names, track names/roles, fonts or kinds;
  these use equality, guarded lookups, interpolation or array joins.
  No additional absent-metadata lowercase receiver was found on this path.

Regression evidence: before the fix, the import test produced an asset with
`name: undefined`, and the library test threw the exact reported exception
at `mediaLibrary.ts:48`. Both pass after the fix. The import test continues
the drive's exact canvas/crop/scale/fill commands through the render plan;
the portrait test builds its exact 1920x1012 launch, fill, identifier,
captions, saliency map and explicit focus together. Drive tests prove that
an unsettled `evaluate` rejects immediately on a page error, times out
without an error, and cleans up on success.

Follow-up gates: `npx tsc --noEmit` passed; the requested
`npx vitest run --configLoader native --pool threads --maxWorkers 2` passed
**209 files / 1846 tests**. Headless Edge rerun remains unverified here:
launch returned `spawn EPERM`, and the Playwright connector was unavailable
under the current approval policy. The temporary worktree Vite on 1437 was
stopped; the main checkout's existing server was left alone. No commit.

## Decisions and remaining verification

ADR-139 records conservative framing diagnostics rather than skin detection;
fit remains the default with explicit cutaway fill; unsupported finishing
gets warnings/reference-render advice rather than implicit flattening.
Imported cues without word stamps use estimated positions; focus uses a
conservative envelope. Both have ponytail comments and upgrade paths.
Preview and spelling review remain necessary. No dependencies, keyboard
actions or persisted fields were added. Browser drives, foreign-editor
import and desktop verification remain for the lead. No app fix is pending
for item 13.

## Changed files

- `docs/Features.md`
- `docs/Film 5 remediation.md`
- `docs/Index.md`
- `docs/MCP tools.md`
- `docs/User guide.md`
- `docs/decisions/ADR-139 Film finishing reports measured limits and preserves portable elements.md`
- `openframe-application/scripts/drive/film5-captions.js`
- `openframe-application/scripts/drive/film5-finishing.js`
- `openframe-application/scripts/drive/film5-layout.js`
- `openframe-application/scripts/drive/film5-layout.test.js`
- `openframe-application/src/automation.ts`
- `openframe-application/src/engine/export.ts`
- `openframe-application/src/engine/transcribe.ts`
- `openframe-application/src/lib/analysis/balance.test.ts`
- `openframe-application/src/lib/analysis/balance.ts`
- `openframe-application/src/lib/analysis/edges.test.ts`
- `openframe-application/src/lib/analysis/edges.ts`
- `openframe-application/src/lib/captions.test.ts`
- `openframe-application/src/lib/captions.ts`
- `openframe-application/src/lib/chapters.test.ts`
- `openframe-application/src/lib/chapters.ts`
- `openframe-application/src/lib/commands.test.ts`
- `openframe-application/src/lib/commands.ts`
- `openframe-application/src/lib/designCheck.test.ts`
- `openframe-application/src/lib/designCheck.ts`
- `openframe-application/src/lib/interchange/fcpxml.test.ts`
- `openframe-application/src/lib/interchange/fcpxml.ts`
- `openframe-application/src/lib/interchange/warnings.test.ts`
- `openframe-application/src/lib/interchange/warnings.ts`
- `openframe-application/src/lib/mcp.test.ts`
- `openframe-application/src/lib/mcp.ts`
- `openframe-application/src/lib/mediaKind.test.ts`
- `openframe-application/src/lib/mediaKind.ts`
- `openframe-application/src/lib/mediaLibrary.test.ts`
- `openframe-application/src/lib/mediaLibrary.ts`
- `openframe-application/src/lib/reframe.test.ts`
- `openframe-application/src/lib/reframe.ts`
- `openframe-application/src/lib/render/plan.test.ts`
- `openframe-application/src/lib/render/plan.ts`
- `openframe-application/src/lib/transcript.test.ts`
- `openframe-application/src/lib/transcript.ts`
- `openframe-application/src/lib/versions.film5.test.ts`
- `openframe-application/src/lib/versions.ts`
- `openframe-application/src/state/ai.ts`
- `openframe-application/src/state/audition.ts`
- `openframe-application/src/state/captions.ts`
- `openframe-application/src/state/interchange.ts`
- `openframe-application/src/state/media.test.ts`
- `openframe-application/src/state/media.ts`
- `openframe-application/src/state/transcript.test.ts`
