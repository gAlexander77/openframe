# ADR-109: What an agent can set, a person can see and change

**Date:** 2026-10-20. **Status:** accepted. The person's side of
[[ADR-099 Feathers blur the shape, title runs share a baseline, pictures take a border]]
to [[ADR-105 Answers hold what was asked, tracked titles center on their letters, pictures take a color]].

## Context

The fifth improvements round was built mostly for agents: borders,
colorize, a compressor and EQ on compound clips, crossfades between audio
clips, songs cut on their bars and given a grid, clips turned off, music
markers that follow their clip, a narrower main-track magnet and tracked
titles centered on their letters. A UI pass used each one as a person
would, in the web build at 1024 x 700, 1280 x 720, 1600 x 950 and
1920 x 1080, with screenshots, undo, the agent's notice (ADR-093) and the
keyboard. What passed:

- The Border, Shadow and Colorize controls lay out cleanly at every size
  (at 1024 x 700 each slider takes its own line, as the inspector does
  below 340 px), and their values round-trip through the project.
- The main-track magnet behaves for a person as before ADR-102: deleting
  a middle shot and trimming a tail by drag both close the hole.
- Music markers follow their clip while a person drags it, live, and the
  Markers tab lists them as any marker.
- The on-canvas editor of a centered or right-aligned title tracked 34
  draws its typed letters on the drawn ones, line by line (DOM glyphs
  painted red over the frame). The caret after the last letter sits a
  spacing past it, outside the box, as CSS places it: left as it is.
- A deactivated clip is hatched and skipped by the viewer.

What failed, each fixed below:

1. **Turning Border or Shadow on left the section closed.** The switch
   sits in the section's header; a section with no remembered state opens
   only if the setting already exists, so the switch moved and nothing
   else did. The text tab's Glow and Gradient did the same.
2. **Colorize's switch dropped the keyboard focus.** Colorize (and
   Stabilize) opened by remounting the section under a new key; Enter on
   the switch then left the focus on the page.
3. **A mixed selection was turned inside out.** The clip menu named only
   the clicked clip ("Activate clip" on an off title) and the action
   flipped every selected clip, so the playing shape beside it went off.
   The undo step always read "Deactivate clip", and a clip turned back on
   kept `disabled: false` where `set_clip_enabled` removes the key.
4. **An off clip did not say so to a screen reader**: its name read the
   same on or off.
5. **The agent's notice named the new commands poorly**: "Change clip
   enabled", "Change colorize", "Change crossfade" for a removal, and
   `set_param` on `border.width` or `adjust.colorize.amount` read
   "Change width" and "Change amount".
6. **A title's drop shadow, border or colorize were out of reach.** All
   three commands take titles, but a title's inspector has no Video or
   Adjust tab: a person saw an agent's framed, amber title and found no
   control for it.
7. **A compound clip's Audio tab offered Channels**, which its mix
   ignores (ADR-100) and `set_channel_fill` leaves as it is: a dead
   control.
8. **Paste attributes left the new looks behind**: a picture's shadow and
   border and a voice's compressor were in no group, so a framed inset
   or an evened-out line could not be pasted onto the others.

And a crossfade between two audio clips could be made only by an agent,
and was drawn nowhere ([[ADR-104 Voice and sound an agent can trust without ears]] left it so).

## Decision

### A section opens when its switch turns on

`Section` takes `on`, the state of the switch in its header. When it
turns on, the section opens in place (no remount, so the focus stays on
the switch); the opening is not remembered, since the viewer did not
choose it. Border, Shadow, Colorize, Stabilize, Auto removal, Chroma key
and the title's Stroke, Glow, Gradient, Shadow and Background pass it.

### Activate and deactivate act on the selection as one

`enableToggle` (`lib/clipEnable.ts`): while any selected clip plays, the
switch turns them all off; when every one is off, it turns them all on,
as one undo step named for what it did ("Deactivate 2 clips", "Activate
clip"). The clip menu's item is named by the same rule over the
selection, and the action runs `set_clip_enabled`, the command an agent
runs. An off clip's accessible name ends in "deactivated".

### The notice and undo name what was done

`commandLabel` reads `set_param`'s path as the keyframe panel names its
lane (`paramLabel`: "Change border width", "Change colorize amount",
"Change position x"), else by the path's last two parts ("Change
compressor threshold"). `set_clip_enabled` reads as the timeline does;
`set_colorize` is "Colorize", `set_crossfade` "Crossfade"; `off: true`,
seconds 0 or preset off read "Remove border", "Remove colorize",
"Remove crossfade", "Compressor off".

### A title shows the picture settings it carries

The Text tab shows a **Drop shadow**, **Border** and **Colorize** section
while the title has one, where it can be changed or switched off (the
section then goes). "Drop shadow" because the tab's Shadow is the
letters' own. Titles get no new way to add them: their Stroke, Shadow
and Background already frame the letters, and three more switches would
crowd the tab. An agent's look stays in reach.

### A compound clip's Audio tab drops Channels

Its compressor's hint says it evens out the whole mix.

### Paste attributes carries the frame and the compressor

Transform now pastes shadow and border with position, crop and opacity
("Transform, crop, opacity, shadow and border"): a picture-in-picture's
frame goes with where it sits. Audio pastes the compressor with the EQ.
The groups and the command's schema are unchanged.

### Crossfades on the timeline (the UI added)

Premiere's constant-power audio transition at the cut is the model, with
ADR-104's placement (over the seconds before the cut). Three small
pieces, all reading `crossfadeJoin` (`lib/crossfadeJoin.ts`), which
reads `set_crossfade`'s rules and what the mix plays (`audioCrossfade`),
so the screen never disagrees with the sound:

- **The clip menu** of an audio clip: **Crossfade into next clip**, checked
  while one plays. Choosing it adds one as long as the transitions
  preference (0.5 s by default) as far as the join allows, or removes it.
  Where none fits it is still offered and says what to change ("The next
  clip starts at the very start of its file: trim its start so its sound
  can rise before the cut"); with nothing after the clip, or on a locked
  track, it is unavailable.
- **The timeline** draws it as it draws a transition (the Blend icon in
  the same pill), over the seconds before the cut and ending on it, at
  least 16 px wide, only where the mix plays one. Clicking it selects the
  clip and opens its Audio tab.
- **The Audio tab** has a **Crossfade** row (seconds, 0 to the most the
  join allows) under Fade out, wherever one fits. 0 removes it.

An agent's `set_crossfade` is drawn the same way.

## Gaps left, and why

- **`set_music_grid` and `cut_music` have no UI.** Giving a grid needs a
  tempo and a first downbeat in the file's seconds, and cutting bars a
  range of the file: both want a song view with its beats drawn (the
  music card's waveform, or the source monitor with bar lines), not a row
  of numbers. A person's beats come from AI tools > Beats meanwhile.
- **`check_project` has no panel**, so its findings (`sound_cut_off`
  among them) reach agents only. A person-facing review is a feature of
  its own.
- **A transition dropped on an audio cut** does not make a crossfade;
  the menu does.
- **The Markers tab does not say which markers follow a clip.**
- **Space on a focused switch plays the timeline** instead of toggling
  it (Enter toggles): the editor keeps Space for playback everywhere but
  in text fields, as before.

## Consequences

- Pasting transform now replaces the target's shadow and border with the
  source's (or removes them), as each checked group replaces its
  settings.
- A drive that read "Change x" or "Change width" from an agent's
  `set_param` now reads the keyframe panel's names.
- Tests: `clipEnable.test.ts`, `crossfadeJoin.test.ts`,
  `commandLabels.test.ts`, `attributes.test.ts`; drives
  `section-switches.js` (four sizes), `audio-crossfade-ui.js` (two
  sizes), `clip-enable.js` and `agent-notice-labels.js`. Each fails on
  the code before this change.
