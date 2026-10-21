# ADR-111: A person checks the project, Space presses what the keyboard reached, and a transition on sound crossfades

**Date:** 2026-10-20. **Status:** accepted; `preview_audio`'s join measurements became check rules, and the gaps it kept open from ADR-109 closed, by [[ADR-119 A person corrects a song's grid and cuts its bars, markers say what they follow, and the check hears its joins]]. Closes three gaps
[[ADR-109 What an agent can set, a person can see and change]] left.

## Context

`check_project` reviews an edit against professional rules: text past the
title-safe area or under the vertical apps' buttons, text too small for a
phone, too short to read, or low in contrast as measured on the rendered
picture, captions too fast, more than two fonts, a title its subject
hides, strobes, black gaps, music that stops dead, a sound cut off
mid-sound, an ad's end card and an edit's cuts on the beat
([[ADR-068 check_project measures the picture and the sound it judges]],
[[ADR-097 Checks and versions judge by the picture]],
[[ADR-103 Checks see inside compounds, and versions refit cards, scrims and titles as the check judges them]]).
Each finding names the tool that fixes it. Only agents could run it: a
person editing by hand had none of it.

ADR-109's UI pass also found two small bugs:

- **Space on a focused switch played the timeline** instead of toggling
  it. `onKeyDown` (`state/actions.ts`) left Enter to a focused button but
  sent every other key to the keymap, and its `preventDefault` on Space
  (play) also cancelled the button's own press.
- **A transition dropped on the join of two audio clips** did not make a
  crossfade. `transitionCut` looks for cuts on video tracks only and falls
  back to the main track's nearest cut, so the drop put a dissolve on a
  video cut the person never aimed at.

## Decision

### The Check tab

**Where it lives.** A **Check** tab in the library, beside Markers, plus
**File → Check project…** and a **Check** row in the Export dialog. The
findings are a list a person works through while editing (go to one, fix
it in the inspector, check again), as the Markers list is, so they belong
beside the timeline, not in a modal. The Export dialog's row is the step
before export: it says what the last check found ("1 error, 4 warnings")
and leads to the tab (**Review**), or, when there was none or the project
changed since, closes the dialog, opens the tab and checks (**Check
project**, **Check again**). It does not block the export: errors are
seizure-risk strobes and black gaps, still the person's call, and neither
CapCut nor Premiere blocks an export on advice.

**The same check.** `measureForCheck` (the rendering and decoding the check
needs) moved from `automation.ts` to `state/check.ts`; the agent's
`check_project` and the tab both call it and then `checkProject`, so the
tab finds what an agent finds, rule for rule (the drive compares them).
It takes a progress callback (frames rendered, sounds decoded) and an
abort signal, checked between steps. `lib/checkFindings.ts` only changes
the words: each rule says what is wrong ("“SUMMER SALE” is too small to
read on a phone"), the measurement behind it ("Its letters are 2.8% of the
frame's height"), and the control that fixes it ("Raise Size in the Text
tab to 49 or more") instead of the tool ("set_text style.size 49 or
more"). The numbers a person needs (the size to reach, the contrast
ratios the check tried on the same pixels) are read back from the
finding's message and fix; its tests run the real check, so a change of
wording shows there instead of as a wrong number. A rule added to the
check later is shown in its own words, grouped by its name, until it gets
person's words. `designCheck.ts` is unchanged: agents' answers stay as
they were.

**On request.** Measuring renders frames and decodes sound, so it runs
when asked, never on an edit. The run shows its stage and a progress
bar, can be canceled (the last result stays), and stops when the project
closes. The result is kept while the tab is closed, for its project; any
edit after it (the store's revision) marks it "The project changed since
this check", and the button reads **Check again**.

**Kinds.** The tool's kinds, named for a person: General video (`any`),
Ad (asks for an end card), Social short (type sized for a phone, clear of
the apps' buttons) and Cut to music (`epic_edit`: cuts on the beat). The
kind's line under the picker says what it adds.

**Grouped, counted, ordered.** Text (safe area, app buttons, size, reading
time, caption speed, contrast, fonts, hidden by its subject), Timing
(black gaps, strobes, the end card, beats) and Sound (no sound, music that
stops dead, sound cut off), each with its count, an empty one saying
"Nothing found"; inside a group errors first, then by time. Each finding
carries its level as a word (Error, Warning, Tip), not only a color. A
summary says what the counts mean for exporting ("1 error to fix before
you export, and 5 warnings"; "Ready to export: nothing found").
Loudness is not part of the check (`not_checked`): the tab says to pick a
Loudness target in Export or run Normalize loudness.

**A finding goes to its problem.** Clicking one returns to the project's
own timeline, selects its clip (a title inside a compound clip selects
the compound clip, which the timeline shows) and opens the inspector tab
that holds the fix (Text, Video for a compound's scale, Audio for a fade,
Effects for a strobe); a finding about no clip (a gap, the fonts)
deselects, so the inspector shows nothing unrelated. The playhead goes to
its time (an ad's missing end card to 2.5 s before the end, where it
goes) and the timeline scrolls it into view (`revealPlayhead`). The last
one visited stays marked.

**Twelve library tabs.** At the desktop window's 1100 x 680 minimum the
icon strip is two rows of six instead of one row of eleven; at 1600 px
two labeled rows of six; at 2560 px one labeled row. ADR-094's rules (two
rows at most, balanced) hold.

### Space presses a control the keyboard reached

`focusKeeps` (`lib/keymap.ts`) decides whether the focused element keeps a
key: a text field keeps every key; a slider or dropdown its arrows, Home,
End and Page keys; Enter presses a focused control, link or dropdown; and
**Space, with no modifier, presses a button, switch, checkbox, radio, tab
or menu item, or opens a dropdown, that the keyboard reached**, as
everywhere on the web. Everything else is the app's: Space plays from the
page, a focused timeline clip, the viewer and a slider (UX-06), and
chords with Space (Play in to out) are the app's on any control.

**A click's focus is not the keyboard's.** After a mouse click a button
keeps the focus; if Space pressed it again, clicking Split and pressing
Space would split twice, and CapCut's Space always plays outside text.
So Space presses only what the keyboard reached. Chromium's
`:focus-visible` cannot tell: it turns true on whatever has the focus as
soon as a key is pressed, the Space being decided included (measured: a
switch clicked, then Space, matched `:focus-visible` in the keydown and
toggled). `state/actions.ts` records instead how the focus arrived: a
`focusin` after a key press (Tab, a menu's arrows, Escape handing the
focus back) is the keyboard's; a pointer press makes it a click's, even
on the control that already had it.

Menu items already took Space: a menu stops the app's keys while it has
the focus.

### A transition on an audio join is a crossfade

`audioJoin` (`lib/drop.ts`) finds the nearest place on the audio track
under the drop where one audio clip ends and another starts. There the
drop is a crossfade, whichever transition was dragged: sound has one
transition, Premiere's constant power, which `set_crossfade` plays. The
preview reads **Crossfade** and covers the seconds before the cut, where
the timeline then draws it; the drop runs the same function as the clip
menu's **Crossfade into next clip** (`crossfadeInto` in `Timeline.tsx`,
now shared): the transitions' default length as far as the join allows,
one undo step named Crossfade, the clip selected on its Audio tab. Where
none fits it says what to change (the next clip starts at the start of
its file) and adds nothing. A drop on an audio track with no join, or on
a locked one, keeps the old rule (the main track's nearest cut). The
Transitions tab's hint says so.

## Gaps left, and why

- **A finding says what to do; it does not do it.** Each fix is a named
  command, so a later Fix button can run the one the agent would (a box,
  a fade, a size); deciding which of several fixes, and showing the
  result before it lands, is a feature of its own.
- **`preview_audio`'s join measurements** (a click, a dropout at a cut)
  are an agent's listening tool, not a check rule, so the tab cannot show
  them; making a join that clicks a rule of the check would bring it here
  with no change to the tab (it groups unknown rules by name).
- **The check does not follow edits.** It says when it is out of date; a
  live check would render frames on every edit.
- Still open from ADR-109: `set_music_grid` and `cut_music` have no UI,
  and the Markers tab does not say which markers follow a clip.

## Consequences

- The library has twelve tabs; `LeftTab` takes `check`.
- `measureForCheck` is in `state/check.ts`; `automation.ts` imports it.
- After a click, Space plays as before; after Tab, Space presses. A
  person who reached a button with Tab and wants to play clicks the
  timeline or the viewer first, or uses the player's Play button.
- Tests: `checkFindings.test.ts`, `keymap.test.ts` (focusKeeps),
  `drop.test.ts` (audioJoin); drives `check-panel.js` (three sizes, against
  the agent's own `check_project`), `space-on-controls.js` (four of its
  checks fail on the old handler) and `crossfade-drop.js` (two sizes).
