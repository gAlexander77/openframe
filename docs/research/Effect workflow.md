# Effect workflow review — 2026-10-15

The owner asked how to remove an effect, then requested useful additions
found in other video editors. At `a61a288`, applied effects were below the
entire color slider list in Adjust → Basic. Removal existed, but finding it
required knowing an unrelated panel location. The renderer already applies
an ordered effect stack; its UI lacked reordering and reuse controls.

## References

- [Premiere: copy and paste clip effects](https://helpx.adobe.com/premiere/desktop/add-video-effects/apply-video-effects/copy-and-paste-clip-effects.html)
  describes reusing effects and keyframes across clips, including multiple
  targets and appending new effects to those already present.
- [Kdenlive: Effects and Filters](https://docs.kdenlive.org/en/effects_and_filters.html)
  exposes an effect stack with enable/disable, reset, deletion and move-up/
  move-down controls. Its documentation explains that stack order changes
  the result. This is a workflow reference, not code imported into OpenFrame.

## Decisions and delivery

1. **Make the existing controls discoverable.** Give effects their own
   inspector tab with an applied count, keep color/filter settings in Adjust,
   and wrap the tab row instead of hiding later tabs. Delivered in `f9ce2f9`.
2. **Expose stack editing.** Add reorder, reset and remove-all controls using
   the existing effect IDs and undo history. Delivered in this pass, along
   with explicit Enable all/Disable all actions and effect IDs for automation.
3. **Reuse effects across clips.** Add an explicit effect-stack clipboard;
   preserve existing effects and keep copying separate from clip/keyframe
   clipboard actions. Pending a following commit.

Large work such as multicam, trim monitors and model-based tools remains on
the roadmap; the paused Claude Code worktrees keep their ownership. No new
dependencies, saved-format changes, publication or native computer control
are needed for this pass.

## Verification

`effects-inspector` checks a video with audio, an effect and a transition at
1600×950 and 1100×680: all seven tabs fit, Effects opens the applied stack,
disable/remove/undo work, and Adjust still contains color controls. Tests
run through an isolated headless Playwright MCP browser; screenshots remain
in `scratch/`. This checks shared UI, not native desktop behavior.

The `effect-stack` drive passed ten checks at 1100×680, including actual
rendered-pixel differences when two effects swap order, undo, reset/keyframe
cleanup, enable/disable-all, remove-all, and fitting control/tab labels.
Seven pure tests cover stable IDs, keyframe preservation, similar ID prefixes,
locked tracks, command validation and default parameters (353 tests total).

Reset returns one effect's parameters to catalog defaults and removes that
effect's animated keys; it preserves the effect's identity and enabled state.
Clear removes the effect stack and its keys while retaining grading,
transforms and other animation. Disable all and Enable all explicitly set
every effect's enabled flag; Undo restores any previous mixed enabled state.
Text and caption clips also expose Effects, since the renderer already
supports their video-effect stack. Track locks protect stack edits.
