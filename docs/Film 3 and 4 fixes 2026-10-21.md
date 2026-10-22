# Film 3 and 4 fixes - lane N

Work is uncommitted on imp7-film3. No push, merge, branch switch, release,
installer, server or browser launch. No Rust or dependency changes.
ADR-135 records the decisions. Commands below are run from
`openframe-application/`.

## What changed and how to use it

| Item | Result, cause and use |
| --- | --- |
| Film 3.1 / Film 4.1, audio preview | Real failure. Preview already called the export's `ensureMp3`; the report was not a missing-call defect. LAME now registers before its capability probe, Vite prebundles both encoder extensions and deduplicates Mediabunny's registry. `preview_audio format` accepts `mp3`, `m4a`, `wav`; default MP3 falls back to AAC/M4A, then encoder-free 16-bit 24 kHz mono WAV when setup or actual encoding fails. Audio content carries the actual MIME; text carries actual `format`. The 30 s ceiling and full-resolution measurements remain. The exact desktop registration failure could not be reproduced in this sandbox; registry hardening and fallback need the lead's runtime check. |
| Film 3.2, hook guidance | Real contradiction. Both help topics now give portrait hooks size 70-110, two to four words per line; ordinary portrait titles remain 50-90. `check_project` has a minimum-size rule, no maximum-size rule; a size-100 hook has a regression check. |
| Film 3.3, end-card lines | Real. Column wrapping happened before respecting explicit lines. `add_ad_element end_card` measures the widest explicit line without wrapping and shrinks to fit, stopping at the readable floor. Only a line still too wide at the floor wraps. Existing logo/spacing/room rules remain. The exact headline `Make every trip\nfeel cinematic` is tested with the real rasterizer and deterministic font metrics. |
| Film 3.4, voice times | Real. Answers copied the unsnapped synthesis layout. `add_voiceover` now answers each placed clip's start and end; `seconds` keeps speech length. `retake_voiceover` uses the same reporting. The 4.519 / 4.719 example reports 4.533 / 4.733 at 30 fps. |
| Film 3.5, flat-range advice | Real. Generic advice ignored ducked pauses. Duck records now keep validated optional `held` source-second intervals; `measure_loudness` maps them to the measured window, merges overlapping records, names the held-pause count, and suggests lower `duck_under_speech min_gap` or selected `open_at` moments. With no music, advice says to let quiet passages stay quiet. Older records need ducking again to supply a count. |
| Film 3.6 / Film 4.4, version sampling | Real interface mismatch. `export_versions check_times` takes master seconds, mutually exclusive with fractional `check_at`. Seconds are validated against master duration and mapped through cut-downs: omitted middle moments disappear, retained end-card moments move with the card. If none remain, the opening is shown; the answer says so. |
| Film 4.2, 43 s montage | Real black-tail trap, even though the old help documented grid exhaustion. The exact 37-shot beat pattern reproduced 40-43 s for the last shot against `end:44`. `cut_to_beats` treats an explicit end as an additional final boundary. It does not invent intervening beats; source-length safeguards remain. The regression ends the eight-beat final shot at 44 s with source in 20. |
| Film 4.3, hidden adjustment | Real. Transform validation ran before hidden was applied. Hidden-only `export_versions overrides` now disables/restores an adjustment or sound without placement math. Asking to move an adjustment still errors. The master stays untouched. |
| Film 4.5, generated SFX joins | Real false positive. Join analysis treated complete risers/impacts as edited continuous sound. Complete generated SFX meeting at their file endpoints are timed events: `check_project` and `preview_audio` skip that splice judgment. A sound trimmed inside its file remains checked. The 14-16 s riser / 16 s impact case is covered; the drive also places the 32 s reverse cymbal / braam pair. |
| Film 4.6, texture framing | Real reliability defect: normalized saliency always selected a bright component, even in repeated texture, and called it a subject. A component must now dominate enough salience and be localized; diffuse/repeating maps center the crop and explain this in version `options`. Explicit focus still wins. Repeating-foam maps, the existing tower/boat cases, and an end-to-end pure version test cover this. Original ocean footage was not rendered here; the heuristic is conservative saliency, not semantic recognition. |
| Film 4.7, music markers and final beat | Real, two causes. Marker count was new total minus old total, so replacing a shorter grid could answer -1. Counts now mean new marker positions, excluding removals and replacement IDs. Music analysis also trimmed silent edges after constructing an authoritative supplied grid; it now preserves those beats through the file, including 43.5 s in the 44 s / 120 BPM regression. Generated scores already store their authoritative grid, so reanalysis follows it. |
| Film 4.8, uneven adapted fade | Real adaptation defect, not a renderer drift defect. Versions kept a fade over a newly cropped backdrop without measuring it. When shape changes, version preparation uses the same title/fade measurements as `check_project`, skips unrelated audio checks, and replaces a measured uneven fade with the checker's cut alternative. It names the change in `options`; entrance/exit slots without a finding and the master remain. A cut avoids adding a new move that can leave the safe area. Horizontal drift was not established by the tester, so no drift change was made. |
| Film 4.9, inventory duration | No demonstrated product defect. 8.052 s in descriptive source inventory versus 8.090708333333334 s in imported media is about 39 ms. The inventory is not decoder timing authority; the report establishes no clipped range, incorrect file boundary or reproducible decoder error. No duration coercion or import change was made. |

## Verification

- `npx tsc --noEmit`: exit 0, no output.
- `npx vitest run --configLoader native --pool threads --maxWorkers 2`:
  `Test Files 194 passed (194)`; `Tests 1738 passed (1738)`; exit 0.
- Generated docs: `UPDATE_MCP_DOCS=1` with the same Vitest flags on
  `src/lib/mcpGuide.test.ts`: 1 file, 11 tests passed; environment variable removed.
- `git diff --check`: exit 0, no output.
- Rust gates: not run, no Rust changed.
- `npm run build`: TypeScript completed; Vite config bundling blocked by
  sandbox `spawn EPERM` (externalize-deps / Windows realpath).
- `npx vite build --configLoader native`: transformed 2,329 modules, then
  worker processing blocked by sandbox `spawn EPERM`. Production build
  remains unverified and should be checked by the lead.
- Both new drives passed `node --check` as `module.exports = <drive>` copies
  under this worktree's scratch directory. No browser attempt was made,
  following the lane's explicit sandbox instruction. No dev server was
  started, so there is no process to stop.

## Regression tests bite

Before fixing, the exact two-line end card wrapped to four lines, the last
montage shot ended at 43 s, hidden adjustment overrides threw, master-second
checks were refused, supplied grids lost quiet beats, repeating texture
returned a fabricated subject, and loudness advice lacked the held count.
The corresponding tests failed before each fix (scratch logs retained).

Eight additional temporary mutations each exited 1 in the targeted Vitest
run: prefer WAV over working MP3; report a voice end one frame early; use
net marker delta; ignore the cut-down time mapping; treat complete SFX as
splices; skip measured fade repair; return zero held pauses; retain invalid
held intervals. Every mutation was restored in a finally block. The full
passing suite ran after restoration. Evidence is in
`scratch/film3-test-bites.log` and `scratch/bite-*.log`.

## Drives

Start this worktree's server on port 1440 with
`npx vite --port 1440 --strictPort`, then run each with
`node scripts/drive/run.mjs scripts/drive/<name>.js --base http://localhost:1440`.
The lead ran every drive below in headless Edge on 2026-10-22 against
this lane's web build; all passed (epic-edit and generate-music too).

| Drive | Runtime result | Syntax |
| --- | --- | --- |
| preview-audio-format.js (new) | PASS | PASS |
| film-report-fixes.js (new) | PASS | PASS |
| mcp-io-surface.js | PASS | Existing |
| mcp-guide.js | PASS | Existing |
| voice-review-fixes.js | PASS | Existing |
| voice-trust.js | PASS | Existing |
| export-loudness.js | PASS | Existing |
| duck-open.js | PASS | Existing |
| ad-elements.js | PASS | Existing |
| ad-versions.js | PASS | Existing |
| export-versions.js | PASS | Existing |
| versions-stack.js | PASS | Existing |
| check-measured.js | PASS | Existing |
| check-panel.js | PASS | Existing |

`preview-audio-format` checks all formats through MCP, nonempty audio,
matching MIME/format, WAV headers, measurement-only replies and actual
fallback with native encoding and encoder workers deliberately unavailable.
`film-report-fixes` uses MCP and the browser's rasterizer to check the exact
end-card lines, 37-shot montage, hidden bars, master-second sampling and
mutual exclusion, generated sound-event joins, and placed voiceover times.
Check the original ocean shot visually if the lead has its source media.

## Remaining review choices

The exact failed MP3 registry state and the original ocean crop need runtime
confirmation. Center fallback uses conservative component concentration;
when abstract footage has an intentional off-center region, give focus.
Uneven version fades become cuts, one of the checker's existing fixes, and
this adds title-rendering work to version preparation. Browser/desktop
runtime checks and the production build are the only unfinished validation.
No feature work or local commits are left to perform in this lane.

## Files changed or added

All paths below are relative to the repository root. Scratch scripts and
logs are ignored local evidence, not deliverables.

- `docs/Agent playbook.md`
- `docs/Features.md`
- `docs/Film 3 and 4 fixes 2026-10-21.md`
- `docs/Index.md`
- `docs/MCP tools.md`
- `docs/User guide.md`
- `docs/decisions/ADR-135 Film tools preserve authored timing and degrade previews gracefully.md`
- `openframe-application/scripts/drive/film-report-fixes.js`
- `openframe-application/scripts/drive/preview-audio-format.js`
- `openframe-application/src/automation.ts`
- `openframe-application/src/engine/export.ts`
- `openframe-application/src/lib/ads.lines.test.ts`
- `openframe-application/src/lib/ads.ts`
- `openframe-application/src/lib/analysis/beats.test.ts`
- `openframe-application/src/lib/analysis/beats.ts`
- `openframe-application/src/lib/analysis/delivery.test.ts`
- `openframe-application/src/lib/analysis/delivery.ts`
- `openframe-application/src/lib/analysis/duck.test.ts`
- `openframe-application/src/lib/analysis/duck.ts`
- `openframe-application/src/lib/analysis/subject.test.ts`
- `openframe-application/src/lib/analysis/subject.ts`
- `openframe-application/src/lib/audio.ts`
- `openframe-application/src/lib/commands.ts`
- `openframe-application/src/lib/designCheck.joins.test.ts`
- `openframe-application/src/lib/designCheck.test.ts`
- `openframe-application/src/lib/designCheck.ts`
- `openframe-application/src/lib/epic.test.ts`
- `openframe-application/src/lib/epic.ts`
- `openframe-application/src/lib/markers.test.ts`
- `openframe-application/src/lib/markers.ts`
- `openframe-application/src/lib/mcp.test.ts`
- `openframe-application/src/lib/mcp.ts`
- `openframe-application/src/lib/mcpGuide.ts`
- `openframe-application/src/lib/previewAudio.test.ts`
- `openframe-application/src/lib/previewAudio.ts`
- `openframe-application/src/lib/project/defaults.test.ts`
- `openframe-application/src/lib/project/defaults.ts`
- `openframe-application/src/lib/project/types.ts`
- `openframe-application/src/lib/reframe.test.ts`
- `openframe-application/src/lib/reframe.ts`
- `openframe-application/src/lib/versions.test.ts`
- `openframe-application/src/lib/versions.ts`
- `openframe-application/src/lib/voiceScript.ts`
- `openframe-application/src/lib/voiceover.test.ts`
- `openframe-application/src/state/ai.ts`
- `openframe-application/src/state/audition.ts`
- `openframe-application/src/state/check.ts`
- `openframe-application/src/state/delivery.ts`
- `openframe-application/src/state/export.ts`
- `openframe-application/src/state/tts.ts`
- `openframe-application/vite.config.ts`
