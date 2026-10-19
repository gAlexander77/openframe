# Film 3 fixes verification, 2026-10-19

All app paths below are inside `openframe-application/`. This pass was
headless and checked the web build. No desktop app was opened or tested.

| Fix | Files changed | Evidence | Suggested History note |
| --- | --- | --- | --- |
| 1. Styled runs | `src/lib/textRuns.ts`, `textRuns.test.ts`, command description and generated MCP reference | Equal-length two-edit replacement and unequal-length LCS tests; `film3-fixes`, `inline-runs-layouts` | Keep styled ranges by position for equal-length edits; map surviving characters with a linear-space LCS otherwise. Insertions inside surviving runs inherit their style. |
| 2. Argument shapes and no-op | `src/lib/commands.ts`, `commands.test.ts`, `film3Fixes.test.ts`, `mcpGuide.ts`, `src/automation.ts`, `src/lib/mcp.ts`, `docs/MCP tools.md` | Multi-title styling, single-id compatibility, rejected multi-title text replacement, key removal and continued batch after no match; `film3-fixes`, `mcp-guide` | Accept clip_ids for set_text and remove_keyframes, retain clip_id, and report unmatched key removal as a no-op. |
| 3. Overwrite reporting | `src/lib/commands.ts`, `film3Fixes.test.ts`, `src/automation.ts`, `src/state/stickers.ts`, `src/lib/mcp.ts`, generated MCP reference | Removal and trim tests for text, shapes, solids and media; insert mode has no overwrite report; batch reports clips created and removed within that batch; `film3-fixes` verifies the MCP response | Add overwritten entries with id, kind and removed/trimmed to placement answers, including batch and nested-command reports. Sticker placement uses the same reporting path; its normal automatic placement chooses a free overlay. |
| 4. Retake speed note | `src/state/tts.ts`, `src/lib/voiceSpeed.ts`, `voiceSpeed.test.ts`, `src/lib/mcp.ts`, generated MCP reference | Unit tests for automatic, inherited and explicit speeds; `film3-fixes` runs real retake placement and MCP with synthesis mocked: automatic speed 0.76 and rushed-line note; explicit speed produces no automatic-choice flag | Report speed_chosen and explain a rushed-line speed selection or reuse of the previous take's speed. |
| 5. Pinned ruler overlays | `src/components/Timeline.tsx`, `timeline.css` | `film3-fixes`: after 563 pixels of vertical scroll, marker and cap retain their top at the ruler; `markers`, `timeline-ux`, `style-sweep` | Keep marker flags and the playhead cap pinned with the ruler while tracks scroll. |
| 6. Typed numbers | `src/components/DraftNumber.tsx`, `MusicCard.tsx`, `ExportDialog.tsx`, `src/lib/numberInput.ts`, `numberInput.test.ts` | Typing 120 into Tempo and Length, bounded-number tests; `music-card`, `typed-values`, `style-sweep` | Commit music length, tempo, seed and export custom bit rate on blur or Enter. Preserve drafts while typing and clamp only on commit. Other numeric inputs were audited; sliders/selects and existing draft fields retain their behavior. |
| 7. Timeline refit | `src/components/Timeline.tsx`, `src/lib/timeline.ts`, `timeline.test.ts` | Width/zoom/scroll invariant and zoom-limit tests; `film3-fixes` checks visible span and nonzero horizontal offset after opening the dock; `assistant`, `timeline-ux` | Preserve the timeline's visible frame interval when the dock or window changes its width, within the existing zoom limits. Schedule resize work in an animation frame. |

The shared integration drive is `scripts/drive/film3-fixes.js`.

## Verification and limits

- `npx tsc --noEmit`: passed.
- Full Vitest suite: 137 files, 1128 tests passed.
- Drives passed: `film3-fixes`, `style-sweep`, `inline-runs-layouts`,
  `music-card`, `timeline-ux`, `markers`, `assistant`, `mcp-guide`,
  `typed-values`. Style sweep includes its three viewport sizes.
- `voiceover-directed` with real models was skipped: the isolated browser
  had zero cache stores and no downloaded speech models. The new drive
  mocks synthesis only; retake processing, file creation, placement and
  MCP response handling run normally. Voice quality was not evaluated.
- The MCP reference was regenerated using the mcpGuide test with
  `UPDATE_MCP_DOCS=1` and checked again by the full suite.
- The shared node_modules link prevented Vite's default config bundler
  from writing its temporary file. Verification used an ignored
  `scratch/vite-check.config.ts` importing the normal config and setting
  `cacheDir` to `scratch/vite-cache`, plus `--configLoader runner`.
  Full tests ran with `npm.cmd test -- --configLoader runner --config
  scratch/vite-check.config.ts`. Vite used port 1456 with strictPort and
  those same config flags; drives used the requested run.mjs and base URL.
- New prose is ASCII and all touched files were checked as strict UTF-8.
  Existing Unicode in the generated reference is retained from the tools.
- No changes to History, no screenshots committed, no push, release,
  deployment or CI dispatch. No ADR was needed for these bug fixes.

The History column above is proposed text only; `docs/History.md` was not edited.
