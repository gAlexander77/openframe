# ADR-073: Templates land as a block, and the web keeps what it imports

**Date:** 2026-10-18. **Status:** accepted.

## Context

Recording the launch film's footage ([[Launch film through MCP 2026-10-18]])
found five places where the editor put things somewhere the user did not
expect, or quietly lost them:

- **Templates scattered their layers.** `placeOnTop` placed each layer
  alone, reusing the row above whatever showed then if it was a free,
  unlocked overlay row. A B-roll row with a shot later on qualified, so a
  two-layer location tag put its title on the B-roll row and its subline
  on a new track; a second tag made another track.
- **An export preset kept its name on the wrong shape.** The dialog
  remembers settings between exports, and names the preset they match.
  After one export with "TikTok, Reels and Shorts" (1080p, higher, 30
  fps), a 16:9 project opened with that preset selected, and it exported
  1920x1080: the settings scale the canvas, they never reshape it.
- **Web imports by address were not copied.** Picked files go into the
  browser's private storage (OPFS); a URL import kept the URL, so the
  project went offline with it.
- **Pressing Create and leaving at once left an empty project on Home**:
  a new project was saved the moment it was made.
- **Contact sheets were posterized.** `preview_frames` answered PNG. A
  16-frame, 480-wide sheet of the film's footage measured 4.6 MB, past the
  3.75 MB an MCP client may pass a model, and Claude Code shrinks an
  oversized PNG by re-encoding it with a 256-color palette (its image
  compressor's PNG path). Skies banded in what the model saw; the sheet
  itself was faithful (measured against ffmpeg's decode of the same
  frames, levels and contrast matched).

## Decision

- **A multi-layer template is one block** (`placeStack` in
  `lib/overlays.ts`): layers that overlap in time get rows of their own,
  each above the layers it covers; layers that follow one another share a
  row (a countdown). The rows sit together directly above the base track:
  the topmost video track that shows anything during the template or
  holds footage at all, so a title never sits under a B-roll row that is
  only empty for now. Free overlay rows there are reused, so a second
  template later on joins the same rows. **Footage rows (video, compound,
  pictures other than stickers) never receive an overlay**, from any path
  (titles, stickers, ad elements, graphics). A template's layers are
  grouped, as an ad element's are: they select and move together, and
  Alt+click picks one.
- **An export preset may be made for a shape** (`shape` on
  `ExportPreset`; the social preset is 9:16). It is only named for
  settings on a canvas of that shape, so remembered settings no longer
  preselect it elsewhere. Picked on another shape, the dialog says what
  it will export ("Made for 9:16 video. This project is 16:9, so it
  exports at 1920×1080") and offers "Make the canvas 9:16". Only that
  click changes the canvas, as one undo step. Saying so beats switching
  silently: a landscape edit made portrait needs reframing, which the
  person should choose.
- **The web build copies a URL import into OPFS**, as a picked file
  (`adoptUrl`), streaming it to disk with a progress toast, up to 1 GiB
  (`URL_COPY_LIMIT`). Bigger, or when the browser keeps nothing (a private
  window), it stays linked and a toast says it goes offline with its
  address.
- **A new project is not saved until it is touched**, and leaving it
  untouched discards it (with any save of edits since undone). Touched
  means the document is no longer the object New made; undoing every
  edit makes it untouched again. `list_projects` lists the open unsaved
  one, so an agent still finds it.
- **Contact sheets are JPEG at quality 0.98** (`preview_frames`,
  `preview_motion`, `preview_media`, the `export_versions` check sheet).
  The film's 16-frame sheet is 0.65 to 0.9 MB instead of 4.6, and a client
  that still shrinks it re-encodes a JPEG as a JPEG. At 0.92, a smooth
  dark sky showed JPEG's 8-pixel blocks (39 of 52 levels); at 0.98 it
  keeps 47, steps of 2 where the lossless frame has 1. `preview_frame`
  stays PNG: drives compare its pixels exactly.
- **The export-complete card tells success from warning.** A mix that
  reached its loudness target (within 1 LU) is a success, shown green
  with a check (`info` on the result); a mix the peaks or the gain range
  held short is a warning, amber, saying how far under the target it is
  (`note`). AAC encoded in software is information, not a warning.

## Consequences

- Drives: `template-placement`, `export-shape`, `web-media`,
  `contact-sheet-banding`, `export-done-card`; `export-loudness` checks
  the success/warning split.
- A template added inside a busy stretch goes above everything there,
  even a text row that is free for only part of it: rows are taken
  whole for the block, never split around another clip.
- An agent's `import_media` on the web build now waits for the copy; the
  asset's `src` is the OPFS key, not the URL.
- Left as it was: `preview_frame` above about 1600 px wide can still exceed a
  client's budget as PNG; make it JPEG past a size if agents ask for
  wide frames.
