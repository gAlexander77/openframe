---
type: research
date: 2026-10-19
---

# UI at every window size 2026-10-19

The owner asked for every part of the UI to be checked with Playwright and
its styling fixed across window sizes, along with any bugs or gaps found on
the way. This note records the method, what broke and why, and the lessons
learned. It follows [[UI polish 2026-10-16]], which audited three sizes.

## Method

- **Four lanes, one area each:**
  - the shell and dialogs;
  - the library;
  - the inspector;
  - the player and timeline.
- **Browser:** headless Edge against each lane's own Vite, with Ollama
  stubbed.
- **Window sizes:** nine in all.
  - 1100 x 680, the desktop window's minimum;
  - 1280 x 720, 1366 x 768, 1440 x 900;
  - 1600 x 940, the default;
  - 1920 x 1080 and 2560 x 1440;
  - 1024 x 640 and 900 x 600, for a browser tab, where the web build
    should degrade gracefully.
- **Panel states:** every splitter at both limits, and the docked
  assistant open and closed.
- **Content:** a project with every clip kind and long names.
- **Each lane left a drive behind** that fails on:
  - overflow, overlap and clipping;
  - popups leaving the window;
  - squeezed controls.

  The drives are `sizes-shell.js`, `sizes-library.js`,
  `sizes-inspector.js` and `sizes-timeline.js`. Together they cover more
  than a thousand states.

## What broke, and why

### The player's floor

The transport needs 456 px. Several paths took it below that, and the play
button ended up under the zoom menu:

- a side panel dragged to its cap at 1100;
- the docked assistant in a 900 px tab;
- a 320 px player.

The fixes, from the outside in:

- **The splitters stop** where the player would drop under 456 px
  (`sideMax`).
- **The assistant floats** below 1066 px (`canDock`, see the ADR-064
  addendum).
- **What is left, the transport absorbs:** below about 470 px, the play
  controls and the view controls wrap onto separate centered rows.

The 2026-10-22 merge sweep found that monitor mute and proxy playback had
outgrown the old transport breakpoint. With six playback controls (204 px)
and about 300 px of view controls, the centered grid needs about 824 px
including padding. At 840 px and below the times now get their own row;
the two control groups wrap again when their combined widths do not fit.
Both grid side columns retain their content minimum. A short trim preview
also tightens its padding and gaps by querying the stage, so its header,
two pictures, source labels and footnote fit a 151 px player stage.

### Fixed sizes in a fluid shell

- The mixer was a fixed 720 px, even at 2560.
- Home's preset tiles were five 276 px boxes, mostly empty at 1920.
- The project cards made eleven small columns at 2560.
- The title bar's name was capped at 360 px, leaving half the bar empty.

Each now sizes from its content or from the room it has.

### Measured constants gone stale

- The toolbar's hide-the-zoom-slider width predated Crop, Mirror and
  Rotate.
- The zoom-in action allowed 64 while the timeline clamped at 60.

Each is now one constant, in one place.

### Layers

- **Tooltips in modal dialogs.** A modal `<dialog>` sits in the top layer,
  above any z-index, so the source monitor's tooltips were drawn underneath
  it. A tooltip now moves into the open dialog.
- **The track header column.** The playhead and markers drew over the
  track headers when the timeline was scrolled sideways. Each sticky header
  starts its own stacking layer, so the column must be explicitly above
  every overlay, as CapCut, Premiere and Resolve keep it.
- **The in/out range** sat under the ruler, so it was never visible. It now
  lives in the ruler's sticky layer.

### The inspector below 340 px

The inspector was walked at 18 widths, from 203 to 576 px, with every clip
kind and every section open.

- **Slider rows** squeezed their labels to 32 px at 1024 and to 5 px at
  900. Under 340 px the label now shares a line with the number, and the
  slider shares the next line with the keyframe buttons.
- **Plain rows** started their controls 12 px left of the sliders' at
  every width. A control that doesn't fit now moves under its label.
- **The color wheels** at 324-383 px had a 9 px luminance slider. It now
  stacks under the wheel, and the wheels grow at 576.
- **One bug:** a number with a fractional step showed one decimal, so a
  2.39 letterbox read 2.4. Numbers now show as many decimals as their step.

### The library's tab strip

Eleven labeled tabs took three or four rows. At 1100 x 680 that was a third
of the panel.
[[ADR-094 Library tabs keep their labels only while they fit]] lays them out
in balanced rows and drops to icons when the labels would not fit.

### Gaps filled on the way

- **Home** has a grid/list toggle and a right-click menu (Open, Rename,
  Duplicate, Delete), as CapCut's Projects page does.
- **Tooltips** show the full text only where a name is actually cut.
- **The mixer:**
  - its pan control is labeled with its position;
  - Mute and Solo show their pressed state;
  - the master strip stays in view while the track strips scroll.
- **Popovers open on the side that has room:**
  - the track volume popover;
  - the timeline display menu;
  - the Record voiceover panel.
- **The new agent notice** ([[ADR-093 An AI agent's changes are announced at the top, under the Bot]])
  is checked at 1100, 1600 and 2560.

## Lessons (Chromium and WebView2 layout)

### Flex and grid sizing

- **A flex item will not shrink below its content.** A long `nowrap` name
  widens its flex item even when the name is set to clip. Set
  `min-width: 0`, or give the item a width.
- **Chromium sizes a flex row from its items' content width,** not their
  `flex-basis`. For a panel to be exactly as wide as its strips (the
  mixer), the strips need an explicit `width`.
- **A grid row stretches its shorter cards,** and their inner rows share
  the extra height unless `align-content: start` is set.
- **Four filters, one row or two by two:** the `clamp()` trick (a factor of
  999 on the distance to 440 px) lays them out as one row of four or two by
  two, never three and one.
- **Fixed tiles beside a growing banner:** `minmax(auto, min(58%, 780px))`
  lets the tiles stop growing while a `1fr` banner takes the rest.

### Containers and position

- **Centered title bars:** `1fr auto 1fr` keeps the center at full width
  and overflows the sides. Use
  `minmax(max-content,1fr) minmax(0,max-content) minmax(max-content,1fr)`
  so the center gives way.
- **A container query cannot change its container's own wrapping.** Keep
  `flex-wrap` on the container all the time, and give the name slot a zero
  `flex-basis`, so the slot wraps only when a query sets it to full width.
- **`container-type` does not trap `position: fixed` children** in current
  Chromium. A fixed box inside an `inline-size` container landed at the
  window's 0,0. [[UI polish 2026-10-16]] is corrected.

### Popovers and controls

- **Measure a popover with `offsetWidth` and `offsetHeight`.**
  `getBoundingClientRect` during its scale-in animation reads about 4%
  short, so the clamp lands wrong (the easing menu ran 1 px off the
  window).
- **A grid inside a card grows to its children's minimum width,** even
  when the card is a size container. Give it
  `grid-template-columns: minmax(0, 1fr)`.
- **In a wrapping row, `flex-basis` decides when a control drops under its
  label:** `auto` for choice buttons, a pixel value for selects and colors.
- **A fixed-width button with no content (a switch) shrinks to 0** in a
  flex row unless it has `flex: none`.
- **Chromium honors `text-overflow: ellipsis` on a closed `<select>`.**
- **`:where()` adds a rule** without beating more specific overrides
  already in place.
- **Class names are global, again.** The inspector and the export dialog
  each defined `.segmented`, so whichever stylesheet loaded last styled
  both. The export dialog's is `.export-segmented` now.

### Scrolling, fields and testing

- **A hidden scrollbar cannot be reached with a mouse wheel** on a
  horizontal scroller. Wrap the items instead (the crop ratios).
- **`select()` scrolls a long field to its end.** Use
  `setSelectionRange(0, n, "backward")` and `scrollLeft = 0` to show the
  start. The title bar and the shared rename field now do this.
- **`elementFromPoint` skips `pointer-events: none` elements.** To test
  whether a tooltip is visible, make it hit-testable for a moment.
- **React handles pointer events at its root** before a listener on
  `document` sees them. A handler can set `data-tip` as the pointer
  arrives, in time for the tooltip layer. That is how "a tooltip only when
  cut" works.
- **Turning off animations inside a drive** cut a sweep of about 2,000
  states to about 3 minutes.
- **Audit what is painted.** The 2026-10-22 sweep's Manage media overlap
  was a select inside closed Organize folders content: Chromium still
  reports its layout rectangle. Use the style sweep's closed-details
  visibility check. Mixer track strips deliberately scroll under the
  opaque sticky master; clip their measured visible rectangles at the
  master's left edge, just as the timeline audit clips under its headers.

## Left as it is

- **The keyframe panel in short windows.** In windows 680-768 px tall it
  gets its 90 px minimum beside two track rows: usable, but cramped. The
  timeline's splitter gives it room. Growing the timeline when the panel
  opens is a layout decision for later.
- **Short track rows** (titles, effects) keep the name beside the toggles,
  so "Overlay" reads "Overl…" with its full name in the tooltip.
