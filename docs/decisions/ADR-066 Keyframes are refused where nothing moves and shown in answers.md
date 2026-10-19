# ADR-066: Keyframes are refused where nothing moves, and shown in answers

**Date:** 2026-10-18. **Status:** accepted.

## Context

Making the launch film through MCP ([[Launch film through MCP 2026-10-18]])
found three ways the keyframe tools misled a model:

- `add_keyframe` stored a key on any path and answered that the path was
  keyframed. `style.letterSpacing` (a tracking-expand title move) was
  accepted, but the renderer never reads that key, so nothing moved. An
  effect path that named no effect had been fixed the same way that day.
- `describe_project` listed which paths were keyed, not the keys. An edit
  to a key's value changed nothing the description showed, so the answer
  was `{"unchanged": true}`. The film's agent met it on `set_param volume`
  over a ducked music clip.
- `add_keyframe` took 8 eases and `set_keyframe_ease` took 12 and a
  bezier. The modern expo-out took two calls a key.

## Decision

- **One table of what animates**, `src/lib/animatable.ts`. Each row is a
  path pattern (`transform.x`, `adjust.<exposure|...>`,
  `effects.<index|id|type>.<param>`, `shape.<width|...>`), the clips it
  animates on, and, where needed, what must be on first:
  - `transform.scaleY` needs a non-uniform scale;
  - `mask.*` needs a mask;
  - `reverb.mix` needs a reverb, and the filters and echo likewise;
  - `shape.stroke.width` needs an outline.

  The rows are the paths the renderer and mixer read: `render/plan.ts`,
  `shapes.ts`, `grade.ts`, `wiggle.ts`, `audio.ts` and `engine/soundFx.ts`.
- **`add_keyframe` checks its path** against the table and refuses any
  other. The error lists the paths that animate on that clip.
  **`set_param`** refuses only when it would write a key: `at` is given
  and the path already has keys. Without keys, it sets the value for the
  whole clip as before, so `set_param style.lineHeight` still works.
- **The type's size, tracking and color** (`style.size`,
  `style.letterSpacing`, `style.color`) are rows now. The render work of
  the same day makes the text renderer interpolate them. A path the
  renderer learns later is one more row.
- **`describe_project` shows the keys**: `keyframes: {"transform.x":
  [[3, 0.75, "fastIn"], [3.5, 0.16]]}`.
  - Each key is `[at, value]` or `[at, value, ease]`, with `at` in
    timeline seconds.
  - The ease is a preset's name when it matches one, else the bezier.
  - Edit answers are diffs of the description, so a key's edit now shows.
  - A path with more than 24 keys (tracking, ducking) is summed up as
    `{count, first, last, range}`, so a tracked layer does not cost
    kilobytes.
- **One ease vocabulary.** `add_keyframe`, `set_keyframe_ease` and
  `set_audio_filter`'s sweep take the easing menu's twelve presets
  (`keyframeEdit.ts`). The keyframe tools also take `bezier`. `fastIn`
  (0.16, 1, 0.3, 1) is the expo-out, so a slide-in is one call.
- `move_keyframe` names an effect's parameter by place or type, as the
  other keyframe tools do.

## Consequences

- A model learns which paths animate the first time it guesses wrong,
  from the error. The `help` topic `params` lists the same table.
- On this branch, keys on the three `style.*` paths are accepted before
  the renderer draws them. They render once the render branch merges.
- Chroma key strength, feather and spill are not rows. The compositor
  reads the chroma key as stored, so keys on them do nothing. The
  inspector can still key them through its sliders; making them animate
  belongs to the render lane.
- Keys already stored on a dead path stay in the document. `set_param`
  refuses to add to them and names `remove_keyframes`.
